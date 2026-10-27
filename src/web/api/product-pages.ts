import { Router, type Request, type Response, type RequestHandler } from "express";
import { createHash } from "crypto";
import sharp from "sharp";
import axios from "../../services/utils/http";
import { logger } from "../../config";
import { ascClientForUser as ascClientForUserOrNull } from "../../services/asc-client";
import { requireAuth, bundleAccess } from "../auth";
import type {
  AppStoreConnectClient,
  ASCCustomProductPage,
  ASCCustomProductPageLocalization,
  ASCCustomProductPageVersion,
} from "../../services/appstore-connect";
import {
  buildScreenshotAssetUrl,
  detectDisplayTypeFromDimensions,
  isEditableCppVersionState,
} from "../../services/utils/custom-product-pages";

export const productPagesRouter = Router();

productPagesRouter.use(requireAuth);

const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

async function ascClientForUser(userId: string): Promise<AppStoreConnectClient> {
  const asc = await ascClientForUserOrNull(userId);
  if (!asc) throw new Error("App Store Connect credentials missing.");

  return asc;
}

function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing route param: ${name}`);

  return value;
}

function handle(label: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const ascErrors = err?.response?.data?.errors;

      logger.error(`ProductPages ${label} failed`, ascErrors ?? err);
      const detail =
        ascErrors?.map((e: any) => e.detail ?? e.title).filter(Boolean).join("; ") ||
        err?.message ||
        "An error occurred. Please try again.";

      res.status(500).json({ error: detail, _debug: { label, ascErrors: ascErrors ?? null } });
    }
  };
}

function toPage(p: ASCCustomProductPage) {
  return {
    id: p.id,
    name: p.attributes.name,
    url: p.attributes.url ?? null,
    visible: p.attributes.visible ?? null,
  };
}

function toVersion(v: ASCCustomProductPageVersion) {
  return {
    id: v.id,
    version: v.attributes.version ?? null,
    state: v.attributes.state ?? null,
    deepLink: v.attributes.deepLink ?? null,
    isEditable: isEditableCppVersionState(v.attributes.state),
  };
}

function byVersionDesc(
  a: ASCCustomProductPageVersion,
  b: ASCCustomProductPageVersion,
): number {
  return (parseInt(b.attributes.version ?? "0", 10) || 0) - (parseInt(a.attributes.version ?? "0", 10) || 0);
}

function toLocalization(l: ASCCustomProductPageLocalization) {
  return {
    id: l.id,
    locale: l.attributes.locale,
    promotionalText: l.attributes.promotionalText ?? "",
  };
}

async function resolveAscAppId(req: Request, res: Response, asc: AppStoreConnectClient): Promise<string | null> {
  const app = await asc.getApp(req.bundleApp!.bundleId);

  if (!app) {
    res.status(404).json({ error: "App not found in App Store Connect" });
    return null;
  }

  return app.id;
}

productPagesRouter.get(
  "/",
  bundleAccess("query"),
  handle("listPages", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);
    const appId = await resolveAscAppId(req, res, asc);
    if (!appId) return;

    const pages = await asc.listCustomProductPages(appId);
    const withVersions = await Promise.all(
      pages.map(async (p) => {
        let versions: ASCCustomProductPageVersion[] = [];
        try {
          versions = (await asc.listCustomProductPageVersions(p.id)).sort(byVersionDesc);
        } catch (err) {
          logger.warn(`ProductPages: failed to list versions for page ${p.id}`, err);
        }

        return { ...toPage(p), versions: versions.map(toVersion) };
      }),
    );

    res.json({ pages: withVersions });
  }),
);

productPagesRouter.post(
  "/",
  bundleAccess("body"),
  handle("createPage", async (req, res) => {
    const { name } = req.body as { name?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(req.bundleApp!.bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const page = await asc.createCustomProductPage(
      app.id,
      name.trim(),
      app.attributes.primaryLocale ?? "en-US",
    );

    let versions = await asc.listCustomProductPageVersions(page.id).catch(() => []);

    if (versions.length === 0) {
      const created = await asc.createCustomProductPageVersion(page.id);

      versions = [created];
    }

    res.status(201).json({ ...toPage(page), versions: versions.sort(byVersionDesc).map(toVersion) });
  }),
);

productPagesRouter.patch(
  "/:pageId",
  bundleAccess("body"),
  handle("updatePage", async (req, res) => {
    const { name, visible } = req.body as { name?: string; visible?: boolean };
    const updates: { name?: string; visible?: boolean } = {};

    if (name !== undefined) {
      if (!name.trim()) {
        res.status(400).json({ error: "name must not be empty" });
        return;
      }

      updates.name = name.trim();
    }

    if (visible !== undefined) {
      if (typeof visible !== "boolean") {
        res.status(400).json({ error: "visible must be a boolean" });
        return;
      }

      updates.visible = visible;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "nothing to update" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const page = await asc.updateCustomProductPage(pathParam(req, "pageId"), updates);

    res.json(toPage(page));
  }),
);

productPagesRouter.delete(
  "/:pageId",
  bundleAccess("query"),
  handle("deletePage", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);

    await asc.deleteCustomProductPage(pathParam(req, "pageId"));
    res.json({ ok: true });
  }),
);

productPagesRouter.get(
  "/:pageId/versions",
  bundleAccess("query"),
  handle("listVersions", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);
    const versions = (await asc.listCustomProductPageVersions(pathParam(req, "pageId"))).sort(byVersionDesc);

    res.json({ versions: versions.map(toVersion) });
  }),
);

productPagesRouter.post(
  "/:pageId/versions",
  bundleAccess("body"),
  handle("ensureVersion", async (req, res) => {
    const { deepLink } = req.body as { deepLink?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const versions = (await asc.listCustomProductPageVersions(pathParam(req, "pageId"))).sort(byVersionDesc);
    const editable = versions.find((v) => isEditableCppVersionState(v.attributes.state));

    if (editable) {
      const version =
        deepLink !== undefined
          ? await asc.updateCustomProductPageVersion(editable.id, deepLink)
          : editable;

      res.json({ version: toVersion(version), created: false });
      return;
    }

    const created = await asc.createCustomProductPageVersion(pathParam(req, "pageId"));
    const version =
      deepLink !== undefined && deepLink !== ""
        ? await asc.updateCustomProductPageVersion(created.id, deepLink)
        : created;

    res.status(201).json({ version: toVersion(version), created: true });
  }),
);

productPagesRouter.patch(
  "/versions/:versionId",
  bundleAccess("body"),
  handle("updateVersion", async (req, res) => {
    const { deepLink } = req.body as { deepLink?: string };

    if (typeof deepLink !== "string") {
      res.status(400).json({ error: "deepLink is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const version = await asc.updateCustomProductPageVersion(pathParam(req, "versionId"), deepLink);

    res.json(toVersion(version));
  }),
);

productPagesRouter.get(
  "/versions/:versionId/localizations",
  bundleAccess("query"),
  handle("listLocalizations", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);
    const localizations = await asc.listCustomProductPageLocalizations(pathParam(req, "versionId"));

    localizations.sort((a, b) => a.attributes.locale.localeCompare(b.attributes.locale));
    res.json({ localizations: localizations.map(toLocalization) });
  }),
);

productPagesRouter.post(
  "/versions/:versionId/localizations",
  bundleAccess("body"),
  handle("createLocalization", async (req, res) => {
    const { locale } = req.body as { locale?: string };

    if (!locale || !locale.trim()) {
      res.status(400).json({ error: "locale is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    try {
      const created = await asc.createCustomProductPageLocalization(pathParam(req, "versionId"), locale.trim());

      res.status(201).json(toLocalization(created));
    } catch (err: any) {
      if (String(err?.message ?? "").includes("409")) {
        const existing = await asc.listCustomProductPageLocalizations(pathParam(req, "versionId"));
        const match = existing.find((l) => l.attributes.locale === locale.trim());

        if (match) {
          res.json(toLocalization(match));
          return;
        }
      }
      throw err;
    }
  }),
);

productPagesRouter.patch(
  "/localizations/:localizationId",
  bundleAccess("body"),
  handle("updateLocalization", async (req, res) => {
    const { promotionalText } = req.body as { promotionalText?: string };

    if (typeof promotionalText !== "string") {
      res.status(400).json({ error: "promotionalText is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const updated = await asc.updateCustomProductPageLocalization(
      pathParam(req, "localizationId"),
      promotionalText,
    );

    res.json(toLocalization(updated));
  }),
);

productPagesRouter.delete(
  "/localizations/:localizationId",
  bundleAccess("query"),
  handle("deleteLocalization", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);

    await asc.deleteCustomProductPageLocalization(pathParam(req, "localizationId"));
    res.json({ ok: true });
  }),
);

productPagesRouter.get(
  "/localizations/:localizationId/screenshots",
  bundleAccess("query"),
  handle("listScreenshots", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);
    const sets = await asc.listCustomProductPageScreenshotSets(pathParam(req, "localizationId"));
    const screenshots: Array<{
      id: string;
      displayType: string;
      url: string;
      thumbUrl: string;
      width: number;
      height: number;
    }> = [];

    for (const set of sets) {
      const items = await asc.listScreenshotsInSet(set.id);
      for (const item of items) {
        const asset = item.attributes.imageAsset;
        const ready = item.attributes.assetDeliveryState?.state === "COMPLETE";
        if (!asset || !asset.templateUrl || !ready) continue;
        screenshots.push({
          id: item.id,
          displayType: set.attributes.screenshotDisplayType,
          url: buildScreenshotAssetUrl(asset.templateUrl, asset.width, asset.height),
          thumbUrl: buildScreenshotAssetUrl(
            asset.templateUrl,
            Math.round(asset.width / 3),
            Math.round(asset.height / 3),
          ),
          width: asset.width,
          height: asset.height,
        });
      }
    }
    res.json({ screenshots });
  }),
);

productPagesRouter.post(
  "/localizations/:localizationId/screenshots",
  bundleAccess("body"),
  handle("uploadScreenshot", async (req, res) => {
    const { fileName, fileData, displayType } = req.body as {
      fileName?: string;
      fileData?: string;
      displayType?: string;
    };

    if (!fileName || !fileData) {
      res.status(400).json({ error: "fileName and fileData are required" });
      return;
    }

    const fileBytes = Buffer.from(fileData, "base64");

    if (fileBytes.length === 0 || fileBytes.length > MAX_SCREENSHOT_BYTES) {
      res.status(400).json({ error: `Screenshot must be a non-empty image up to 15 MB` });
      return;
    }

    let detected: string | null = null;
    try {
      const meta = await sharp(fileBytes).metadata();

      detected = detectDisplayTypeFromDimensions(meta.width, meta.height);
    } catch {
      res.status(400).json({ error: "fileData is not a valid image" });
      return;
    }

    const resolvedType = displayType?.trim() || detected;

    if (!resolvedType) {
      res.status(400).json({
        error:
          "Could not detect the screenshot display type from the image dimensions. Please choose one explicitly.",
      });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const localizationId = pathParam(req, "localizationId");
    const sets = await asc.listCustomProductPageScreenshotSets(localizationId);
    let set = sets.find((s) => s.attributes.screenshotDisplayType === resolvedType) ?? null;

    if (!set) {
      set = await asc.createCustomProductPageScreenshotSet(localizationId, resolvedType);
    }

    const md5 = createHash("md5").update(fileBytes).digest("hex");
    const reserved = await asc.reserveScreenshot(set.id, fileName, fileBytes.length);
    for (const op of reserved.attributes.uploadOperations) {
      const chunk = fileBytes.subarray(op.offset, op.offset + op.length);

      await axios.put(op.url, chunk, {
        headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])),
      });
    }
    await asc.commitScreenshot(reserved.id, md5);

    res.status(201).json({ id: reserved.id, displayType: resolvedType });
  }),
);

productPagesRouter.delete(
  "/screenshots/:screenshotId",
  bundleAccess("query"),
  handle("deleteScreenshot", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);

    await asc.deleteScreenshot(pathParam(req, "screenshotId"));
    res.json({ ok: true });
  }),
);

productPagesRouter.post(
  "/versions/:versionId/submit",
  bundleAccess("body"),
  handle("submitVersion", async (req, res) => {
    const asc = await ascClientForUser(req.user!.userId);
    const appId = await resolveAscAppId(req, res, asc);
    if (!appId) return;
    const version = await asc.getCustomProductPageVersion(pathParam(req, "versionId"));

    if (!isEditableCppVersionState(version.attributes.state)) {
      res.status(400).json({ error: `Version is ${version.attributes.state}, nothing to submit` });
      return;
    }

    const submissionId = await asc.submitCustomProductPageVersionForReview(appId, pathParam(req, "versionId"));

    res.json({ ok: true, submissionId });
  }),
);
