import { prisma, logger } from "../../config";
import { bundleAccess } from "../auth";
import { normalizeLanguage } from "../../services/app-store-markets";
import { FREE_KEYWORDS_PER_APP, isTeamPro } from "../../services/pro-grants";
import { KeywordTracker } from "../../services/keyword-tracker";
import { keywordsRouter } from "./keywords-list";

keywordsRouter.post("/", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const { term, country, language } = req.body;
    if (!term) return res.status(400).json({ error: "term is required" });
    const normalizedCountry = (country || "de").toLowerCase();
    const normalizedLanguage = normalizeLanguage(language, normalizedCountry);
    const ownApp = req.bundleApp!;

    if (!(await isTeamPro(ownApp.teamId))) {
      const trackedGroups = await prisma.keywordRanking.groupBy({
        by: ["keywordId"],
        where: { appId: ownApp.id },
      });

      const tracked = trackedGroups.length;

      if (tracked >= FREE_KEYWORDS_PER_APP) {
        return res.status(403).json({
          error: `Free plan is limited to ${FREE_KEYWORDS_PER_APP} keywords per app. Upgrade to Pro to track more.`,
          code: "KEYWORD_LIMIT_REACHED",
          limit: FREE_KEYWORDS_PER_APP,
        });
      }
    }

    const keyword = await prisma.keyword.upsert({
      where: { term_country: { term, country: normalizedCountry } },
      create: {
        term,
        country: normalizedCountry,
        language: normalizedLanguage,
      },
      update: {},
    });

    await prisma.keywordSuggestion.updateMany({
      where: {
        appId: ownApp.id,
        country: normalizedCountry,
        term: { equals: term, mode: "insensitive" },
        status: "PENDING",
      },
      data: { status: "ADDED" },
    });

    const existingRanking = await prisma.keywordRanking.findFirst({
      where: { keywordId: keyword.id, appId: ownApp.id },
      select: { id: true },
    });

    if (!existingRanking) {
      await prisma.keywordRanking.create({
        data: {
          keywordId: keyword.id,
          appId: ownApp.id,
          rank: null,
          country: normalizedCountry,
        },
      });
    }

    void (async () => {
      try {
        const tracker = new KeywordTracker(ownApp.bundleId, normalizedCountry);

        await tracker.trackKeywordRanking(term, normalizedCountry);
      } catch (trackErr) {
        logger.warn(`[keywords/add] Background ranking fetch failed for "${term}"`, {
          error: String(trackErr),
        });
      }
    })();

    res.json({ ok: true, keyword, tracking: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.get("/suggestions", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const suggestions = await prisma.keywordSuggestion.findMany({
      where: { appId: ownApp.id, status: "PENDING" },
      orderBy: [{ popularity: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        term: true,
        country: true,
        language: true,
        popularity: true,
        difficulty: true,
        searchVolume: true,
      },
    });

    res.json({ items: suggestions, total: suggestions.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.post("/suggestions/:id/dismiss", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const result = await prisma.keywordSuggestion.updateMany({
      where: { id: req.params.id, appId: ownApp.id, status: "PENDING" },
      data: { status: "DISMISSED" },
    });

    if (result.count === 0) return res.status(404).json({ error: "Suggestion not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.get("/groups", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const groups = await prisma.keywordGroup.findMany({
      where: { appId: ownApp.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    });

    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.post("/groups", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const max = await prisma.keywordGroup.aggregate({
      where: { appId: ownApp.id },
      _max: { sortOrder: true },
    });

    const group = await prisma.keywordGroup.create({
      data: { appId: ownApp.id, name, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, sortOrder: true },
    });

    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function loadOwnedGroup(req: any, res: any) {
  const group = await prisma.keywordGroup.findUnique({
    where: { id: req.params.id },
    include: { app: { select: { teamId: true } } },
  });

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return null;
  }

  if (req.user.role !== "ADMIN" && group.app.teamId !== req.user.teamId) {
    res.status(403).json({ error: "Not authorized" });
    return null;
  }

  return group;
}

keywordsRouter.patch("/groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedGroup(req, res);
    if (!group) return;

    const data: { name?: string; sortOrder?: number } = {};

    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      data.name = name;
    }

    if (req.body.sortOrder != null && Number.isFinite(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }

    const updated = await prisma.keywordGroup.update({
      where: { id: group.id },
      data,
      select: { id: true, name: true, sortOrder: true },
    });

    res.json({ group: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.delete("/groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedGroup(req, res);
    if (!group) return;
    await prisma.keywordGroup.delete({ where: { id: group.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.put("/:id/group", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const keywordId = req.params.id;
    const groupId: string | null = req.body.groupId ?? null;

    if (groupId) {
      const group = await prisma.keywordGroup.findFirst({
        where: { id: groupId, appId: ownApp.id },
        select: { id: true },
      });

      if (!group) return res.status(404).json({ error: "Group not found" });

      await prisma.keywordGroupMember.upsert({
        where: { appId_keywordId: { appId: ownApp.id, keywordId } },
        create: { appId: ownApp.id, keywordId, groupId },
        update: { groupId },
      });
    } else {
      await prisma.keywordGroupMember.deleteMany({
        where: { appId: ownApp.id, keywordId },
      });
    }

    res.json({ ok: true, groupId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.delete("/", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const result = await prisma.keyword.deleteMany({
      where: { rankings: { some: { appId: ownApp.id } } },
    });

    res.json({ ok: true, removedCount: result.count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.delete("/:id", async (req, res) => {
  try {
    if (req.user!.role !== "ADMIN") {
      const teamId = req.user!.teamId;
      const ranking = await prisma.keywordRanking.findFirst({
        where: {
          keywordId: req.params.id,
          app: { teamId },
        },
      });

      if (!ranking) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
    }

    await prisma.keyword.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
