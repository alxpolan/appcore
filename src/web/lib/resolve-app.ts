import { prisma } from "../../config";

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
