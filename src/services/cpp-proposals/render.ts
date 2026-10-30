import fs from "fs";
import path from "path";
import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import { asFramedMap } from "../screenshot-studio/revisions";
import { normalizeStudioStyle } from "../screenshot-studio/style";
import { frameScreenshots } from "../generate-screenshots-framing";
import {
  CPP_RENDERABLE_STATUSES,
  failCppProposal,
  getCppProposal,
  isCppProcessingStale,
  readCppCaptions,
  setCppProposalStatus,
} from "./proposals";
import { generateGroupCaptions } from "./captions";
import type { CppProposal } from "@prisma/client";

export interface CppProgressEvent {
  done: number;
  total: number;
  locale: string | null;
  basenames: string[];
}

interface CppSourceJob {
  id: string;
  screenshotStyle: unknown;
  screenshotDescriptions: unknown;
  framedByLocale: unknown;
}

function jobDir(jobId: string): string {
  return path.join(process.cwd(), "screenshots", jobId);
}

function hasRawDir(jobId: string): boolean {
  try {
    return fs.statSync(path.join(jobDir(jobId), "raw")).isDirectory();
  } catch {
    return false;
  }
}

async function pickSourceJob(appId: string, preferredId: string | null): Promise<CppSourceJob | null> {
  if (preferredId) {
    const preferred = await prisma.screenshotJob.findUnique({
      where: { id: preferredId },
      select: { id: true, screenshotStyle: true, screenshotDescriptions: true, framedByLocale: true },
    });

    if (preferred && hasRawDir(preferred.id)) return preferred;
  }

  const jobs = await prisma.screenshotJob.findMany({
    where: { appId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: { id: true, screenshotStyle: true, screenshotDescriptions: true, framedByLocale: true },
  });

  return jobs.find((job) => hasRawDir(job.id)) ?? null;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }

  return out;
}

export function cppFrameConfig(sourceStyle: unknown): Record<string, string> {
  const style = normalizeStudioStyle(sourceStyle);

  return {
    bgColor1: style.bgColor1,
    bgColor2: style.bgColor2,
    textColor: style.textColor,
    textPosition: style.textPosition,
  };
}

export async function renderCppProposal(
  id: string,
  onProgress?: (event: CppProgressEvent) => void,
): Promise<CppProposal> {
  const proposal = await getCppProposal(id);

  if (
    !CPP_RENDERABLE_STATUSES.includes(proposal.status as (typeof CPP_RENDERABLE_STATUSES)[number]) &&
    !isCppProcessingStale(proposal)
  ) {
    throw new Error(`Proposal is ${proposal.status}; render needs draft, ready or failed`);
  }

  await setCppProposalStatus(id, "rendering");

  let jobId: string | null = null;

  try {
    const source = await pickSourceJob(proposal.appId, proposal.sourceJobId);

    if (!source) throw new Error("No screenshot run with stored raws — run screenshots for this app first");

    const sourceLocales = Object.keys(asFramedMap(source.framedByLocale));
    const locales = proposal.locales.length > 0 ? proposal.locales : sourceLocales;

    if (locales.length === 0) throw new Error("Source run has no rendered locales");

    const descriptions = readStringMap(source.screenshotDescriptions);
    const stored = readCppCaptions(proposal.captions);
    const keywords = Array.isArray(proposal.keywords)
      ? (proposal.keywords as Array<{ term?: unknown }>).map((item) => String(item.term ?? "")).filter(Boolean)
      : [];

    const captions =
      Object.keys(stored).length > 0
        ? stored
        : await generateGroupCaptions({
            appId: proposal.appId,
            label: proposal.label,
            topTerms: keywords,
            descriptions,
            locales,
          });

    const job = await prisma.screenshotJob.create({
      data: {
        appId: proposal.appId,
        commitSha: `cpp-${proposal.groupKey}`,
        commitMessage: `CPP ${proposal.label}`,
        branch: "cpp",
        status: "RUNNING",
        screenshotDescriptions: descriptions as Prisma.InputJsonValue,
        screenshotSublines: captions as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    jobId = job.id;

    fs.cpSync(path.join(jobDir(source.id), "raw"), path.join(jobDir(job.id), "raw"), { recursive: true });

    const jobWithApp = await prisma.screenshotJob.findUnique({ where: { id: job.id }, include: { app: true } });

    if (!jobWithApp) throw new Error(`Screenshot job ${job.id} not found`);

    await frameScreenshots(
      job.id,
      jobWithApp,
      jobDir(job.id),
      descriptions,
      Object.keys(descriptions).length > 0,
      captions,
      cppFrameConfig(source.screenshotStyle),
      locales,
      {},
      () => {},
      (event) => onProgress?.({ ...event, basenames: [] }),
    );

    const framedJob = await prisma.screenshotJob.findUnique({
      where: { id: job.id },
      select: { framedByLocale: true },
    });

    const framedByLocale = asFramedMap(framedJob?.framedByLocale);
    const framedCount = locales.reduce((sum, locale) => sum + (framedByLocale[locale]?.length ?? 0), 0);

    if (framedCount === 0) throw new Error("No editable sources stored for these locales");

    await prisma.screenshotJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return setCppProposalStatus(id, "ready", {
      captions: captions as Prisma.InputJsonValue,
      locales,
      sourceJobId: source.id,
      screenshotJobId: job.id,
    });
  } catch (err) {
    if (jobId) {
      await prisma.screenshotJob.update({ where: { id: jobId }, data: { status: "FAILED" } }).catch(() => null);
    }

    await failCppProposal(id, err);
    throw err;
  }
}
