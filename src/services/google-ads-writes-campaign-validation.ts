import { asPositiveNumber } from "./utils/ads-validation";
import { validateRsaInput } from "./google-ads-writes-ad-groups";
import type {
  GoogleAdsAdScheduleInput,
  GoogleAdsBiddingStrategy,
  GoogleAdsCallInput,
  GoogleAdsCreateCampaignInput,
  GoogleAdsCreateKeywordInput,
  GoogleAdsCreateNegativeInput,
  GoogleAdsDayOfWeek,
  GoogleAdsDeviceBidAdjustments,
  GoogleAdsKeywordMatchType,
  GoogleAdsMinuteOfHour,
  GoogleAdsSitelinkInput,
  GoogleAdsStructuredSnippetInput,
} from "./google-ads-types";

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;

function asMatchType(value: unknown, label: string): GoogleAdsKeywordMatchType {
  const upper = String(value ?? "").toUpperCase();

  if (!(MATCH_TYPES as readonly string[]).includes(upper)) {
    throw new Error(`${label} must be one of EXACT, PHRASE, BROAD`);
  }

  return upper as GoogleAdsKeywordMatchType;
}

function asDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }

  return value;
}

export function validateGoogleAdsCreateCampaignInput(body: any): GoogleAdsCreateCampaignInput {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("name is required");
  if (!Array.isArray(body.adGroups) || body.adGroups.length === 0) throw new Error("At least one ad group is required");
  const status = body.status == null ? "PAUSED" : String(body.status).toUpperCase();
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');
  const BIDDING_STRATEGIES = ["MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "TARGET_ROAS"];
  const biddingStrategy = body.biddingStrategy == null ? "MANUAL_CPC" : String(body.biddingStrategy).toUpperCase();

  if (!BIDDING_STRATEGIES.includes(biddingStrategy)) {
    throw new Error(`biddingStrategy must be one of: ${BIDDING_STRATEGIES.join(", ")}`);
  }

  const manualBids = biddingStrategy === "MANUAL_CPC";
  const cpcBidCeiling = body.cpcBidCeiling == null ? undefined : asPositiveNumber(body.cpcBidCeiling, "cpcBidCeiling");

  if (cpcBidCeiling != null && manualBids) {
    throw new Error("cpcBidCeiling does not apply to MANUAL_CPC");
  }

  const targetCpa = body.targetCpa == null ? undefined : asPositiveNumber(body.targetCpa, "targetCpa");

  if (targetCpa != null && biddingStrategy !== "TARGET_CPA" && biddingStrategy !== "MAXIMIZE_CONVERSIONS") {
    throw new Error("targetCpa only applies to TARGET_CPA or MAXIMIZE_CONVERSIONS");
  }

  if (biddingStrategy === "TARGET_CPA" && targetCpa == null) {
    throw new Error("targetCpa is required for TARGET_CPA");
  }

  const targetRoas = body.targetRoas == null ? undefined : asPositiveNumber(body.targetRoas, "targetRoas (percent)");

  if (targetRoas != null && biddingStrategy !== "TARGET_ROAS") {
    throw new Error("targetRoas only applies to TARGET_ROAS");
  }

  if (biddingStrategy === "TARGET_ROAS" && targetRoas == null) {
    throw new Error("targetRoas is required for TARGET_ROAS (as a percent, e.g. 300 for 300%)");
  }

  const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const MINUTES_OF_HOUR = [0, 15, 30, 45];
  const asHour = (value: unknown, label: string): number => {
    const hour = Number(value);

    if (!Number.isInteger(hour) || hour < 0 || hour > 24) throw new Error(`${label} must be an integer 0-24`);

    return hour;
  };

  const asMinute = (value: unknown, label: string): GoogleAdsMinuteOfHour | undefined => {
    if (value == null) return undefined;

    const minute = Number(value);
    if (!MINUTES_OF_HOUR.includes(minute)) throw new Error(`${label} must be one of 0, 15, 30, 45`);

    return minute as GoogleAdsMinuteOfHour;
  };

  const adSchedule: GoogleAdsAdScheduleInput[] = (() => {
    if (body.adSchedule == null) return [];
    if (!Array.isArray(body.adSchedule)) throw new Error("adSchedule must be an array");

    return body.adSchedule.map((s: any, i: number) => {
      const label = `adSchedule[${i + 1}]`;
      const dayOfWeek = String(s?.dayOfWeek ?? "").toUpperCase();

      if (!DAYS_OF_WEEK.includes(dayOfWeek)) throw new Error(`${label} dayOfWeek must be one of: ${DAYS_OF_WEEK.join(", ")}`);

      const startHour = asHour(s?.startHour, `${label} startHour`);
      const endHour = asHour(s?.endHour, `${label} endHour`);
      if (endHour <= startHour) throw new Error(`${label} endHour must be after startHour`);

      return {
        dayOfWeek: dayOfWeek as GoogleAdsDayOfWeek,
        startHour,
        startMinute: asMinute(s?.startMinute, `${label} startMinute`),
        endHour,
        endMinute: asMinute(s?.endMinute, `${label} endMinute`),
      };
    });
  })();

  const asBidAdjustmentPercent = (value: unknown, label: string): number | undefined => {
    if (value == null) return undefined;

    const percent = Number(value);
    if (!Number.isFinite(percent) || percent < -90 || percent > 900) {
      throw new Error(`${label} must be a percent between -90 and 900`);
    }

    return percent;
  };

  const deviceBidAdjustments: GoogleAdsDeviceBidAdjustments | undefined =
    body.deviceBidAdjustments == null
      ? undefined
      : {
          mobile: asBidAdjustmentPercent(body.deviceBidAdjustments.mobile, "deviceBidAdjustments.mobile"),
          desktop: asBidAdjustmentPercent(body.deviceBidAdjustments.desktop, "deviceBidAdjustments.desktop"),
          tablet: asBidAdjustmentPercent(body.deviceBidAdjustments.tablet, "deviceBidAdjustments.tablet"),
        };

  const sitelinks: GoogleAdsSitelinkInput[] = (() => {
    if (body.sitelinks == null) return [];
    if (!Array.isArray(body.sitelinks)) throw new Error("sitelinks must be an array");

    return body.sitelinks.map((s: any, i: number) => {
      const label = `sitelinks[${i + 1}]`;
      const linkText = String(s?.linkText ?? "").trim();
      if (!linkText || linkText.length > 25) throw new Error(`${label} linkText must be 1-25 characters`);

      const finalUrl = String(s?.finalUrl ?? "").trim();
      if (!/^https?:\/\/.+\..+/.test(finalUrl)) throw new Error(`${label} finalUrl must be an http(s) URL`);

      const descriptionOf = (value: unknown, name: string): string | undefined => {
        if (value == null) return undefined;

        const text = String(value).trim();
        if (text.length > 35) throw new Error(`${label} ${name} must be at most 35 characters`);

        return text || undefined;
      };

      return {
        linkText,
        finalUrl,
        description1: descriptionOf(s?.description1, "description1"),
        description2: descriptionOf(s?.description2, "description2"),
      };
    });
  })();

  const callouts: string[] = (() => {
    if (body.callouts == null) return [];
    if (!Array.isArray(body.callouts)) throw new Error("callouts must be an array");

    return body.callouts.map((c: any, i: number) => {
      const text = String(c ?? "").trim();
      if (!text || text.length > 25) throw new Error(`callouts[${i + 1}] must be 1-25 characters`);

      return text;
    });
  })();

  const structuredSnippets: GoogleAdsStructuredSnippetInput[] = (() => {
    if (body.structuredSnippets == null) return [];
    if (!Array.isArray(body.structuredSnippets)) throw new Error("structuredSnippets must be an array");

    return body.structuredSnippets.map((s: any, i: number) => {
      const label = `structuredSnippets[${i + 1}]`;
      const header = String(s?.header ?? "").trim();
      if (!header) throw new Error(`${label} header is required (e.g. "Brands", "Styles", "Types")`);

      if (!Array.isArray(s?.values) || s.values.length === 0) throw new Error(`${label} needs at least one value`);
      const values = s.values.map((v: any, j: number) => {
        const text = String(v ?? "").trim();
        if (!text || text.length > 25) throw new Error(`${label} value ${j + 1} must be 1-25 characters`);

        return text;
      });

      return { header, values };
    });
  })();

  const calls: GoogleAdsCallInput[] = (() => {
    if (body.calls == null) return [];
    if (!Array.isArray(body.calls)) throw new Error("calls must be an array");

    return body.calls.map((c: any, i: number) => {
      const label = `calls[${i + 1}]`;
      const phoneNumber = String(c?.phoneNumber ?? "").trim();
      if (!phoneNumber) throw new Error(`${label} phoneNumber is required`);

      const countryCode = String(c?.countryCode ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error(`${label} countryCode must be a 2-letter ISO country code`);

      return { phoneNumber, countryCode };
    });
  })();

  const keywordsOf = (list: any, label: string): GoogleAdsCreateKeywordInput[] => {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${label} needs at least one keyword`);

    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} keyword ${i + 1}: text is required`);
      const bidAmount =
        k?.bidAmount == null
          ? undefined
          : asPositiveNumber(k.bidAmount, `${label} keyword ${i + 1} bidAmount`);
      if (manualBids && bidAmount == null) throw new Error(`${label} keyword ${i + 1}: bidAmount is required for MANUAL_CPC`);

      return { text, matchType: asMatchType(k?.matchType, `${label} keyword ${i + 1} matchType`), bidAmount };
    });
  };
  const negativesOf = (list: any, label: string): GoogleAdsCreateNegativeInput[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`${label} negativeKeywords must be an array`);

    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} negative keyword ${i + 1}: text is required`);

      return { text, matchType: asMatchType(k?.matchType, `${label} negative keyword ${i + 1} matchType`) };
    });
  };
  const idsOf = (list: any, label: string): (string | number)[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`${label} must be an array of numeric ids`);

    return list.map((v: any, i: number) => {
      const id = String(v ?? "").trim();
      if (!/^\d+$/.test(id)) throw new Error(`${label} [${i + 1}] must be a numeric id`);
      return id;
    });
  };

  return {
    name,
    dailyBudgetAmount: asPositiveNumber(body.dailyBudgetAmount, "dailyBudgetAmount"),
    currency: body.currency != null ? String(body.currency).toUpperCase() : undefined,
    status: status as "ENABLED" | "PAUSED",
    startDate: body.startDate != null ? asDate(body.startDate, "startDate") : undefined,
    endDate: body.endDate != null ? asDate(body.endDate, "endDate") : undefined,
    adGroups: body.adGroups.map((g: any, i: number) => {
      const label = `Ad group ${i + 1}`;
      const groupName = String(g?.name ?? "").trim();
      if (!groupName) throw new Error(`${label}: name is required`);
      const groupStatus = g?.status == null ? "ENABLED" : String(g.status).toUpperCase();

      if (groupStatus !== "ENABLED" && groupStatus !== "PAUSED") {
        throw new Error(`${label}: status must be "ENABLED" or "PAUSED"`);
      }

      if (g?.ads != null && !Array.isArray(g.ads)) throw new Error(`${label}: ads must be an array`);
      const ads = (g?.ads ?? []).map((a: any, i: number) => validateRsaInput(a, `${label} ad ${i + 1}`));
      const defaultBidAmount =
        g?.defaultBidAmount == null ? undefined : asPositiveNumber(g.defaultBidAmount, `${label} defaultBidAmount`);
      if (manualBids && defaultBidAmount == null) throw new Error(`${label}: defaultBidAmount is required for MANUAL_CPC`);

      return {
        name: groupName,
        defaultBidAmount,
        status: groupStatus as "ENABLED" | "PAUSED",
        keywords: keywordsOf(g?.keywords, label),
        negativeKeywords: negativesOf(g?.negativeKeywords, label),
        ads,
      };
    }),
    negativeKeywords: negativesOf(body.negativeKeywords, "Campaign"),
    locationIds: idsOf(body.locationIds, "locationIds"),
    languageIds: idsOf(body.languageIds, "languageIds"),
    biddingStrategy: biddingStrategy as GoogleAdsBiddingStrategy,
    cpcBidCeiling,
    targetCpa,
    targetRoas,
    adSchedule,
    deviceBidAdjustments,
    sitelinks,
    callouts,
    structuredSnippets,
    calls,
  };
}

