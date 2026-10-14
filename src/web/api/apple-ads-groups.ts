import { Router } from "express";
import { prisma } from "../../config";
import { bundleAccess } from "../auth";

export const appleAdsGroupsRouter = Router();

appleAdsGroupsRouter.get("/campaign-groups", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const groups = await prisma.appleAdsCampaignGroup.findMany({
      where: { appId: ownApp.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appleAdsGroupsRouter.post("/campaign-groups", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const max = await prisma.appleAdsCampaignGroup.aggregate({
      where: { appId: ownApp.id },
      _max: { sortOrder: true },
    });
    const group = await prisma.appleAdsCampaignGroup.create({
      data: { appId: ownApp.id, name, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function loadOwnedCampaignGroup(req: any, res: any) {
  const group = await prisma.appleAdsCampaignGroup.findUnique({
    where: { id: req.params.id },
    include: { app: { select: { teamId: true } } },
  });

  if (!group) {
    res.status(404).json({ error: "Group not found" });

    return null;
  }

  if (req.user.role !== "ADMIN" && group.app.teamId !== req.user.teamId) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  return group;
}

appleAdsGroupsRouter.patch("/campaign-groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedCampaignGroup(req, res);
    if (!group) return;

    const data: { name?: string; sortOrder?: number } = {};

    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      data.name = name;
    }

    if (req.body.sortOrder != null && Number.isFinite(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }

    const updated = await prisma.appleAdsCampaignGroup.update({
      where: { id: group.id },
      data,
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ group: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appleAdsGroupsRouter.delete("/campaign-groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedCampaignGroup(req, res);
    if (!group) return;
    await prisma.appleAdsCampaignGroup.delete({ where: { id: group.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appleAdsGroupsRouter.put("/campaigns/:campaignId/group", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const externalCampaignId = req.params.campaignId as string;
    const groupId: string | null = req.body.groupId ?? null;

    if (groupId) {
      const group = await prisma.appleAdsCampaignGroup.findFirst({
        where: { id: groupId, appId: ownApp.id },
        select: { id: true },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });

      await prisma.appleAdsCampaignGroupMember.upsert({
        where: { appId_externalCampaignId: { appId: ownApp.id, externalCampaignId } },
        create: { appId: ownApp.id, externalCampaignId, groupId },
        update: { groupId },
      });
    } else {
      await prisma.appleAdsCampaignGroupMember.deleteMany({
        where: { appId: ownApp.id, externalCampaignId },
      });
    }

    res.json({ ok: true, groupId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
