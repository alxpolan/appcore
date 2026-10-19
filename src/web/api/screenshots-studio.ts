import { Router, Request, Response } from "express";
import { logger } from "../../config";
import { requireAuth, loadTeamRole, requireWriteRole } from "../auth";
import { resolveInternalAppId } from "../lib/resolve-app";
import {
  createStudioPreset,
  deleteStudioPreset,
  deleteStudioRevision,
  getStudioData,
  listStudioPresets,
  normalizeStudioStyle,
  renderStudioRevision,
  setActiveStudioRevision,
  updateStudioPreset,
  type StudioStyle,
} from "../../services/screenshot-studio";

type StudioStylePatch = Partial<StudioStyle>;

interface StudioSaveInput {
  titles: Record<string, string>;
  styles?: Record<string, StudioStylePatch>;
}

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];

export const studioRouter = Router();

function parseRevisionLocales(body: unknown): Record<string, StudioSaveInput> | null {
  const locales = (body as { locales?: unknown }).locales;

  if (!locales || typeof locales !== "object") return null;

  const normalized: Record<string, StudioSaveInput> = {};

  for (const [locale, save] of Object.entries(
    locales as Record<string, { titles?: Record<string, string>; styles?: Record<string, StudioStylePatch> }>,
  )) {
    normalized[locale] = { titles: save?.titles ?? {}, styles: save?.styles };
  }

  return normalized;
}

studioRouter.get("/screenshots/studio/:jobId", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await getStudioData(req.params.jobId as string));
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    logger.error(`studio data error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.post("/screenshots/studio/:jobId/revisions", writeAuth, async (req: Request, res: Response) => {
  try {
    const { name, style } = req.body as { name?: string; style?: unknown };
    const normalizedLocales = parseRevisionLocales(req.body);

    if (!normalizedLocales) {
      res.status(400).json({ error: "locales is required" });
      return;
    }

    res.json(
      await renderStudioRevision({
        jobId: req.params.jobId as string,
        name,
        style: normalizeStudioStyle(style),
        locales: normalizedLocales,
        pusher: req.user?.userId ?? null,
      }),
    );
  } catch (err: any) {
    const status = err.message.includes("not found") || err.message.includes("Invalid") ? 404 : 500;
    logger.error(`studio revision error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.post("/screenshots/studio/:jobId/revisions/stream", writeAuth, async (req: Request, res: Response) => {
  try {
    const { name, style } = req.body as { name?: string; style?: unknown };
    const normalizedLocales = parseRevisionLocales(req.body);

    if (!normalizedLocales) {
      res.status(400).json({ error: "locales is required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    const write = (obj: unknown) => {
      if (closed || res.writableEnded) return;

      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        closed = true;
      }
    };

    const heartbeat = setInterval(() => write({ heartbeat: true }), 15000);

    try {
      const result = await renderStudioRevision({
        jobId: req.params.jobId as string,
        name,
        style: normalizeStudioStyle(style),
        locales: normalizedLocales,
        onProgress: (event) => write(event),
        pusher: req.user?.userId ?? null,
      });
      write({ result });
    } catch (err: any) {
      logger.error(`studio revision stream error: ${err.message}`);
      write({ error: err.message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  } catch (err: any) {
    if (!res.headersSent) {
      const status = err.message.includes("not found") || err.message.includes("Invalid") ? 404 : 500;
      logger.error(`studio revision stream error: ${err.message}`);
      res.status(status).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

studioRouter.patch("/screenshots/studio/:jobId/active-revision", writeAuth, async (req: Request, res: Response) => {
  try {
    const { revisionId } = req.body as { revisionId?: string | null };

    if (revisionId !== null && typeof revisionId !== "string") {
      res.status(400).json({ error: "revisionId must be a string or null" });
      return;
    }

    await setActiveStudioRevision(req.params.jobId as string, revisionId);

    res.json({ ok: true });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    logger.error(`studio activate error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.delete("/screenshots/studio/revisions/:revisionId", writeAuth, async (req: Request, res: Response) => {
  try {
    res.json(await deleteStudioRevision(req.params.revisionId as string));
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    logger.error(`studio delete revision error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.get("/screenshots/presets/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const internalAppId = await resolveInternalAppId(req.params.appId as string);

    if (!internalAppId) {
      res.json({ presets: [] });
      return;
    }

    res.json({ presets: await listStudioPresets(internalAppId) });
  } catch (err: any) {
    logger.error(`studio presets error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

studioRouter.post("/screenshots/presets/:appId", writeAuth, async (req: Request, res: Response) => {
  try {
    const internalAppId = await resolveInternalAppId(req.params.appId as string);

    if (!internalAppId) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const { name, style } = req.body as { name?: string; style?: unknown };

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    res.json({ preset: await createStudioPreset(internalAppId, name, normalizeStudioStyle(style)) });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : err.message.includes("already exists") ? 409 : 500;
    logger.error(`studio create preset error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.patch("/screenshots/presets/:presetId", writeAuth, async (req: Request, res: Response) => {
  try {
    const { name, style } = req.body as { name?: string; style?: StudioStylePatch };

    res.json({ preset: await updateStudioPreset(req.params.presetId as string, { name, style }) });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : err.message.includes("already exists") ? 409 : 500;
    logger.error(`studio update preset error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

studioRouter.delete("/screenshots/presets/:presetId", writeAuth, async (req: Request, res: Response) => {
  try {
    await deleteStudioPreset(req.params.presetId as string);

    res.json({ ok: true });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    logger.error(`studio delete preset error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});
