import type { CampaignDraft } from "./useCampaignDraft";

export function validateBasics(d: CampaignDraft): string | null {
  if (!d.name.trim()) return "Please enter a campaign name.";
  if (!(Number(d.dailyBudget) > 0)) return "Please enter a daily budget greater than 0.";

  return null;
}

export function validateBidding(d: CampaignDraft): string | null {
  if (d.biddingStrategy === "TARGET_CPA" && !(Number(d.targetCpa) > 0))
    return "Target CPA is required for the TARGET_CPA strategy.";
  if (d.biddingStrategy === "TARGET_ROAS" && !(Number(d.targetRoas) > 0))
    return "Target ROAS is required for the TARGET_ROAS strategy.";

  return null;
}

export function validateAdGroups(d: CampaignDraft): string | null {
  if (d.campaignNegatives.some((k) => !k.text.trim())) return "A campaign negative keyword has no text.";
  for (const [i, g] of d.adGroups.entries()) {
    if (!g.name.trim()) return `Ad group ${i + 1} needs a name.`;
    if (d.manualBids && !(Number(g.defaultBid) > 0))
      return `Ad group "${g.name || i + 1}" needs a default bid greater than 0.`;
    if (g.keywords.length === 0) return `Ad group "${g.name || i + 1}" needs at least one keyword.`;
    for (const k of g.keywords) {
      if (!k.text.trim()) return `Ad group "${g.name || i + 1}" has a keyword without text.`;
      if (d.manualBids && !(Number(k.bid) > 0))
        return `Keyword "${k.text || "?"}" in ad group "${g.name || i + 1}" needs a bid greater than 0.`;
    }
    if (g.negatives.some((k) => !k.text.trim()))
      return `Ad group "${g.name || i + 1}" has a negative keyword without text.`;
  }

  return null;
}

export function validateExtras(d: CampaignDraft): string | null {
  for (const [i, s] of d.adSchedule.entries()) {
    const startHour = Number(s.startHour);
    const endHour = Number(s.endHour);

    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || endHour <= startHour)
      return `Ad schedule window ${i + 1} needs a valid hour range.`;
  }
  for (const [i, s] of d.sitelinks.entries()) {
    if (!s.linkText.trim() || !s.finalUrl.trim()) return `Sitelink ${i + 1} needs link text and a URL.`;
  }
  if (d.callouts.some((c) => !c.trim())) return "A callout has no text.";
  for (const [i, s] of d.structuredSnippets.entries()) {
    if (!s.header.trim() || !s.valuesText.trim())
      return `Structured snippet ${i + 1} needs a header and values.`;
  }
  for (const [i, c] of d.calls.entries()) {
    if (!c.phoneNumber.trim() || !/^[A-Z]{2}$/.test(c.countryCode))
      return `Call extension ${i + 1} needs a phone number and a 2-letter country code.`;
  }

  return null;
}

export const STEP_VALIDATORS = [validateBasics, validateBidding, validateAdGroups, validateExtras];
