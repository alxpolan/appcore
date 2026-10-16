export interface AppleAdsCredentials {
  orgId: string;
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleAdsOrgCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleAdsOrgOption {
  orgId: string;
  orgName: string;
}

export interface AppleAdsStats {
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  ttr: number | null;
  avgCpt: number | null;
  avgCpa: number | null;
  conversionRate: number | null;
}

export interface AppleAdsCampaign extends AppleAdsStats {
  id: string;
  orgId: string;
  name: string;
  status: string;
  servingStatus: string;
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string | null;
  countriesOrRegions: string[];
  startTime: string | null;
  endTime: string | null;
}

export interface AppleAdsAdGroup extends AppleAdsStats {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  servingStatus: string;
  defaultBidAmount: number | null;
  cpaGoal: number | null;
  currency: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface AppleAdsKeyword extends AppleAdsStats {
  id: string;
  adGroupId: string;
  text: string;
  matchType: string;
  status: string;
  bidAmount: number | null;
  currency: string | null;
}

export interface AppleAdsAdGroupWithKeywords extends AppleAdsAdGroup {
  keywords: AppleAdsKeyword[];
}

export interface AppleAdsSearchTerm extends AppleAdsStats {
  searchTerm: string;
  searchTermSource: string | null;
  adGroupId: string;
  adGroupName: string | null;
  keywordId: string | null;
  keyword: string | null;
  matchType: string | null;
  /** True when Apple gave no term breakdown: row shows the keyword total instead. */
  keywordTotal: boolean;
}

export interface AppleAdsReportRange {
  startDate: string;
  endDate: string;
}

export class AppleAdsCampaignNotFoundError extends Error {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} was not found in any mapped campaign group`);
    this.name = "AppleAdsCampaignNotFoundError";
  }
}

export interface AppleAdsCampaignObject {
  id: string;
  name: string;
  status: string;
  adamId: number | null;
}

export interface AppleAdsCountryStats extends AppleAdsStats {
  countryOrRegion: string;
}

export interface AppleAdsStoreApp {
  adamId: string;
  name: string;
}

export interface CreateAppleAdsKeywordInput {
  text: string;
  matchType: "EXACT" | "BROAD";
  bidAmount?: number;
}

export interface CreateAppleAdsNegativeKeywordInput {
  text: string;
  matchType: "EXACT" | "BROAD";
}

export interface AppleAdsNegativeKeyword {
  id: string;
  text: string;
  matchType: string;
  status: string | null;
}

export interface CreateAppleAdsAdGroupInput {
  name: string;
  defaultBidAmount: number;
  cpaGoal?: number;
  status?: "ENABLED" | "PAUSED";
  keywords?: CreateAppleAdsKeywordInput[];
  negativeKeywords?: CreateAppleAdsNegativeKeywordInput[];
}

export interface CreateAppleAdsCampaignInput {
  name: string;
  adamId: number;
  countriesOrRegions: string[];
  dailyBudgetAmount: number;
  budgetAmount?: number;
  currency: string;
  supplySources: string[];
  status?: "ENABLED" | "PAUSED";
  startTime?: string;
  pricingModel?: "CPC" | "CPM";
  adGroups: CreateAppleAdsAdGroupInput[];
  negativeKeywords?: CreateAppleAdsNegativeKeywordInput[];
}

export interface CreatedAppleAdsCampaign {
  id: string;
  name: string;
  status: string;
  negativeKeywordCount: number;
  adGroups: { id: string; name: string; keywordCount: number; negativeKeywordCount: number }[];
}

export interface UpdateAppleAdsCampaignInput {
  name?: string;
  status?: "ENABLED" | "PAUSED";
  dailyBudgetAmount?: number;
  currency?: string;
  countriesOrRegions?: string[];
}

export interface UpdateAppleAdsAdGroupInput {
  name?: string;
  status?: "ENABLED" | "PAUSED";
  defaultBidAmount?: number;
  cpaGoal?: number;
  currency?: string;
}

export interface UpdateAppleAdsKeywordInput {
  keywordId: string;
  bidAmount?: number;
  status?: "ACTIVE" | "PAUSED";
}
