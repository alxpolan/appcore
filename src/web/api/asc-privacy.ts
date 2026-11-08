import { prisma, env } from "../../config";
import { bundleAccess } from "../auth";
import { ascRouter } from "./asc-versions";
import { handle } from "./asc-shared";
import {
  createAppDataUsage,
  dataUsagePurposesUrl,
  deleteAppDataUsage,
  getDataUsagePublishState,
  irisFetch,
  listAppDataUsages,
  listDataUsageCategories,
  resolveIrisSession,
} from "../../services/asc-privacy";

async function resolveAdamId(bundleId: string): Promise<string | null> {
  const app = await prisma.app.findUnique({ where: { bundleId }, select: { trackId: true } });

  if (!app?.trackId) return null;

  return String(app.trackId);
}

async function catalogIds(session: ReturnType<typeof resolveIrisSession>, adamId: string, url: string) {
  const data = await irisFetch(session, adamId, "GET", url);

  return ((data?.data ?? []) as any[]).map((entry) => {
    if (typeof entry?.id !== "string") {
      throw new Error("ASC iris catalog response has an entry without an id");
    }

    return entry.id;
  });
}

ascRouter.get(
  "/privacy/data-usages",
  bundleAccess("query"),
  handle("listAppDataUsages", async (req, res) => {
    const bundleId = req.query.bundleId as string;

    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }

    const adamId = await resolveAdamId(req.bundleApp!.bundleId);

    if (!adamId) {
      res.status(400).json({ error: "App has no iTunes track ID yet - sync the app first" });
      return;
    }

    let session: ReturnType<typeof resolveIrisSession>;
    try {
      session = resolveIrisSession(env);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Apple web session is not configured" });

      return;
    }

    const [usages, publishState] = await Promise.all([
      listAppDataUsages(session, adamId),
      getDataUsagePublishState(session, adamId),
    ]);

    res.json({ usages, publishState });
  }),
);

ascRouter.get(
  "/privacy/catalogs",
  bundleAccess("query"),
  handle("getPrivacyCatalogs", async (req, res) => {
    const bundleId = req.query.bundleId as string;

    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }

    const adamId = await resolveAdamId(req.bundleApp!.bundleId);

    if (!adamId) {
      res.status(400).json({ error: "App has no iTunes track ID yet - sync the app first" });
      return;
    }

    let session: ReturnType<typeof resolveIrisSession>;
    try {
      session = resolveIrisSession(env);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Apple web session is not configured" });

      return;
    }

    const [categories, purposes] = await Promise.all([
      listDataUsageCategories(session, adamId),
      catalogIds(session, adamId, dataUsagePurposesUrl()),
    ]);

    res.json({ categories, purposes });
  }),
);

ascRouter.post(
  "/privacy/data-usages",
  bundleAccess("body"),
  handle("createAppDataUsage", async (req, res) => {
    const { bundleId, categoryId, purposeId, dataProtectionId } = req.body as {
      bundleId?: string;
      categoryId?: string;
      purposeId?: string;
      dataProtectionId?: string;
    };

    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }

    const adamId = await resolveAdamId(req.bundleApp!.bundleId);

    if (!adamId) {
      res.status(400).json({ error: "App has no iTunes track ID yet - sync the app first" });
      return;
    }

    let session: ReturnType<typeof resolveIrisSession>;
    try {
      session = resolveIrisSession(env);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Apple web session is not configured" });

      return;
    }

    try {
      res.status(201).json(await createAppDataUsage(session, adamId, categoryId ?? "", purposeId, dataProtectionId));
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Invalid data usage" });

      return;
    }
  }),
);

ascRouter.delete(
  "/privacy/data-usages/:id",
  bundleAccess("query"),
  handle("deleteAppDataUsage", async (req, res) => {
    const { id } = req.params;

    if (typeof id !== "string" || !id) {
      res.status(400).json({ error: "usage id is required" });
      return;
    }

    const adamId = await resolveAdamId(req.bundleApp!.bundleId);

    if (!adamId) {
      res.status(400).json({ error: "App has no iTunes track ID yet - sync the app first" });
      return;
    }

    let session: ReturnType<typeof resolveIrisSession>;
    try {
      session = resolveIrisSession(env);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Apple web session is not configured" });

      return;
    }

    await deleteAppDataUsage(session, adamId, id);

    res.json({ ok: true });
  }),
);
