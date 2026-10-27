import { Request, Response, NextFunction } from "express";
import { env, prisma, logger } from "../../config";

function rejectUnauthorized(req: Request, res: Response) {
  const base = `${req.protocol}://${req.get("host")}`;

  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource-admin"`,
  );
  res.status(401).json({ error: "Unauthorized" });
}

export async function adminMcpAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    rejectUnauthorized(req, res);

    return;
  }

  const key = header.slice(7).trim();

  if (!key) {
    rejectUnauthorized(req, res);

    return;
  }

  try {
    if (env.ADMIN_MCP_TOKEN && key === env.ADMIN_MCP_TOKEN) {
      const admin = await prisma.user.findFirst({
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      
      (req as any).adminMcpUserId = admin?.id ?? null;
      next();

      return;
    }

    const oauthToken = await prisma.oAuthToken.findUnique({
      where: { accessToken: key },
    });

    if (oauthToken) {
      const user = await prisma.user.findUnique({
        where: { id: oauthToken.userId },
        select: { id: true, role: true },
      });

      if (user?.role === "ADMIN") {
        (req as any).adminMcpUserId = user.id;
        next();

        return;
      }
    }

    rejectUnauthorized(req, res);
  } catch (err) {
    logger.error("Admin MCP auth error", err);
    res.status(500).json({ error: "Admin MCP: Internal auth error" });
  }
}
