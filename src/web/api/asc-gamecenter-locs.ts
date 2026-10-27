import { prisma } from "../../config";
import { bundleAccess } from "../auth";
import { LOCALE_MAP } from "../../services/utils/country_lang";
import {
  EDITABLE_STATES,
  ascClientForUser,
  forbidResource,
  gcDetailIdForBundle,
  getGameCenterDetailId,
  handle,
  verifyGcLocalization,
  verifyGcResource,
} from "./asc-shared";
import { ascRouter } from "./asc-versions";

ascRouter.get(
  "/gamecenter/achievements/:id/localizations",
  bundleAccess("query"),
  handle("achievement localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterAchievements/${id}/localizations`, {
      params: {
        "fields[gameCenterAchievementLocalizations]": "locale,name,afterEarnedDescription,beforeEarnedDescription",
        limit: 200,
      },
    });

    const locs = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
      afterEarnedDescription: l.attributes?.afterEarnedDescription ?? "",
      beforeEarnedDescription: l.attributes?.beforeEarnedDescription ?? "",
    }));

    res.json(locs);
  }),
);

ascRouter.post(
  "/gamecenter/achievement-localizations",
  bundleAccess("body"),
  handle("create achievement localization", async (req, res) => {
    const { achievementId, locale, name, afterEarnedDescription, beforeEarnedDescription } = req.body as {
      achievementId: string;
      locale: string;
      name: string;
      afterEarnedDescription?: string;
      beforeEarnedDescription?: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", achievementId, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const { data: resp } = await asc.client.post("/gameCenterAchievementLocalizations", {
      data: {
        type: "gameCenterAchievementLocalizations",
        attributes: { locale, name, afterEarnedDescription, beforeEarnedDescription },
        relationships: {
          gameCenterAchievement: { data: { type: "gameCenterAchievements", id: achievementId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      afterEarnedDescription: resp.data.attributes?.afterEarnedDescription ?? afterEarnedDescription ?? "",
      beforeEarnedDescription: resp.data.attributes?.beforeEarnedDescription ?? beforeEarnedDescription ?? "",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/achievement-localizations/:id",
  bundleAccess("body"),
  handle("update achievement localization", async (req, res) => {
    const id = req.params.id as string;
    const { name, afterEarnedDescription, beforeEarnedDescription } = req.body as {
      name?: string;
      afterEarnedDescription?: string;
      beforeEarnedDescription?: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "achievement", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, unknown> = {};

    if (name !== undefined) attrs.name = name;
    if (afterEarnedDescription !== undefined) attrs.afterEarnedDescription = afterEarnedDescription;
    if (beforeEarnedDescription !== undefined) attrs.beforeEarnedDescription = beforeEarnedDescription;

    await asc.client.patch(`/gameCenterAchievementLocalizations/${id}`, {
      data: { type: "gameCenterAchievementLocalizations", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/achievement-localizations/:id",
  bundleAccess("query"),
  handle("delete achievement localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "achievement", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterAchievementLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/challenges",
  bundleAccess("query"),
  handle("gamecenter challenges", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });

      return;
    }

    const gcDetailId = await getGameCenterDetailId(asc, app.id);

    if (!gcDetailId) {
      res.json({ challenges: [], gcDetailId: null, gcEnabled: false });

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterLeaderboardSets`, {
      params: {
        "fields[gameCenterLeaderboardSets]": "referenceName,vendorIdentifier",
        limit: 200,
      },
    });

    const challenges = (resp.data ?? []).map((c: any) => ({
      id: c.id,
      referenceName: c.attributes?.referenceName ?? "",
      vendorIdentifier: c.attributes?.vendorIdentifier ?? "",
    }));

    res.json({ challenges, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/challenges",
  bundleAccess("body"),
  handle("create challenge", async (req, res) => {
    const { referenceName, vendorIdentifier } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });

      return;
    }

    const { data: resp } = await asc.client.post("/gameCenterLeaderboardSets", {
      data: {
        type: "gameCenterLeaderboardSets",
        attributes: { referenceName, vendorIdentifier },
        relationships: {
          gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/challenges/:id",
  bundleAccess("body"),
  handle("update challenge", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName } = req.body as {
      referenceName?: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, unknown> = {};

    if (referenceName !== undefined) attrs.referenceName = referenceName;

    await asc.client.patch(`/gameCenterLeaderboardSets/${id}`, {
      data: { type: "gameCenterLeaderboardSets", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/challenges/:id",
  bundleAccess("query"),
  handle("delete challenge", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterLeaderboardSets/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/challenges/:id/localizations",
  bundleAccess("query"),
  handle("challenge localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterLeaderboardSets/${id}/localizations`, {
      params: {
        "fields[gameCenterLeaderboardSetLocalizations]": "locale,name",
        limit: 200,
      },
    });

    const locs = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
    }));

    res.json(locs);
  }),
);

ascRouter.post(
  "/gamecenter/challenge-localizations",
  bundleAccess("body"),
  handle("create challenge localization", async (req, res) => {
    const { challengeId, locale, name } = req.body as {
      challengeId: string;
      locale: string;
      name: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", challengeId, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const { data: resp } = await asc.client.post("/gameCenterLeaderboardSetLocalizations", {
      data: {
        type: "gameCenterLeaderboardSetLocalizations",
        attributes: { locale, name },
        relationships: {
          gameCenterLeaderboardSet: { data: { type: "gameCenterLeaderboardSets", id: challengeId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/challenge-localizations/:id",
  bundleAccess("body"),
  handle("update challenge localization", async (req, res) => {
    const id = req.params.id as string;
    const { name } = req.body as { name?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "challenge", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, unknown> = {};

    if (name !== undefined) attrs.name = name;

    await asc.client.patch(`/gameCenterLeaderboardSetLocalizations/${id}`, {
      data: { type: "gameCenterLeaderboardSetLocalizations", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/challenge-localizations/:id",
  bundleAccess("query"),
  handle("delete challenge localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "challenge", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterLeaderboardSetLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get("/supported-locales", async (req, res) => {
  res.json(Object.keys(LOCALE_MAP));
});

ascRouter.get(
  "/keyword-fields",
  bundleAccess("query"),
  handle("getKeywordFields", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    let version = await prisma.appStoreVersion.findFirst({
      where: { bundleId, appStoreState: { in: [...EDITABLE_STATES] } },
      include: { localizations: { select: { locale: true, name: true, subtitle: true, keywords: true } } },
      orderBy: { syncedAt: "desc" },
    });

    if (!version) {
      version = await prisma.appStoreVersion.findFirst({
        where: { bundleId },
        include: { localizations: { select: { locale: true, name: true, subtitle: true, keywords: true } } },
        orderBy: { syncedAt: "desc" },
      });
    }

    const fields: Record<string, string> = {};
    const indexedText: Record<string, string> = {};

    for (const loc of version?.localizations ?? []) {
      fields[loc.locale] = loc.keywords ?? "";
      indexedText[loc.locale] = [loc.name, loc.subtitle, loc.keywords].filter(Boolean).join(" ");
    }

    res.json({ keywordFields: fields, indexedText });
  }),
);
