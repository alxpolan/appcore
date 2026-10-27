import { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../../config";
import { createAdminMcpServer } from "./server";

export function createAdminMcpHandler() {
  return async (req: Request, res: Response) => {
    const adminUserId = (req as any).adminMcpUserId as string | null;

    try {
      const server = createAdminMcpServer(adminUserId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("Admin MCP handler error", err);

      if (!res.headersSent) {
        res.status(500).json({ error: "Admin MCP: Internal server error" });
      }
    }
  };
}
