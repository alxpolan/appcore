import { prisma } from "../../config";

/**
 * Resolves any app reference the frontend might hold to the internal app id:
 * the internal cuid itself, the numeric ASC trackId, or a bundle id.
 */
export async function resolveInternalAppId(ref: string): Promise<string | null> {
  if (/^\d+$/.test(ref)) {
    const app = await prisma.app.findFirst({ where: { trackId: BigInt(ref) }, select: { id: true } });
    return app?.id ?? null;
  }
  if (ref.includes(".")) {
    const app = await prisma.app.findUnique({ where: { bundleId: ref }, select: { id: true } });
    return app?.id ?? null;
  }
  const app = await prisma.app.findUnique({ where: { id: ref }, select: { id: true } });
  return app?.id ?? null;
}
