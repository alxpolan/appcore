import {
  listGoogleAdsAdGroups,
  listGoogleAdsCampaigns,
  listGoogleAdsCampaignTargeting,
  listGoogleAdsKeywords,
  listGoogleAdsNegativeKeywords,
  type GoogleAdsCredentials,
} from "../../../services/google-ads";
import { bestEffort, fromTo, quote, tryParseJson, type ToolSummary } from "./shared";

export async function previousGoogleCampaign(creds: GoogleAdsCredentials, campaignId: string) {
  const list = await bestEffort(() => listGoogleAdsCampaigns(creds));
  const c = list?.find((x) => String(x.id) === String(campaignId));
  if (!c) return undefined;

  return {
    name: c.name ?? null,
    status: c.status ?? null,
    dailyBudget: c.dailyBudget ?? null,
    currency: c.currency ?? null,
  };
}

export async function previousGoogleAdGroup(creds: GoogleAdsCredentials, campaignId: string, adGroupId: string) {
  const detail = await bestEffort(() => listGoogleAdsAdGroups(creds, campaignId));
  const g = detail?.find((x) => String(x.id) === String(adGroupId));
  if (!g) return undefined;

  return {
    name: g.name ?? null,
    status: g.status ?? null,
    defaultBidAmount: g.defaultCpcBid ?? null,
  };
}

export async function previousGoogleKeywordTexts(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  ids: (string | number)[],
): Promise<{ id: string; text: string }[]> {
  const list = await bestEffort(() => listGoogleAdsKeywords(creds, campaignId, adGroupId));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));

  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => ({ id: String(k.id), text: k.text ?? "" }))
    .slice(0, 10);
}

export async function previousGoogleNegativeTexts(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  ids: (string | number)[],
): Promise<string[]> {
  const list = await bestEffort(() => listGoogleAdsNegativeKeywords(creds, campaignId, adGroupId ?? null));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));

  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => k.text)
    .slice(0, 10);
}

export const summarizeGoogleCreateCampaign = (args: any, text: string): ToolSummary => {
  const res = tryParseJson(text);
  const bits: string[] = [];
  if (args?.locationIds?.length) bits.push(`${args.locationIds.length} location(s)`);
  if (args?.languageIds?.length) bits.push(`${args.languageIds.length} language(s)`);
  const adCount = (args?.adGroups ?? []).reduce((n: number, g: any) => n + (g?.ads?.length ?? 0), 0);
  if (adCount) bits.push(`${adCount} ad(s)`);
  if (args?.biddingStrategy) bits.push(String(args.biddingStrategy));
  if (res?.appleMapping) bits.push(`Apple mapping ${res.appleMapping.ctToken}`);

  return {
    summary:
      `Created Google Ads campaign "${args?.name}" (${args?.status ?? "PAUSED"}) with ${args?.adGroups?.length ?? 0} ad group(s)` +
      (bits.length ? ` (${bits.join(", ")})` : ""),
    entityType: "google_ads_campaign",
    entityId: res?.campaign?.id != null ? String(res.campaign.id) : undefined,
  };
};

export const summarizeGoogleUpdateCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const parts: string[] = [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];

  if (args?.name != null) {
    parts.push(`name: ${quote(prev?.name)} → ${quote(args.name)}`);
    changes.push({ label: "Name", from: prev?.name ?? null, to: args.name });
  }

  if (args?.status != null) {
    parts.push(fromTo("status", prev?.status, args.status));
    changes.push({ label: "Status", from: prev?.status ?? null, to: args.status });
  }

  if (args?.dailyBudgetAmount != null) {
    const ccy = prev?.currency ? ` ${prev.currency}` : "";
    parts.push(fromTo("daily budget", prev?.dailyBudget, `${args.dailyBudgetAmount}${ccy}`));
    changes.push({
      label: "Daily budget",
      from: prev?.dailyBudget != null ? `${prev.dailyBudget}${ccy}` : null,
      to: `${args.dailyBudgetAmount}${ccy}`,
    });
  }

  if (args?.startDate != null) {
    parts.push(fromTo("start date", null, args.startDate));
    changes.push({ label: "Start date", from: null, to: args.startDate });
  }

  if (args?.endDate != null) {
    parts.push(fromTo("end date", null, args.endDate));
    changes.push({ label: "End date", from: null, to: args.endDate });
  }

  return {
    summary: `Updated Google Ads campaign ${args?.campaignId}${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, changes },
  };
};

export const summarizeGoogleCampaignStatus = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary:
      args?.status === "ENABLED"
        ? `Published Google Ads campaign ${args?.campaignId} (${fromTo("status", prev?.status, "ENABLED")})`
        : `Paused Google Ads campaign ${args?.campaignId} (${fromTo("status", prev?.status, "PAUSED")})`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: {
      campaignId: args?.campaignId,
      changes: [{ label: "Status", from: prev?.status ?? null, to: args?.status ?? null }],
    },
  };
};

export const summarizeGoogleDeleteCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: prev?.name
      ? `Deleted Google Ads campaign "${prev.name}" (${args?.campaignId})`
      : `Deleted Google Ads campaign ${args?.campaignId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeGoogleCreateAdGroup = (args: any, text: string): ToolSummary => ({
  summary: `Created ad group "${args?.name}" (default bid ${args?.defaultBidAmount}) in Google Ads campaign ${args?.campaignId}`,
  entityType: "google_ads_campaign",
  entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
});

export const summarizeGoogleUpdateAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const parts: string[] = [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];

  if (args?.name != null) {
    parts.push(`name: ${quote(prev?.name)} → ${quote(args.name)}`);
    changes.push({ label: "Name", from: prev?.name ?? null, to: args.name });
  }

  if (args?.status != null) {
    parts.push(fromTo("status", prev?.status, args.status));
    changes.push({ label: "Status", from: prev?.status ?? null, to: args.status });
  }

  if (args?.defaultBidAmount != null) {
    parts.push(fromTo("default bid", prev?.defaultBidAmount, args.defaultBidAmount));
    changes.push({
      label: "Default bid",
      from: prev?.defaultBidAmount != null ? String(prev.defaultBidAmount) : null,
      to: String(args.defaultBidAmount),
    });
  }

  return {
    summary: `Updated ad group ${args?.adGroupId} (Google Ads campaign ${args?.campaignId})${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

export const summarizeGoogleDeleteAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: prev?.name
      ? `Deleted ad group "${prev.name}" (${args?.adGroupId}) from Google Ads campaign ${args?.campaignId}`
      : `Deleted ad group ${args?.adGroupId} from Google Ads campaign ${args?.campaignId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeGoogleAddKeywords = (args: any): ToolSummary => {
  const texts = (args?.keywords ?? []).map((k: any) => k?.text).filter(Boolean).slice(0, 5).join(", ");

  return {
    summary: `Added ${args?.keywords?.length ?? 0} Google Ads keyword(s)${texts ? ` (${texts}${(args?.keywords?.length ?? 0) > 5 ? ", …" : ""})` : ""} to ad group ${args?.adGroupId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeGoogleUpdateKeywords = (args: any, text: string): ToolSummary => {
  const rows = tryParseJson(text)?.updated ?? [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  const parts = rows.slice(0, 5).map((r: any) => {
    const bits: string[] = [];
    const name = `"${r?.text ?? r?.id}"`;

    if (r?.bidAmount != null) {
      bits.push(`bid ${r.previousBidAmount ?? "—"} → ${r.bidAmount}`);
      changes.push({
        label: `${name} · bid`,
        from: r.previousBidAmount != null ? String(r.previousBidAmount) : null,
        to: String(r.bidAmount),
      });
    }

    if (r?.status != null) {
      bits.push(`${r.previousStatus ?? "—"} → ${r.status}`);
      changes.push({ label: `${name} · status`, from: r.previousStatus ?? null, to: r.status });
    }

    return `${name}: ${bits.join(", ") || "no changes"}`;
  });
  const more = rows.length > 5 ? `; +${rows.length - 5} more` : "";

  return {
    summary: `Updated ${rows.length} Google Ads keyword(s) in ad group ${args?.adGroupId}${parts.length ? `: ${parts.join("; ")}${more}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

export const summarizeGoogleDeleteKeywords = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous ?? [];
  const removed = prev.map((p: any) => p?.text).filter(Boolean);
  const label = removed.map((t: string) => `"${t}"`).join(", ") || (args?.keywordIds ?? []).join(", ");

  return {
    summary: `Deleted ${args?.keywordIds?.length ?? 0} Google Ads keyword(s) (${label}) from ad group ${args?.adGroupId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, removed },
  };
};

export const summarizeGoogleUpdateNegatives = (args: any, text: string): ToolSummary => {
  const scope = args?.adGroupId ? `ad group ${args.adGroupId}` : "campaign level";
  const prev = tryParseJson(text)?.previous;
  const added = (args?.add ?? []).map((k: any) => k?.text).filter(Boolean);
  const removed = (prev?.removedTexts ?? []).filter(Boolean);
  const parts: string[] = [];

  if (args?.add?.length) {
    const texts = added
      .map((t: string) => `"${t}"`)
      .slice(0, 5)
      .join(", ");

    parts.push(`added ${args.add.length}${texts ? ` (${texts})` : ""}`);
  }

  if (args?.removeIds?.length) {
    const texts = removed
      .map((t: string) => `"${t}"`)
      .slice(0, 5)
      .join(", ");

    parts.push(`removed ${args.removeIds.length}${texts ? ` (${texts})` : ""}`);
  }

  return {
    summary: `Google Ads negative keywords (${scope}, campaign ${args?.campaignId}): ${parts.join(", ") || "no changes"}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId ?? null, scope, added, removed },
  };
};

export async function previousGoogleCampaignTargeting(creds: GoogleAdsCredentials, campaignId: string) {
  const t = await bestEffort(() => listGoogleAdsCampaignTargeting(creds, campaignId));
  if (!t) return undefined;

  return {
    locations: t.locations.map((l) => l.geoTargetConstant.split("/").pop()),
    languages: t.languages.map((l) => l.languageConstant.split("/").pop()),
  };
}

export const summarizeGoogleCreateRsa = (args: any): ToolSummary => {
  const first = (args?.ads ?? [])
    .map((a: any) => (a?.headlines ?? [])[0])
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return {
    summary: `Created ${args?.ads?.length ?? 0} responsive search ad(s)${first ? ` (${first})` : ""} in ad group ${args?.adGroupId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeGoogleCampaignTargeting = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const parts: string[] = [];
  if (args?.locationIds !== undefined) {
    parts.push(`locations ${(prev?.locations ?? []).join(", ") || "none"} → ${(args.locationIds ?? []).join(", ") || "none"}`);
  }
  if (args?.languageIds !== undefined) {
    parts.push(`languages ${(prev?.languages ?? []).join(", ") || "none"} → ${(args.languageIds ?? []).join(", ") || "none"}`);
  }

  return {
    summary: `Google Ads campaign ${args?.campaignId} targeting: ${parts.join("; ") || "no changes"}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, changes: parts },
  };
};
