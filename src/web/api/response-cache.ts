import type { NextFunction, Request, Response } from "express";
import { ShortCache } from "../../services/utils/short-cache";

export const ADS_CACHE_TTL_MS = 120_000;

const adsCache = new ShortCache(300);

type CacheableRequest = Request & { user?: { userId: string; teamId: string } };

export function adsResponseCache() {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as CacheableRequest).user;

    if (!user) {
      next();
      return;
    }

    if (req.method !== "GET") {
      res.on("finish", () => {
        if (res.statusCode < 400) adsCache.invalidatePrefix(`ads:${user.teamId}:`);
      });
      next();
      return;
    }

    const key = `ads:${user.teamId}:${user.userId}:${req.originalUrl}`;
    const hit = adsCache.get(key);

    if (hit !== undefined) {
      res.setHeader("X-Cache", "HIT");
      res.type("application/json").send(hit);
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      if (res.statusCode < 400 && body !== undefined) {
        adsCache.set(key, JSON.stringify(body), ADS_CACHE_TTL_MS);
        res.setHeader("X-Cache", "MISS");
      }

      return originalJson(body);
    }) as typeof res.json;
    next();
  };
}
