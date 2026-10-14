import type { Request } from "express";

export function webActor(req: Request) {
  return { teamId: req.user!.teamId, userId: req.user!.userId, actor: req.user!.email };
}

export async function bestEffort<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
