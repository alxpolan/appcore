import { Router } from "express";
import { prisma } from "../../config";
import { requireAuth } from "../auth";

export const activityRouter = Router();
activityRouter.use(requireAuth);

function parseDetails(details: string | null): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

// GET /api/activity?source=mcp&q=campaign&action=ads.&from=..&to=..&limit=50&offset=0
activityRouter.get("/", async (req, res) => {
  const teamId = req.user!.teamId;
  const { source, action, q, from, to, entityType, entityId } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where: any = { teamId };
  if (source === "mcp" || source === "web" || source === "system") where.source = source;
  if (typeof entityType === "string" && entityType.trim() !== "") where.entityType = entityType.trim();
  if (typeof entityId === "string" && entityId.trim() !== "") where.entityId = entityId.trim();
  if (typeof action === "string" && action.trim() !== "") where.action = { contains: action.trim() };
  if (typeof q === "string" && q.trim() !== "") {
    const needle = q.trim();
    where.OR = [
      { summary: { contains: needle } },
      { action: { contains: needle } },
      { actor: { contains: needle } },
      { entityId: { contains: needle } },
    ];
  }
  if (typeof from === "string" && from !== "") {
    const date = new Date(from);
    if (!Number.isNaN(date.getTime())) where.createdAt = { ...(where.createdAt ?? {}), gte: date };
  }
  if (typeof to === "string" && to !== "") {
    const date = new Date(to);
    if (!Number.isNaN(date.getTime())) where.createdAt = { ...(where.createdAt ?? {}), lte: date };
  }

  const [total, entries] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        source: true,
        actor: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        details: true,
        status: true,
        error: true,
        createdAt: true,
      },
    }),
  ]);
  res.json({ entries: entries.map((e) => ({ ...e, details: parseDetails(e.details) })), total });
});
