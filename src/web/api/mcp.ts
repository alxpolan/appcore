import { Router } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamRole, loadTeamSettings, requireWriteRole } from "../auth";

export const mcpRouter = Router();

mcpRouter.use(requireAuth, loadTeamRole, requireWriteRole);

mcpRouter.get("/config", loadTeamSettings, async (req, res) => {
  try {
    res.json({ mcpEnabled: req.teamSettings?.mcpEnabled ?? false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

mcpRouter.put("/config", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const { mcpEnabled } = req.body as { mcpEnabled?: boolean };
    const teamId = req.user!.teamId;
    const data: Record<string, any> = {};
    if (mcpEnabled !== undefined) data.mcpEnabled = Boolean(mcpEnabled);

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: { teamId, ...data },
      update: data,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

mcpRouter.get("/oauth-clients", async (req, res) => {
  try {
    const where = req.user!.role === "ADMIN" ? {} : { userId: req.user!.userId };
    const clients = await prisma.oAuthClient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, clientId: true, name: true, redirectUris: true, userId: true, createdAt: true },
    });

    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

mcpRouter.post("/oauth-clients", async (req, res) => {
  try {
    const { name, redirectUris } = req.body as { name?: string; redirectUris?: string[] };

    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const clientSecret = randomBytes(24).toString("hex");
    const clientSecretHash = await bcrypt.hash(clientSecret, 10);
    const client = await prisma.oAuthClient.create({
      data: {
        clientId: `marteso_${randomBytes(12).toString("hex")}`,
        clientSecret: clientSecretHash,
        name: name.trim(),
        userId: req.user!.userId,
        redirectUris: redirectUris ?? [],
      },
    });

    res.json({
      id: client.id,
      clientId: client.clientId,
      clientSecret,
      name: client.name,
      redirectUris: client.redirectUris,
      createdAt: client.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

mcpRouter.delete("/oauth-clients/:id", async (req, res) => {
  try {
    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
    });

    if (!client) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (client.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    await prisma.oAuthClient.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
