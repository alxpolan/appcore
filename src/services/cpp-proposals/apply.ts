import fs from "fs";
import path from "path";
import sharp from "sharp";
import axios from "../utils/http";
import { createHash } from "crypto";
import { prisma } from "../../config";
import type { CppProposal } from "@prisma/client";
import type { AppStoreConnectClient } from "../appstore-connect";
import {
  cppPageInitialLocale,
  detectDisplayTypeFromDimensions,
  findCppLocalizationsToRemove,
  findEditableCppVersion,
  pendingCppScreenshots,
} from "../utils/custom-product-pages";
import { asFramedMap } from "../screenshot-studio/revisions";
import {
  CPP_APPLYABLE_STATUSES,
  failCppProposal,
  getCppProposal,
  isCppProcessingStale,
  setCppProposalStatus,
} from "./proposals";

const CPP_MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const CPP_SCREENSHOT_POLL_MS = 15_000;
const CPP_SCREENSHOT_TIMEOUT_MS = 15 * 60 * 1000;

export function cppPageName(campaignName: string | null, label: string): string {
  return `${campaignName ?? "Campaign"} - ${label}`.slice(0, 80);
}

async function uploadFileToSet(
  asc: AppStoreConnectClient,
  setId: string,
  fileName: string,
  fileBytes: Buffer,
): Promise<void> {
  const reserved = await asc.reserveScreenshot(setId, fileName, fileBytes.length);

  for (const op of reserved.attributes.uploadOperations) {
    const chunk = fileBytes.subarray(op.offset, op.offset + op.length);

    await axios.put(op.url, chunk, {
      headers: Object.fromEntries(op.requestHeaders.map((header) => [header.name, header.value])),
    });
  }

  await asc.commitScreenshot(reserved.id, createHash("md5").update(fileBytes).digest("hex"));
}

async function waitForCppScreenshotsComplete(
  asc: AppStoreConnectClient,
  localizationIds: string[],
): Promise<void> {
  const deadline = Date.now() + CPP_SCREENSHOT_TIMEOUT_MS;

  for (;;) {
    const pending: string[] = [];

    for (const localizationId of localizationIds) {
      const sets = await asc.listCustomProductPageScreenshotSets(localizationId);

      for (const set of sets) {
        const shots = await asc.listScreenshotsInSet(set.id);

        pending.push(...pendingCppScreenshots(shots));
      }
    }

    if (pending.length === 0) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Screenshots still processing after 15 minutes: ${pending.join(", ")}`);
    }

    await new Promise((resolve) => setTimeout(resolve, CPP_SCREENSHOT_POLL_MS));
  }
}

export async function applyCppProposal(args: {
  proposalId: string;
  asc: AppStoreConnectClient;
  bundleId: string;
}): Promise<CppProposal> {
  const proposal = await getCppProposal(args.proposalId);

  if (
    !CPP_APPLYABLE_STATUSES.includes(proposal.status as (typeof CPP_APPLYABLE_STATUSES)[number]) &&
    !isCppProcessingStale(proposal)
  ) {
    throw new Error(`Proposal is ${proposal.status}; apply needs ready or failed`);
  }

  if (!proposal.screenshotJobId) throw new Error("Render screenshots first");

  await setCppProposalStatus(proposal.id, "applying");

  try {
    const job = await prisma.screenshotJob.findUnique({ where: { id: proposal.screenshotJobId } });

    if (!job) throw new Error(`Screenshot job ${proposal.screenshotJobId} not found`);

    const framedByLocale = asFramedMap(job.framedByLocale);
    const locales = proposal.locales.filter((locale) => (framedByLocale[locale] ?? []).length > 0);

    if (locales.length === 0) throw new Error("Rendered job has no screenshots for the proposal locales");

    const ascApp = await args.asc.getApp(args.bundleId);

    if (!ascApp) throw new Error("App not found in App Store Connect");

    const name = cppPageName(proposal.campaignName, proposal.label);
    const pages = await args.asc.listCustomProductPages(ascApp.id);
    const page =
      pages.find((entry) => entry.attributes.name === name) ??
      (await args.asc.createCustomProductPage(
        ascApp.id,
        name,
        cppPageInitialLocale(ascApp.attributes.primaryLocale, locales[0]),
      ));

    const existingVersions = await args.asc.listCustomProductPageVersions(page.id);
    const version = findEditableCppVersion(existingVersions) ?? (await args.asc.createCustomProductPageVersion(page.id));

    const primaryLocale = ascApp.attributes.primaryLocale;
    const sourceJob = proposal.sourceJobId
      ? await prisma.screenshotJob.findUnique({ where: { id: proposal.sourceJobId } })
      : null;

    const sourceFramedByLocale = sourceJob ? asFramedMap(sourceJob.framedByLocale) : {};
    const uploadPlans: Array<{ locale: string; jobId: string; urls: string[] }> = locales.map((locale) => ({
      locale,
      jobId: job.id,
      urls: framedByLocale[locale] ?? [],
    }));

    if (!locales.includes(primaryLocale)) {
      const sourceUrls = sourceFramedByLocale[primaryLocale] ?? [];

      uploadPlans.push(
        sourceJob && sourceUrls.length > 0
          ? { locale: primaryLocale, jobId: sourceJob.id, urls: sourceUrls }
          : { locale: primaryLocale, jobId: job.id, urls: framedByLocale[locales[0]] ?? [] },
      );
    }

    const appliedLocalizationIds: string[] = [];

    for (const plan of uploadPlans) {
      const locale = plan.locale;
      const localizations = await args.asc.listCustomProductPageLocalizations(version.id);
      const localization =
        localizations.find((entry) => entry.attributes.locale === locale) ??
        (await args.asc.createCustomProductPageLocalization(version.id, locale));

      appliedLocalizationIds.push(localization.id);

      const sets = await args.asc.listCustomProductPageScreenshotSets(localization.id);

      for (const url of plan.urls) {
        const fileName = decodeURIComponent(url.split("/").pop() ?? url);
        const absPath = path.join(process.cwd(), url.replace(/^\//, ""));
        const fileBytes = fs.readFileSync(absPath);

        if (fileBytes.length > CPP_MAX_SCREENSHOT_BYTES) throw new Error(`${fileName} exceeds 15MB`);

        const meta = await sharp(fileBytes).metadata();
        const displayType = detectDisplayTypeFromDimensions(meta.width, meta.height);

        if (!displayType) throw new Error(`${fileName} has unsupported dimensions ${meta.width}x${meta.height}`);

        let set = sets.find((entry) => entry.attributes.screenshotDisplayType === displayType) ?? null;

        if (!set) {
          set = await args.asc.createCustomProductPageScreenshotSet(localization.id, displayType);
          sets.push(set);
        }

        const existingShots = await args.asc.listScreenshotsInSet(set.id);

        if (existingShots.some((shot) => shot.attributes.fileName === fileName)) {
          continue;
        }

        await uploadFileToSet(args.asc, set.id, fileName, fileBytes);
      }
    }

    const versionLocalizations = await args.asc.listCustomProductPageLocalizations(version.id);

    for (const extra of findCppLocalizationsToRemove(versionLocalizations, uploadPlans.map((plan) => plan.locale))) {
      await args.asc.deleteCustomProductPageLocalization(extra.id);
    }

    await waitForCppScreenshotsComplete(args.asc, appliedLocalizationIds);
    await args.asc.submitCustomProductPageVersionForReview(ascApp.id, version.id);

    const submitted = await args.asc.getCustomProductPage(page.id);

    return setCppProposalStatus(proposal.id, "applied", {
      cppPageId: page.id,
      cppVersionId: version.id,
      cppUrl: submitted.attributes.url ?? null,
    });
  } catch (err) {
    await failCppProposal(proposal.id, err);
    throw err;
  }
}
