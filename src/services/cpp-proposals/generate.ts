import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import type { CppProposal } from "@prisma/client";
import {
  listAppleAdsCampaigns,
  listAppleAdsSearchTerms,
  resolveAppleAdsRange,
} from "../apple-ads-reports";
import type { AppleAdsCredentials, AppleAdsSearchTerm } from "../apple-ads-types";
import { asFramedMap } from "../screenshot-studio/revisions";
import { groupKeywordsByTheme, type CppKeywordStat } from "./grouping";
import { resolveProposalLocales } from "./locales";
import { cppTotalsOf, listCppProposals } from "./proposals";

function toKeywordStat(row: AppleAdsSearchTerm): CppKeywordStat {
  return {
    term: row.searchTerm,
    keyword: row.keyword,
    matchType: row.matchType,
    adGroupId: row.adGroupId,
    adGroupName: row.adGroupName,
    spend: row.spend,
    taps: row.taps,
    installs: row.installs,
  };
}

async function campaignInfoOf(
  creds: AppleAdsCredentials,
  campaignId: string,
): Promise<{ name: string | null; countries: string[] }> {
  try {
    const campaigns = await listAppleAdsCampaigns(creds);
    const campaign = campaigns.find((entry) => String(entry.id) === campaignId);

    return { name: campaign?.name ?? null, countries: campaign?.countriesOrRegions ?? [] };
  } catch {
    return { name: null, countries: [] };
  }
}

async function sourceJobLocales(appId: string): Promise<string[]> {
  const job = await prisma.screenshotJob.findFirst({
    where: { appId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { framedByLocale: true },
  });

  return Object.keys(asFramedMap(job?.framedByLocale));
}

export async function generateCppProposals(args: {
  appId: string;
  campaignId: string;
  creds: AppleAdsCredentials;
  days?: number;
}): Promise<CppProposal[]> {
  const app = await prisma.app.findUnique({ where: { id: args.appId }, select: { id: true } });

  if (!app) throw new Error(`App ${args.appId} not found`);

  const days = Math.max(7, Math.min(90, Math.floor(args.days ?? 30)));
  const [terms, campaign, jobLocales] = await Promise.all([
    listAppleAdsSearchTerms(args.creds, args.campaignId, resolveAppleAdsRange({ days })),
    campaignInfoOf(args.creds, args.campaignId),
    sourceJobLocales(args.appId),
  ]);
  const locales = resolveProposalLocales(campaign.countries, jobLocales);
  const groups = groupKeywordsByTheme(terms.map(toKeywordStat));

  if (groups.length === 0) throw new Error("No funded keywords in this campaign for the selected range");

  const existing = await prisma.cppProposal.findMany({ where: { appId: args.appId, campaignId: args.campaignId } });
  const byKey = new Map(existing.map((proposal) => [proposal.groupKey, proposal]));

  for (const group of groups) {
    const current = byKey.get(group.key);
    const keywords = group.keywords as Prisma.InputJsonValue;
    const totals = cppTotalsOf(group) as Prisma.InputJsonValue;

    if (!current) {
      await prisma.cppProposal.create({
        data: {
          appId: args.appId,
          campaignId: args.campaignId,
          campaignName: campaign.name,
          groupKey: group.key,
          label: group.label,
          status: "draft",
          keywords,
          totals,
          locales,
        },
      });

      continue;
    }

    if (current.status !== "draft" && current.status !== "failed") continue;

    await prisma.cppProposal.update({
      where: { id: current.id },
      data: { campaignName: campaign.name, label: group.label, keywords, totals, locales, error: null },
    });
  }

  return listCppProposals(args.appId, args.campaignId);
}
