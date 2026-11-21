import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface DefaultToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const READ_ONLY = /^(get|list|view|check)_/;
const DESTRUCTIVE = /^(delete|discard|bulk_remove|remove)_/;
const IDEMPOTENT_WRITE = /^(set|update|rename|assign|apply|reorder)_/;

function defaultToolAnnotations(name: string): DefaultToolAnnotations {
  if (READ_ONLY.test(name)) return { readOnlyHint: true, openWorldHint: false };

  if (DESTRUCTIVE.test(name)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  }

  if (IDEMPOTENT_WRITE.test(name)) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  }

  return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
}

export function withDefaultToolAnnotations(server: McpServer): McpServer {
  const original = (server.registerTool as any).bind(server);

  (server as any).registerTool = (name: string, config: any, cb: any) => {
    const annotations = { ...defaultToolAnnotations(name), ...config?.annotations };

    return original(name, { ...config, annotations }, cb);
  };

  return server;
}
