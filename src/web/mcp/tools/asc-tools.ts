import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscReadTools } from "./asc-tools-read";
import { registerAscWriteTools } from "./asc-tools-write";

export function registerAscTools(server: McpServer, userId: string) {
  registerAscReadTools(server, userId);
  registerAscWriteTools(server, userId);
}
