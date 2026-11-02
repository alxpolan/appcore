import { Prisma } from "@prisma/client";
import { prisma } from "../src/config";

export function installStudioRenderStore(stub: (target: any, key: string, implementation: any) => void) {
  const rows = new Map<string, any>();
  const patch = (data: any) => ({ ...data, ...(data.result === Prisma.DbNull ? { result: null } : {}) });
  stub(prisma.screenshotStudioRender, "findUnique", async ({ where }: any) => {
    const row = rows.get(where.jobId); return row ? { ...row } : null;
  });
  stub(prisma.screenshotStudioRender, "create", async ({ data }: any) => {
    if (rows.has(data.jobId)) throw Object.assign(new Error("Already exists"), { code: "P2002" });
    const row = { ...patch(data), updatedAt: new Date() }; rows.set(data.jobId, row); return row;
  });
  stub(prisma.screenshotStudioRender, "updateMany", async ({ where, data }: any) => {
    const row = rows.get(where.jobId);
    if (!row || (where.operationId && row.operationId !== where.operationId) ||
      (typeof where.status === "string" && row.status !== where.status) ||
      (where.status?.not && row.status === where.status.not) ||
      (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
    Object.assign(row, patch(data), { updatedAt: data.updatedAt ?? new Date() });
    return { count: 1 };
  });
  return rows;
}
