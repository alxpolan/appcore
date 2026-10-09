import { prisma, logger } from "../config";

export type ActivitySource = "mcp" | "web" | "system";
export type ActivityStatus = "success" | "error";

export interface LogActivityInput {
  teamId: string;
  userId?: string | null;
  source: ActivitySource;
  actor?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  details?: unknown;
  status?: ActivityStatus;
  error?: string | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Persists one audit entry. Never throws: logging must not break the action. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        teamId: input.teamId,
        userId: input.userId ?? null,
        source: input.source,
        actor: input.actor ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: truncate(input.summary, 500),
        details: input.details === undefined ? null : truncate(JSON.stringify(input.details), 8000),
        status: input.status ?? "success",
        error: input.error?.slice(0, 1000) ?? null,
      },
    });
  } catch (err) {
    logger.warn("[activity-log] failed to persist entry", { err: String((err as any)?.message ?? err) });
  }
}
