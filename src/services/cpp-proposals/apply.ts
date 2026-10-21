import fs from "fs";
import path from "path";
import sharp from "sharp";
import axios from "../utils/http";
import { createHash } from "crypto";
import { prisma } from "../../config";
import type { CppProposal } from "@prisma/client";
import type { AppStoreConnectClient } from "../appstore-connect";
import { detectDisplayTypeFromDimensions } from "../utils/custom-product-pages";
import { asFramedMap } from "../screenshot-studio/revisions";
import {
  CPP_APPLYABLE_STATUSES,
  failCppProposal,
  getCppProposal,
  isCppProcessingStale,
  setCppProposalStatus,
} from "./proposals";

const CPP_MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

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
    const page = pages.find((entry) => entry.attributes.name === name) ?? (await args.asc.createCustomProductPage(ascApp.id, name, locales[0]));
    const version = await args.asc.createCustomProductPageVersion(page.id);

    for (const locale of locales) {
      const localizations = await args.asc.listCustomProductPageLocalizations(version.id);
      const localization =
        localizations.find((entry) => entry.attributes.locale === locale) ??
        (await args.asc.createCustomProductPageLocalization(version.id, locale));
      const sets = await args.asc.listCustomProductPageScreenshotSets(localization.id);

      for (const url of framedByLocale[locale] ?? []) {
        const fileName = decodeURIComponent(url.split("/").pop() ?? url);
        const absPath = path.join(process.cwd(), "screenshots", job.id, "framed", locale, fileName);
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

        await uploadFileToSet(args.asc, set.id, fileName, fileBytes);
      }
    }

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
