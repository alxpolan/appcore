import { Router, Request, Response } from "express";
import { prisma } from "../../config/database.js";
import { notificationService } from "../../services/notifications/notification.js";
import { logger } from "../../config/logger.js";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { deviceToken, bundleId } = req.body;

    if (!deviceToken) {
      return res.status(400).json({ error: "deviceToken is required" });
    }

    const userId = req.user?.userId ?? null;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const existing = await prisma.deviceToken.findUnique({
      where: { token: deviceToken },
      select: { userId: true },
    });

    if (existing && existing.userId && existing.userId !== userId) {
      return res.status(409).json({ error: "Token already registered" });
    }

    await prisma.deviceToken.upsert({
      where: { token: deviceToken },
      create: {
        token: deviceToken,
        userId,
        bundleId: bundleId || null,
        platform: "ios",
        isActive: true,
      },
      update: {
        userId,
        bundleId: bundleId || null,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    logger.info(`[PUSH] Device registered: ${deviceToken.substring(0, 8)}...`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(`[PUSH] Registration error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/unregister", async (req: Request, res: Response) => {
  try {
    const { deviceToken } = req.body;

    if (!deviceToken) {
      return res.status(400).json({ error: "deviceToken is required" });
    }

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    await prisma.deviceToken.updateMany({
      where: { token: deviceToken, userId },
      data: { isActive: false },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`[PUSH] Unregister error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/send", async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "System admin required" });
    }

    const { title, body, category, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
    }

    const result = await notificationService.pushToAll({
      title,
      body,
      category,
      data,
    });

    res.json(result);
  } catch (error: any) {
    logger.error(`[PUSH] Send error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/test", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await notificationService.pushToUser(userId, {
      title: "🧪 Test Notification",
      body: "Push notifications are working!",
      category: "JOB_COMPLETE",
    });

    res.json(result);
  } catch (error: any) {
    logger.error(`[PUSH] Test error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.get("/devices", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const where = req.user?.role === "ADMIN" ? { isActive: true } : { isActive: true, userId };
    const devices = await prisma.deviceToken.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(devices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/logs", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const limit = parseInt(req.query.limit as string) || 50;

    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "System admin required" });
    }

    const logs = await prisma.pushNotificationLog.findMany({
      orderBy: { sentAt: "desc" },
      take: limit,
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
