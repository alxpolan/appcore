import { bundleAccess } from "../auth";
import {
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
  "/gamecenter/leaderboards",
  bundleAccess("query"),
  handle("gamecenter leaderboards", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });

      return;
    }

    const gcDetailId = await getGameCenterDetailId(asc, app.id);

    if (!gcDetailId) {
      res.json({ leaderboards: [], gcDetailId: null, gcEnabled: false });

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterLeaderboards`, {
      params: {
        "fields[gameCenterLeaderboards]":
          "referenceName,vendorIdentifier,defaultFormatter,archived,scoreSortType,submissionType",
        limit: 200,
      },
    });

    const leaderboards = (resp.data ?? []).map((lb: any) => ({
      id: lb.id,
      referenceName: lb.attributes?.referenceName ?? "",
      vendorIdentifier: lb.attributes?.vendorIdentifier ?? "",
      defaultFormatter: lb.attributes?.defaultFormatter ?? "INTEGER",
      archived: lb.attributes?.archived ?? false,
      scoreSortType: lb.attributes?.scoreSortType ?? "HIGH_TO_LOW",
      submissionType: lb.attributes?.submissionType ?? "INDIVIDUAL",
    }));

    res.json({ leaderboards, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/leaderboards",
  bundleAccess("body"),
  handle("create leaderboard", async (req, res) => {
    const { referenceName, vendorIdentifier, defaultFormatter, scoreSortType, submissionType } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
      defaultFormatter?: string;
      scoreSortType?: string;
      submissionType?: string;
    };

    if (!referenceName || !vendorIdentifier) {
      res.status(400).json({ error: "referenceName, vendorIdentifier required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });

      return;
    }

    const { data: resp } = await asc.client.post("/gameCenterLeaderboards", {
      data: {
        type: "gameCenterLeaderboards",
        attributes: {
          referenceName,
          vendorIdentifier,
          defaultFormatter: defaultFormatter ?? "INTEGER",
          scoreSortType: scoreSortType ?? "HIGH_TO_LOW",
          submissionType: submissionType ?? "INDIVIDUAL",
        },
        relationships: {
          gameCenterDetail: {
            data: { type: "gameCenterDetails", id: gcDetailId },
          },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
      defaultFormatter: resp.data.attributes?.defaultFormatter ?? defaultFormatter ?? "INTEGER",
      archived: resp.data.attributes?.archived ?? false,
      scoreSortType: resp.data.attributes?.scoreSortType ?? scoreSortType ?? "HIGH_TO_LOW",
      submissionType: resp.data.attributes?.submissionType ?? submissionType ?? "INDIVIDUAL",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/leaderboards/:id",
  bundleAccess("body"),
  handle("update leaderboard", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName, archived } = req.body as {
      referenceName?: string;
      archived?: boolean;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, unknown> = {};

    if (referenceName !== undefined) attrs.referenceName = referenceName;
    if (archived !== undefined) attrs.archived = archived;

    await asc.client.patch(`/gameCenterLeaderboards/${id}`, {
      data: { type: "gameCenterLeaderboards", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/leaderboards/:id",
  bundleAccess("query"),
  handle("delete leaderboard", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterLeaderboards/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/leaderboards/:id/localizations",
  bundleAccess("query"),
  handle("leaderboard localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterLeaderboards/${id}/localizations`, {
      params: {
        "fields[gameCenterLeaderboardLocalizations]": "locale,name,formatterSuffix,formatterSuffixSingular",
      },
    });

    const localizations = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
      formatterSuffix: l.attributes?.formatterSuffix ?? "",
      formatterSuffixSingular: l.attributes?.formatterSuffixSingular ?? "",
    }));

    res.json(localizations);
  }),
);

ascRouter.post(
  "/gamecenter/leaderboard-localizations",
  bundleAccess("body"),
  handle("create leaderboard localization", async (req, res) => {
    const { leaderboardId, locale, name, formatterSuffix, formatterSuffixSingular } = req.body as {
      leaderboardId: string;
      locale: string;
      name: string;
      formatterSuffix?: string;
      formatterSuffixSingular?: string;
    };

    if (!leaderboardId || !locale || !name) {
      res.status(400).json({ error: "leaderboardId, locale, name required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", leaderboardId, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, string> = { locale, name };
    if (formatterSuffix) attrs.formatterSuffix = formatterSuffix;
    if (formatterSuffixSingular) attrs.formatterSuffixSingular = formatterSuffixSingular;

    const { data: resp } = await asc.client.post("/gameCenterLeaderboardLocalizations", {
      data: {
        type: "gameCenterLeaderboardLocalizations",
        attributes: attrs,
        relationships: {
          gameCenterLeaderboard: {
            data: { type: "gameCenterLeaderboards", id: leaderboardId },
          },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale,
      name: resp.data.attributes?.name ?? name,
      formatterSuffix: resp.data.attributes?.formatterSuffix ?? "",
      formatterSuffixSingular: resp.data.attributes?.formatterSuffixSingular ?? "",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/leaderboard-localizations/:id",
  bundleAccess("body"),
  handle("update leaderboard localization", async (req, res) => {
    const id = req.params.id as string;
    const { name, formatterSuffix, formatterSuffixSingular } = req.body as {
      name?: string;
      formatterSuffix?: string;
      formatterSuffixSingular?: string;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "leaderboard", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, string> = {};

    if (name !== undefined) attrs.name = name;
    if (formatterSuffix !== undefined) attrs.formatterSuffix = formatterSuffix;
    if (formatterSuffixSingular !== undefined) attrs.formatterSuffixSingular = formatterSuffixSingular;

    await asc.client.patch(`/gameCenterLeaderboardLocalizations/${id}`, {
      data: {
        type: "gameCenterLeaderboardLocalizations",
        id,
        attributes: attrs,
      },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/leaderboard-localizations/:id",
  bundleAccess("query"),
  handle("delete leaderboard localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "leaderboard", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterLeaderboardLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/achievements",
  bundleAccess("query"),
  handle("gamecenter achievements", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });

      return;
    }

    const gcDetailId = await getGameCenterDetailId(asc, app.id);

    if (!gcDetailId) {
      res.json({ achievements: [], gcDetailId: null, gcEnabled: false });

      return;
    }

    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterAchievements`, {
      params: {
        "fields[gameCenterAchievements]": "referenceName,vendorIdentifier,points,showBeforeEarned,repeatable,archived",
        limit: 200,
      },
    });

    const achievements = (resp.data ?? []).map((a: any) => ({
      id: a.id,
      referenceName: a.attributes?.referenceName ?? "",
      vendorIdentifier: a.attributes?.vendorIdentifier ?? "",
      points: a.attributes?.points ?? 0,
      showBeforeEarned: a.attributes?.showBeforeEarned ?? true,
      repeatable: a.attributes?.repeatable ?? false,
      archived: a.attributes?.archived ?? false,
    }));

    res.json({ achievements, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/achievements",
  bundleAccess("body"),
  handle("create achievement", async (req, res) => {
    const { referenceName, vendorIdentifier, points, showBeforeEarned, repeatable } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
      points: number;
      showBeforeEarned: boolean;
      repeatable: boolean;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });

      return;
    }

    const { data: resp } = await asc.client.post("/gameCenterAchievements", {
      data: {
        type: "gameCenterAchievements",
        attributes: { referenceName, vendorIdentifier, points, showBeforeEarned, repeatable },
        relationships: {
          gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
      points: resp.data.attributes?.points ?? points,
      showBeforeEarned: resp.data.attributes?.showBeforeEarned ?? showBeforeEarned,
      repeatable: resp.data.attributes?.repeatable ?? repeatable,
      archived: false,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/achievements/:id",
  bundleAccess("body"),
  handle("update achievement", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName, points, showBeforeEarned, repeatable, archived } = req.body as {
      referenceName?: string;
      points?: number;
      showBeforeEarned?: boolean;
      repeatable?: boolean;
      archived?: boolean;
    };

    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    const attrs: Record<string, unknown> = {};

    if (referenceName !== undefined) attrs.referenceName = referenceName;
    if (points !== undefined) attrs.points = points;
    if (showBeforeEarned !== undefined) attrs.showBeforeEarned = showBeforeEarned;
    if (repeatable !== undefined) attrs.repeatable = repeatable;
    if (archived !== undefined) attrs.archived = archived;

    await asc.client.patch(`/gameCenterAchievements/${id}`, {
      data: { type: "gameCenterAchievements", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/achievements/:id",
  bundleAccess("query"),
  handle("delete achievement", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);

      return;
    }

    await asc.client.delete(`/gameCenterAchievements/${id}`);

    res.json({ ok: true });
  }),
);
