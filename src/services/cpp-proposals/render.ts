import fs from "fs";
import path from "path";
import PQueue from "p-queue";
import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import { workerClient } from "../worker-client";
import { frameComplexBatch } from "../screenshot-studio/complex";
import { pickStudioSourceLocale } from "../screenshot-studio/render";
import { asFramedMap } from "../screenshot-studio/revisions";
import {
  matchDescriptionKey,
  normalizeStudioStyle,
  normalizeStudioTitle,
  resolveStudioTitle,
} from "../screenshot-studio/style";
import { groupPlannedByDevice } from "../screenshot-studio/render";
import {
  CPP_RENDERABLE_STATUSES,
  failCppProposal,
  getCppProposal,
  isCppProcessingStale,
  readCppCaptions,
  setCppProposalStatus,
  type CppCaptions,
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
  screenshotSublines: unknown;
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
      select: { id: true, screenshotStyle: true, screenshotDescriptions: true, screenshotSublines: true, framedByLocale: true },
    });

    if (preferred && hasRawDir(preferred.id)) return preferred;
  }

  const jobs = await prisma.screenshotJob.findMany({
    where: { appId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: { id: true, screenshotStyle: true, screenshotDescriptions: true, screenshotSublines: true, framedByLocale: true },
  });

  return jobs.find((job) => hasRawDir(job.id)) ?? null;
}

function rawLocalesOf(jobId: string): string[] {
  try {
    return fs
      .readdirSync(path.join(jobDir(jobId), "raw"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }

  return out;
}

function readSublines(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, Record<string, string>> = {};

  for (const [locale, captions] of Object.entries(value as Record<string, unknown>)) {
    const map = readStringMap(captions);

    if (Object.keys(map).length > 0) out[locale] = map;
  }

  return out;
}

function titleForBasename(args: {
  basename: string;
  locale: string;
  captions: CppCaptions;
  sublines: Record<string, Record<string, string>>;
  descriptions: Record<string, string>;
  fallback: string;
}): string {
  const descKey = matchDescriptionKey(args.basename, args.descriptions);
  const groupHit = descKey ? (args.captions[args.locale]?.[descKey] ?? args.captions["en-US"]?.[descKey]) : undefined;

  if (groupHit) return normalizeStudioTitle(groupHit);

  return normalizeStudioTitle(
    resolveStudioTitle({
      basename: args.basename,
      locale: args.locale,
      sublines: args.sublines,
      descriptions: args.descriptions,
      fallback: args.fallback,
    }),
  );
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
    const style = normalizeStudioStyle(source.screenshotStyle);
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
        screenshotStyle: style as Prisma.InputJsonValue,
        screenshotDescriptions: descriptions as Prisma.InputJsonValue,
        screenshotSublines: captions as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    jobId = job.id;

    fs.cpSync(path.join(jobDir(source.id), "raw"), path.join(jobDir(job.id), "raw"), { recursive: true });

    const rawLocales = rawLocalesOf(source.id);
    const sublines = readSublines(source.screenshotSublines);
    const planned: Array<{ locale: string; basename: string; title: string }> = [];

    for (const locale of locales) {
      const sourceLocale = pickStudioSourceLocale(locale, rawLocales);

      if (!sourceLocale) continue;

      const files = fs
        .readdirSync(path.join(jobDir(source.id), "raw", sourceLocale))
        .filter((file) => /\.png$/i.test(file))
        .sort();

      for (const basename of files) {
        planned.push({
          locale,
          basename,
          title: titleForBasename({ basename, locale, captions, sublines, descriptions, fallback: proposal.label }),
        });
      }
    }

    if (planned.length === 0) throw new Error("No editable sources stored for these locales");

    const total = planned.length;
    let done = 0;

    onProgress?.({ done: 0, total, locale: null, basenames: [] });

    const queue = new PQueue({ concurrency: workerClient.slotCount() });
    const tasks: Array<Promise<void>> = [];

    for (const locale of locales) {
      const localePlanned = planned.filter((item) => item.locale === locale);

      if (localePlanned.length === 0) continue;

      const sourceLocale = pickStudioSourceLocale(locale, rawLocales);

      if (!sourceLocale) continue;

      for (const chunk of groupPlannedByDevice(localePlanned)) {
        const titles = new Map(chunk.map((item) => [item.basename.replace(/\.[^.]+$/, ""), item.title]));
        const basenames = chunk.map((item) => item.basename);

        tasks.push(
          queue.add(async () => {
            onProgress?.({ done, total, locale, basenames });

            await frameComplexBatch({
              srcDir: path.join(jobDir(source.id), "raw", sourceLocale),
              outDir: path.join(jobDir(job.id), "framed", locale),
              shots: chunk.map((item) => ({
                filename: item.basename,
                base: item.basename.replace(/\.[^.]+$/, ""),
                style,
              })),
              titles,
              style,
            });

            done += chunk.length;
            onProgress?.({ done, total, locale, basenames: [] });
          }),
        );
      }
    }

    try {
      await Promise.all(tasks);
    } catch (err) {
      queue.clear();
      throw err;
    }

    const framedByLocale: Record<string, string[]> = {};

    for (const item of planned) {
      const base = item.basename.replace(/\.[^.]+$/, "");
      const list = framedByLocale[item.locale] ?? [];

      list.push(`/screenshots/${job.id}/framed/${item.locale}/${base}.png`);
      framedByLocale[item.locale] = list;
    }

    await prisma.screenshotJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        framedByLocale: framedByLocale as Prisma.InputJsonValue,
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
