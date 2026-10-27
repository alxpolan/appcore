import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { logger, prisma } from "../../config";
import { requireAuth, loadTeamRole, requireWriteRole } from "../auth";
import { resolveInternalAppId } from "../lib/resolve-app";
import { getEffectiveFramed, writeEffectiveFramed } from "../../services/screenshot-studio";
import { githubRouter } from "./github-oauth";

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];

githubRouter.delete("/screenshots/framed/:jobId", writeAuth, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const { url, allLocales } = req.body as { url?: string; allLocales?: boolean };

    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const { framedByLocale } = await getEffectiveFramed(jobId);

    if (Object.keys(framedByLocale).length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const basename = (u: string) => decodeURIComponent(u.split("/").pop() ?? u);
    const targetBasename = basename(url);

    const removedUrls: string[] = [];
    const updated: Record<string, string[]> = {};

    for (const [locale, urls] of Object.entries(framedByLocale)) {
      const filtered = urls.filter((u) => {
        const matches = allLocales ? basename(u) === targetBasename : u === url;
        if (matches) removedUrls.push(u);

        return !matches;
      });

      if (filtered.length > 0) updated[locale] = filtered;
    }

    await writeEffectiveFramed(jobId, updated);

    const screenshotsBase = path.join(process.cwd(), "screenshots");
    for (const removedUrl of removedUrls) {
      try {
        const rel = removedUrl.replace(/^\/screenshots\//, "");
        const filePath = path.join(screenshotsBase, rel);

        if (filePath.startsWith(screenshotsBase) && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err: any) {
        logger.warn(`Failed to delete screenshot file: ${err.message}`);
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Delete framed screenshot error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.patch("/screenshots/framed/:jobId/reorder", writeAuth, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const { locale, urls, allLocales } = req.body as { locale?: string; urls?: string[]; allLocales?: boolean };

    if (!locale || !Array.isArray(urls)) {
      res.status(400).json({ error: "locale and urls are required" });
      return;
    }

    const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const { framedByLocale } = await getEffectiveFramed(jobId);
    const existing = framedByLocale[locale];

    if (!existing) {
      res.status(404).json({ error: `Locale ${locale} not found` });
      return;
    }

    const existingSet = new Set(existing);

    if (urls.length !== existing.length || !urls.every((u) => existingSet.has(u))) {
      res.status(400).json({ error: "urls must be a permutation of the existing screenshots" });
      return;
    }

    const updated = { ...framedByLocale, [locale]: urls };

    if (allLocales) {
      const basename = (u: string) => decodeURIComponent(u.split("/").pop() ?? u);
      const orderIndex = new Map(urls.map((u, i) => [basename(u), i]));

      for (const [loc, locUrls] of Object.entries(framedByLocale)) {
        if (loc === locale) continue;
        updated[loc] = locUrls
          .map((u, i) => ({ u, i, key: orderIndex.get(basename(u)) ?? Number.MAX_SAFE_INTEGER }))
          .sort((a, b) => a.key - b.key || a.i - b.i)
          .map((entry) => entry.u);
      }
    }

    await writeEffectiveFramed(jobId, updated);

    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Reorder framed screenshots error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/latest-framed/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const internalAppId = await resolveInternalAppId(req.params.appId as string);

    if (!internalAppId) {
      res.json({ job: null });
      return;
    }

    const app = await prisma.app.findUnique({
      where: { id: internalAppId },
      select: { selectedScreenshotJobId: true },
    });

    const selected = app?.selectedScreenshotJobId
      ? await prisma.screenshotJob.findFirst({
          where: { id: app.selectedScreenshotJobId, appId: internalAppId, status: "COMPLETED" },
        })
      : null;

    let job = selected;

    if (!job) {
      const jobs = await prisma.screenshotJob.findMany({
        where: { appId: internalAppId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      job = jobs.find((j) => j.framedByLocale != null) ?? null;
    }

    if (!job || !job.framedByLocale) {
      res.json({ job: null });
      return;
    }

    const effective = await getEffectiveFramed(job.id);

    res.json({
      job: {
        id: job.id,
        commitSha: job.commitSha,
        commitMessage: job.commitMessage,
        branch: job.branch,
        createdAt: job.createdAt,
        framedByLocale: effective.framedByLocale,
        revision: effective.revision,
      },
    });
  } catch (err: any) {
    logger.error(`latest-framed error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/framed-history/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const internalAppId = await resolveInternalAppId(req.params.appId as string);

    if (!internalAppId) {
      res.json({ jobs: [], hasMore: false });
      return;
    }

    const kind = req.query.kind === "cpp" || req.query.kind === "real" ? req.query.kind : "all";
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 5));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const jobs = await prisma.screenshotJob.findMany({
      where: {
        appId: internalAppId,
        status: "COMPLETED",
        framedByLocale: { not: Prisma.JsonNull },
        ...(kind === "cpp" ? { branch: "cpp" } : kind === "real" ? { branch: { not: "cpp" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit + 1,
    });

    const hasMore = jobs.length > limit;
    const page = jobs.slice(0, limit);

    const withEffective = await Promise.all(
      page.map(async (j) => {
        const effective = await getEffectiveFramed(j.id);

        return {
          id: j.id,
          commitSha: j.commitSha,
          commitMessage: j.commitMessage,
          branch: j.branch,
          createdAt: j.createdAt,
          framedByLocale: effective.framedByLocale,
          revision: effective.revision,
        };
      }),
    );

    res.json({ jobs: withEffective, hasMore });
  } catch (err: any) {
    logger.error(`framed-history error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});
