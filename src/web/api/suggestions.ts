import { Router } from "express";
import { prisma, getEffectiveSettings } from "../../config";
import { ascClientFromSettings } from "../../services/asc-client";
import { requireAuth, verifyAppOwnershipByBundleId } from "../auth";
import type { Request, Response } from "express";

export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth);

async function verifySuggestionAccess(req: Request, res: Response, suggestionId: string) {
  const suggestion = await prisma.aSOSuggestion.findUnique({
    where: { id: suggestionId },
  });

  if (!suggestion) {
    res.status(404).json({ error: "Not found" });
    return null;
  }

  if (suggestion.appBundleId) {
    const app = await verifyAppOwnershipByBundleId(req, res, suggestion.appBundleId);
    if (!app) return null;
  }
  return suggestion;
}

suggestionsRouter.get("/", async (req, res) => {
  try {
    const { status, locale, type, limit, bundleId } = req.query;
    const where: any = {};

    if (status) where.status = String(status).toUpperCase();
    if (locale) where.locale = String(locale);
    if (type) where.type = String(type).toUpperCase();

    if (bundleId) {
      const ownedApp = await verifyAppOwnershipByBundleId(req, res, String(bundleId));
      if (!ownedApp) return;

      where.appBundleId = String(bundleId);
    } else if (req.user!.role !== "ADMIN") {
      const teamApps = await prisma.app.findMany({
        where: { teamId: req.user!.teamId },
        select: { bundleId: true },
      });

      where.appBundleId = { in: teamApps.map((a) => a.bundleId) };
    }

    const parsedLimit = limit ? parseInt(String(limit), 10) : 100;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(1, parsedLimit), 500) : 100;

    const suggestions = await prisma.aSOSuggestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      include: { keyword: true },
    });

    const grouped: Record<string, any[]> = {};
    for (const s of suggestions) {
      const loc = s.locale || "en-US";
      if (!grouped[loc]) grouped[loc] = [];

      grouped[loc].push({
        id: s.id,
        type: s.type,
        locale: s.locale,
        suggestedValue: s.suggestedValue,
        currentValue: s.currentValue,
        reasoning: s.reasoning,
        confidenceScore: s.confidenceScore,
        estimatedImpact: s.estimatedImpact,
        status: s.status,
        aiProvider: s.aiProvider,
        aiModel: s.aiModel,
        keyword: s.keyword?.term ?? null,
        createdAt: s.createdAt,
        appliedAt: s.appliedAt,
      });
    }

    res.json({ suggestions: grouped, total: suggestions.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function updateSuggestionStatus(req: Request, res: Response, status: "APPROVED" | "REJECTED") {
  try {
    const id = req.params.id as string;
    const existing = await verifySuggestionAccess(req, res, id);
    if (!existing) return;

    const suggestion = await prisma.aSOSuggestion.update({
      where: { id },
      data: { status },
    });
    res.json({ ok: true, suggestion });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

suggestionsRouter.post("/:id/approve", (req, res) => updateSuggestionStatus(req, res, "APPROVED"));
suggestionsRouter.post("/:id/reject", (req, res) => updateSuggestionStatus(req, res, "REJECTED"));

suggestionsRouter.post("/:id/apply", async (req, res) => {
  try {
    const suggestion = await verifySuggestionAccess(req, res, req.params.id);
    if (!suggestion) return;

    const settings = await getEffectiveSettings(req.user!.userId);

    const asc = ascClientFromSettings(settings);
    if (!asc) {
      return res.status(400).json({ error: "App Store Connect credentials not configured." });
    }

    const locale = suggestion.locale || "en-US";
    const changes: Record<string, string> = {};
    const typeKey = suggestion.type.toLowerCase();

    if (typeKey === "title") changes.name = suggestion.suggestedValue;
    else if (typeKey === "subtitle") changes.subtitle = suggestion.suggestedValue;
    else if (typeKey === "keywords") changes.keywords = suggestion.suggestedValue;
    else if (typeKey === "description") changes.description = suggestion.suggestedValue;

    if (Object.keys(changes).length > 0) {
      if (!suggestion.appBundleId) {
        return res.status(400).json({ error: "Suggestion has no associated app" });
      }

      await asc.applyASOChanges(changes, locale, suggestion.appBundleId);
      await prisma.aSOSuggestion.update({
        where: { id: req.params.id },
        data: { status: "APPLIED", appliedAt: new Date() },
      });

      res.json({ ok: true, applied: changes, locale });
    } else {
      res.status(400).json({ error: `Cannot apply type: ${suggestion.type}` });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

suggestionsRouter.post("/bulk-approve", async (req, res) => {
  try {
    const { locale, bundleId } = req.body;
    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }
    const ownedApp = await verifyAppOwnershipByBundleId(req, res, bundleId);
    if (!ownedApp) return;

    const where: any = { status: "PENDING", appBundleId: bundleId };
    if (locale) where.locale = locale;

    const result = await prisma.aSOSuggestion.updateMany({
      where,
      data: { status: "APPROVED" },
    });
    res.json({ ok: true, count: result.count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

suggestionsRouter.post("/auto-apply", async (req, res) => {
  try {
    const settings = await getEffectiveSettings(req.user!.userId);
    const minConfidence = parseFloat(req.body.minConfidence ?? "0.8");
    const locale = req.body.locale as string | undefined;
    const bundleId = req.body.bundleId as string | undefined;

    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }

    const ownedApp = await verifyAppOwnershipByBundleId(req, res, bundleId);
    if (!ownedApp) return;

    const asc = ascClientFromSettings(settings);
    if (!asc) {
      res.status(400).json({ error: "App Store Connect credentials not configured." });
      return;
    }

    const where: any = {
      status: "PENDING",
      confidenceScore: { gte: minConfidence },
      appBundleId: bundleId,
    };
    if (locale) where.locale = locale;

    const suggestions = await prisma.aSOSuggestion.findMany({
      where,
      orderBy: [{ locale: "asc" }, { confidenceScore: "desc" }],
    });

    if (suggestions.length === 0) {
      res.json({
        ok: true,
        applied: 0,
        message: "No qualifying suggestions found.",
      });
      return;
    }

    const byLocale = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      const group = byLocale.get(s.locale) ?? [];
      group.push(s);
      byLocale.set(s.locale, group);
    }

    let totalApplied = 0;
    const results: { locale: string; applied: string[]; errors: string[] }[] = [];

    for (const [loc, localeSuggestions] of byLocale) {
      const bestByType = new Map<string, (typeof localeSuggestions)[0]>();

      for (const s of localeSuggestions) {
        const existing = bestByType.get(s.type);

        if (!existing || (s.confidenceScore ?? 0) > (existing.confidenceScore ?? 0)) {
          bestByType.set(s.type, s);
        }
      }

      const changes: Record<string, string> = {};
      const appliedSuggestions: typeof localeSuggestions = [];

      for (const [type, suggestion] of bestByType) {
        const key = type.toLowerCase();
        if (key === "title") changes.name = suggestion.suggestedValue;
        else if (key === "subtitle") changes.subtitle = suggestion.suggestedValue;
        else if (key === "keywords") changes.keywords = suggestion.suggestedValue;
        else if (key === "description") changes.description = suggestion.suggestedValue;
        appliedSuggestions.push(suggestion);
      }

      if (Object.keys(changes).length === 0) continue;

      try {
        const result = await asc.applyASOChanges(changes, loc, bundleId);

        for (const suggestion of appliedSuggestions) {
          const wasApplied = result.applied.some((a: string) =>
            a.toLowerCase().includes(suggestion.type.toLowerCase()),
          );
          await prisma.aSOSuggestion.update({
            where: { id: suggestion.id },
            data: {
              status: wasApplied ? "APPLIED" : "REJECTED",
              appliedAt: wasApplied ? new Date() : undefined,
              resultNotes: wasApplied
                ? `Auto-applied to ${loc} version ${result.versionString}`
                : `Failed: ${result.errors.join("; ")}`,
            },
          });
          if (wasApplied) totalApplied++;
        }

        results.push({
          locale: loc,
          applied: result.applied,
          errors: result.errors,
        });
      } catch (err) {
        results.push({ locale: loc, applied: [], errors: [String(err)] });
      }
    }

    res.json({ ok: true, applied: totalApplied, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
