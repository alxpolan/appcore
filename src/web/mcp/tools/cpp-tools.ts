import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCppReadTools } from "./cpp-tools-reads";
import { registerCppWriteTools } from "./cpp-tools-write";
import { registerCppScreenshotTools } from "./cpp-tools-screenshots";

export function registerCppTools(server: McpServer, userId: string) {
  registerCppReadTools(server, userId);
  registerCppWriteTools(server, userId);
  registerCppScreenshotTools(server, userId);
}
