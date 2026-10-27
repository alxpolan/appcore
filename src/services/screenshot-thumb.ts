import path from "path";
import fs from "fs";
import sharp from "sharp";
import type { Request, Response } from "express";
import { logger } from "../config";

const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots");
const THUMBS_DIR = path.join(SCREENSHOTS_DIR, ".thumbs");
const ALLOWED_WIDTHS = new Set([200, 300, 400, 600, 800]);

const inflight = new Map<string, Promise<void>>();

async function generateThumb(srcPath: string, destPath: string, width: number) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.${process.pid}.tmp`;

  await sharp(srcPath).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmpPath);
  fs.renameSync(tmpPath, destPath);
}

export async function serveScreenshotThumb(req: Request, res: Response) {
  const widthParam = Number(req.params.width);

  if (!ALLOWED_WIDTHS.has(widthParam)) {
    res.status(400).send(`Unsupported width. Allowed: ${[...ALLOWED_WIDTHS].join(", ")}`);

    return;
  }

  const relPath = (req.params[0] || "").replace(/^\/+/, "");

  if (!relPath || relPath.includes("..")) {
    res.status(400).send("Invalid path");

    return;
  }

  const srcPath = path.join(SCREENSHOTS_DIR, relPath);

  if (!srcPath.startsWith(SCREENSHOTS_DIR + path.sep)) {
    res.status(400).send("Invalid path");

    return;
  }

  if (!fs.existsSync(srcPath)) {
    res.status(404).send("Not found");

    return;
  }

  const destPath = path.join(THUMBS_DIR, String(widthParam), `${relPath}.webp`);

  if (!destPath.startsWith(THUMBS_DIR + path.sep)) {
    res.status(400).send("Invalid path");

    return;
  }

  try {
    if (!fs.existsSync(destPath)) {
      let pending = inflight.get(destPath);

      if (!pending) {
        pending = generateThumb(srcPath, destPath, widthParam).finally(() => inflight.delete(destPath));
        inflight.set(destPath, pending);
      }

      await pending;
    }

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(destPath);
  } catch (err: any) {
    logger.error(`Thumbnail generation failed for ${relPath}: ${err.message}`);
    res.status(500).send("Thumbnail generation failed");
  }
}
