import {
  listAppleAdsAdGroups,
  listAppleAdsCampaigns,
  listAppleAdsKeywords,
  listAppleAdsNegativeKeywords,
  type AppleAdsCredentials,
} from "../../../services/apple-ads";
import { bestEffort, fromTo, quote, tryParseJson, type ToolSummary } from "./shared";

export async function previousCampaign(creds: AppleAdsCredentials, campaignId: string) {
  const list = await bestEffort(() => listAppleAdsCampaigns(creds));
  const c = list?.find((x) => String(x.id) === String(campaignId));
  if (!c) return undefined;

  return {
    name: c.name ?? null,
    status: c.status ?? null,
    dailyBudget: c.dailyBudget ?? null,
    currency: c.currency ?? null,
    countriesOrRegions: c.countriesOrRegions ?? [],
  };
}

export async function previousAdGroup(creds: AppleAdsCredentials, campaignId: string, adGroupId: string) {
  const list = await bestEffort(() => listAppleAdsAdGroups(creds, campaignId));
  const g = list?.find((x) => String(x.id) === String(adGroupId));
  if (!g) return undefined;

  return {
    name: g.name ?? null,
    status: g.status ?? null,
    defaultBidAmount: g.defaultBidAmount ?? null,
    cpaGoal: g.cpaGoal ?? null,
    currency: g.currency ?? null,
  };
}

export async function previousKeywordTexts(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  ids: (string | number)[],
): Promise<{ id: string; text: string }[]> {
  const list = await bestEffort(() => listAppleAdsKeywords(creds, campaignId, adGroupId));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));

  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => ({ id: String(k.id), text: k.text ?? "" }))
    .slice(0, 10);
}

export async function previousNegativeTexts(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  ids: (string | number)[],
): Promise<string[]> {
  const list = await bestEffort(() => listAppleAdsNegativeKeywords(creds, campaignId, adGroupId ?? null));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));

  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => k.text)
    .slice(0, 10);
}

export const summarizeCreateCampaign = (args: any, text: string): ToolSummary => ({
  summary: `Created campaign "${args?.name}" (${args?.status ?? "PAUSED"}) with ${args?.adGroups?.length ?? 0} ad group(s)`,
  entityType: "ads_campaign",
  entityId: tryParseJson(text)?.campaign?.id != null ? String(tryParseJson(text).campaign.id) : undefined,
});

export const summarizeUpdateCampaign = (args: any, text: string): ToolSummary => {
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
    const ccy = args?.currency ?? prev?.currency;
    const suffix = ccy ? ` ${ccy}` : "";

    parts.push(fromTo("daily budget", prev?.dailyBudget, `${args.dailyBudgetAmount}${suffix}`));
    changes.push({
      label: "Daily budget",
      from: prev?.dailyBudget != null ? `${prev.dailyBudget}${suffix}` : null,
      to: `${args.dailyBudgetAmount}${suffix}`,
    });
  }

  if (args?.countriesOrRegions != null) {
    const from = (prev?.countriesOrRegions ?? []).join(", ") || null;

    parts.push(fromTo("countries", from, args.countriesOrRegions.join(", ")));
    changes.push({ label: "Countries", from, to: args.countriesOrRegions.join(", ") });
  }

  return {
    summary: `Updated campaign ${args?.campaignId}${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, changes },
  };
};

export const summarizeCampaignStatus = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const verb = args?.status === "ENABLED" ? "Published" : "Paused";
  const target = prev?.name ? `"${prev.name}" (${args?.campaignId})` : `campaign ${args?.campaignId}`;
  const transition = prev?.status ? `: ${prev.status} → ${args?.status}` : "";

  return {
    summary: `${verb} ${target}${transition}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: {
      campaignId: args?.campaignId,
      name: prev?.name ?? null,
      changes: [{ label: "Status", from: prev?.status ?? null, to: args?.status ?? null }],
    },
  };
};

export const summarizeDeleteCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: prev?.name
      ? `Deleted campaign "${prev.name}" (${args?.campaignId})`
      : `Deleted campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeCreateAdGroup = (args: any, text: string): ToolSummary => {
  const created = tryParseJson(text)?.adGroup;

  return {
    summary: `Created ad group "${args?.name}"${created?.id != null ? ` (${created.id})` : ""} in campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeUpdateAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const ccy = args?.currency ?? prev?.currency;
  const suffix = ccy ? ` ${ccy}` : "";
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
    parts.push(fromTo("default bid", prev?.defaultBidAmount, `${args.defaultBidAmount}${suffix}`));
    changes.push({
      label: "Default bid",
      from: prev?.defaultBidAmount != null ? `${prev.defaultBidAmount}${suffix}` : null,
      to: `${args.defaultBidAmount}${suffix}`,
    });
  }

  if (args?.cpaGoal != null) {
    parts.push(fromTo("CPA goal", prev?.cpaGoal, `${args.cpaGoal}${suffix}`));
    changes.push({
      label: "CPA goal",
      from: prev?.cpaGoal != null ? `${prev.cpaGoal}${suffix}` : null,
      to: `${args.cpaGoal}${suffix}`,
    });
  }

  return {
    summary: `Updated ad group ${args?.adGroupId} (campaign ${args?.campaignId})${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

export const summarizeDeleteAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: prev?.name
      ? `Deleted ad group "${prev.name}" (${args?.adGroupId}) from campaign ${args?.campaignId}`
      : `Deleted ad group ${args?.adGroupId} from campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeAddKeywords = (args: any): ToolSummary => {
  const texts = (args?.keywords ?? []).map((k: any) => k?.text).filter(Boolean).slice(0, 5).join(", ");

  return {
    summary: `Added ${args?.keywords?.length ?? 0} keyword(s)${texts ? ` (${texts}${(args?.keywords?.length ?? 0) > 5 ? ", …" : ""})` : ""} to ad group ${args?.adGroupId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

export const summarizeUpdateKeywords = (args: any, text: string): ToolSummary => {
  const rows = tryParseJson(text)?.updated ?? [];
  const suffix = args?.currency ? ` ${args.currency}` : "";
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  const parts = rows.slice(0, 5).map((r: any) => {
    const bits: string[] = [];
    const name = `"${r?.text ?? r?.id}"`;

    if (r?.bidAmount != null) {
      bits.push(`bid ${r.previousBidAmount ?? "—"} → ${r.bidAmount}${suffix}`);
      changes.push({
        label: `${name} · bid`,
        from: r.previousBidAmount != null ? `${r.previousBidAmount}${suffix}` : null,
        to: `${r.bidAmount}${suffix}`,
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
    summary: `Updated ${rows.length} keyword(s) in ad group ${args?.adGroupId}${parts.length ? `: ${parts.join("; ")}${more}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

export const summarizeDeleteKeywords = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous ?? [];
  const removed = prev.map((p: any) => p?.text).filter(Boolean);
  const label = removed.map((t: string) => `"${t}"`).join(", ") || (args?.keywordIds ?? []).join(", ");

  return {
    summary: `Deleted ${args?.keywordIds?.length ?? 0} keyword(s) (${label}) from ad group ${args?.adGroupId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, removed },
  };
};

export const summarizeUpdateNegatives = (args: any, text: string): ToolSummary => {
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
    summary: `Negative keywords (${scope}, campaign ${args?.campaignId}): ${parts.join(", ") || "no changes"}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId ?? null, scope, added, removed },
  };
};

export const summarizeCreateGroup = (args: any): ToolSummary => ({
  summary: `Created campaign group "${args?.name}"`,
  entityType: "ads_campaign",
});

export const summarizeRenameGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: `Renamed campaign group ${quote(prev?.name)} → ${quote(args?.name)}`,
    entityType: "ads_campaign",
    details: { groupId: args?.groupId, changes: [{ label: "Name", from: prev?.name ?? null, to: args?.name }] },
  };
};

export const summarizeDeleteGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;

  return {
    summary: prev?.name
      ? `Deleted campaign group "${prev.name}" (its campaigns moved to Ungrouped)`
      : `Deleted campaign group ${args?.groupId}`,
    entityType: "ads_campaign",
  };
};

export const summarizeAssignGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const target =
    args?.groupId != null ? `group "${tryParseJson(text)?.groupName ?? args.groupId}"` : "Ungrouped";

  const from = prev?.groupName ? ` from "${prev.groupName}"` : "";

  return {
    summary: `Moved campaign ${args?.campaignId}${from} to ${target}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, groupId: args?.groupId ?? null },
  };
};
