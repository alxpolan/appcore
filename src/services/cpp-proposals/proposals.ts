import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import type { CppProposal } from "@prisma/client";
import type { CppKeywordGroup } from "./grouping";

export type CppProposalStatus = "draft" | "rendering" | "ready" | "applying" | "applied" | "failed";

export interface CppGroupTotals {
  spend: number;
  taps: number;
  installs: number;
  conversionRate: number | null;
  coverage: number;
}

export type CppCaptions = Record<string, Record<string, string>>;

export const CPP_RENDERABLE_STATUSES: CppProposalStatus[] = ["draft", "ready", "failed"];

export const CPP_APPLYABLE_STATUSES: CppProposalStatus[] = ["ready", "failed"];

export const CPP_STALE_PROCESSING_MS = 60 * 60 * 1000;

export function isCppProcessingStale(proposal: { status: string; updatedAt: Date }, nowMs = Date.now()): boolean {
  if (proposal.status !== "rendering" && proposal.status !== "applying") return false;

  return nowMs - proposal.updatedAt.getTime() > CPP_STALE_PROCESSING_MS;
}

export function cppTotalsOf(group: CppKeywordGroup): CppGroupTotals {
  return {
    spend: group.spend,
    taps: group.taps,
    installs: group.installs,
    conversionRate: group.conversionRate,
    coverage: group.coverage,
  };
}

export function isCppStatus(value: unknown): value is CppProposalStatus {
  return (
    value === "draft" ||
    value === "rendering" ||
    value === "ready" ||
    value === "applying" ||
    value === "applied" ||
    value === "failed"
  );
}

export async function listCppProposals(appId: string, campaignId?: string): Promise<CppProposal[]> {
  return prisma.cppProposal.findMany({
    where: campaignId ? { appId, campaignId } : { appId },
    orderBy: { updatedAt: "desc" },
  });
}

export interface CppProposalJob {
  id: string;
  commitSha: string | null;
  status: string;
  framedByLocale: unknown;
}

export type CppProposalWithJob = CppProposal & { screenshotJob: CppProposalJob | null };

export async function attachScreenshotJobs(proposals: CppProposal[]): Promise<CppProposalWithJob[]> {
  const ids = [...new Set(proposals.map((proposal) => proposal.screenshotJobId).filter((id): id is string => !!id))];
  const jobs =
    ids.length > 0
      ? await prisma.screenshotJob.findMany({
          where: { id: { in: ids } },
          select: { id: true, commitSha: true, status: true, framedByLocale: true },
        })
      : [];

  const byId = new Map(jobs.map((job) => [job.id, job]));

  return proposals.map((proposal) => ({
    ...proposal,
    screenshotJob: proposal.screenshotJobId ? (byId.get(proposal.screenshotJobId) ?? null) : null,
  }));
}

export async function getCppProposal(id: string): Promise<CppProposal> {
  const proposal = await prisma.cppProposal.findUnique({ where: { id } });

  if (!proposal) throw new Error(`CPP proposal ${id} not found`);

  return proposal;
}

export async function setCppProposalStatus(
  id: string,
  status: CppProposalStatus,
  patch: Partial<CppProposal> = {},
): Promise<CppProposal> {
  return prisma.cppProposal.update({ where: { id }, data: { ...patch, status, error: patch.error ?? null } });
}

export async function failCppProposal(id: string, error: unknown): Promise<CppProposal> {
  const message = error instanceof Error ? error.message : String(error);

  return prisma.cppProposal.update({ where: { id }, data: { status: "failed", error: message.slice(0, 500) } });
}

export async function deleteCppProposal(id: string): Promise<void> {
  const proposal = await getCppProposal(id);

  if (proposal.status === "applied") throw new Error("Applied proposals stay for reference; delete the page in App Store Connect");
  if (proposal.status === "rendering" || proposal.status === "applying") throw new Error("Proposal is busy; wait for it to finish");

  await prisma.cppProposal.delete({ where: { id } });
}

export function readCppCaptions(value: unknown): CppCaptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: CppCaptions = {};

  for (const [locale, captions] of Object.entries(value as Record<string, unknown>)) {
    if (!captions || typeof captions !== "object" || Array.isArray(captions)) continue;

    const localeCaptions: Record<string, string> = {};

    for (const [key, caption] of Object.entries(captions as Record<string, unknown>)) {
      if (typeof caption === "string" && caption.trim()) localeCaptions[key] = caption;
    }

    if (Object.keys(localeCaptions).length > 0) out[locale] = localeCaptions;
  }

  return out;
}

export async function updateCppProposalCaptions(id: string, captions: unknown): Promise<CppProposal> {
  const proposal = await getCppProposal(id);

  if (proposal.status !== "draft" && proposal.status !== "ready" && proposal.status !== "failed") {
    throw new Error(`Proposal is ${proposal.status}; captions need draft, ready or failed`);
  }

  const merged = { ...readCppCaptions(proposal.captions), ...normalizeCppCaptions(captions) };

  return prisma.cppProposal.update({ where: { id }, data: { captions: merged as Prisma.InputJsonValue } });
}

export function normalizeCppCaptions(value: unknown): CppCaptions {
  const captions = readCppCaptions(value);
  const out: CppCaptions = {};

  for (const [locale, localeCaptions] of Object.entries(captions)) {
    const clean: Record<string, string> = {};

    for (const [key, caption] of Object.entries(localeCaptions)) {
      const collapsed = caption.replace(/\s+/g, " ").trim().slice(0, 60);

      if (collapsed) clean[key] = collapsed;
    }

    if (Object.keys(clean).length > 0) out[locale] = clean;
  }

  return out;
}
