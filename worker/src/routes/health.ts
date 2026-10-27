import { Router, Request, Response } from "express";
import os from "os";
import { findFastlane } from "../fastlane-utils";

export const healthRouter = Router();

healthRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const fastlaneVersion = await findFastlane();

    res.json({
      ok: true,
      fastlaneVersion,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hostname: os.hostname(),
    });
  }
});
