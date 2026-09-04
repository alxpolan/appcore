import { Request, Response, NextFunction } from "express";
import { prisma, logger } from "../../config";

const MCP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function rejectUnauthorized(req: Request, res: Response) {
  const base = `${req.protocol}://${req.get("host")}`;
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
  );
  res.status(401).json({ error: "Unauthorized" });
}

export async function mcpAuth(req: Request, res: Response, next: NextFunction) {
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
    const oauthToken = await prisma.oAuthToken.findUnique({
      where: { accessToken: key },
    });

    if (oauthToken && Date.now() - oauthToken.createdAt.getTime() > MCP_TOKEN_TTL_MS) {
      await prisma.oAuthToken.delete({ where: { accessToken: key } }).catch(() => {});
      rejectUnauthorized(req, res);
      return;
    }

    if (oauthToken) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: oauthToken.userId },
        orderBy: { createdAt: "asc" },
      });

      const tokenSettings = membership
        ? await prisma.teamSettings.findUnique({
            where: { teamId: membership.teamId },
          })
        : null;

      if (tokenSettings?.mcpEnabled) {
        (req as any).mcpUserId = oauthToken.userId;
        next();
        return;
      }
    }

    rejectUnauthorized(req, res);
  } catch (err) {
    logger.error("MCP auth error", err);
    res.status(500).json({ error: "MCP: Internal auth error" });
  }
}
