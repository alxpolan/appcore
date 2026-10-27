import { prisma } from "../config";

export const ADMIN_GRANT_CUSTOMER = "admin";
export const PRO_STATUSES = ["active", "on_trial", "paused"] as const;

type SubLike =
  | {
      lemonCustomerId?: string | null;
      status?: string | null;
      endsAt?: Date | string | null;
    }
  | null
  | undefined;

export function isAdminGrant(sub: SubLike): boolean {
  return !!sub && sub.lemonCustomerId === ADMIN_GRANT_CUSTOMER;
}

export const FREE_KEYWORDS_PER_APP = 50;

export async function isTeamPro(teamId: string | null | undefined): Promise<boolean> {
  if (!teamId) return false;
  const sub = await prisma.subscription.findUnique({
    where: { teamId },
    select: { status: true },
  });

  return !!sub && (PRO_STATUSES as readonly string[]).includes(sub.status);
}

export function isGrantExpired(sub: SubLike, now: Date = new Date()): boolean {
  if (!isAdminGrant(sub) || !sub?.endsAt) return false;

  return new Date(sub.endsAt) <= now;
}

export function isPermanentGrant(sub: SubLike): boolean {
  return isAdminGrant(sub) && !sub?.endsAt;
}

export async function expireStaleAdminGrants(): Promise<number> {
  const result = await prisma.subscription.updateMany({
    where: {
      lemonCustomerId: ADMIN_GRANT_CUSTOMER,
      status: { in: [...PRO_STATUSES] },
      endsAt: { not: null, lte: new Date() },
    },
    data: { status: "expired" },
  });

  return result.count;
}
