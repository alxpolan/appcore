import { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../../config";
import { createMcpServer } from "./server";

export function createMcpHandler() {
  return async (req: Request, res: Response) => {
    const userId = (req as any).mcpUserId as string;

    try {
      const server = createMcpServer(userId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("MCP handler error", err);

      if (!res.headersSent) {
        res.status(500).json({ error: "MCP: Internal server error" });
      }
    }
  };
}
