export interface GoogleAdsCredentials {
  customerId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken?: string;
}

export interface GoogleAdsStats {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  conversionRate: number | null;
}

export interface GoogleAdsCampaign extends GoogleAdsStats {
  id: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  currency: string | null;
}

export interface GoogleAdsAdGroup extends GoogleAdsStats {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  defaultCpcBid: number | null;
  currency: string | null;
}

export interface GoogleAdsKeyword extends GoogleAdsStats {
  id: string;
  adGroupId: string;
  text: string;
  matchType: string;
  status: string;
  cpcBid: number | null;
  currency: string | null;
}

export interface GoogleAdsAdGroupWithKeywords extends GoogleAdsAdGroup {
  keywords: GoogleAdsKeyword[];
}

export interface GoogleAdsNegativeKeyword {
  id: string;
  text: string;
  matchType: string;
  status: string;
}

export interface GoogleAdsCountryStats extends GoogleAdsStats {
  countryOrRegion: string;
  countryName: string | null;
}

export interface GoogleAdsReportRange {
  startDate: string;
  endDate: string;
}

export interface GoogleAdsMutationOperation {
  entity: "campaign_budget" | "campaign" | "ad_group" | "ad_group_criterion" | "campaign_criterion";
  operation: "create" | "update" | "remove";
  resource: Record<string, any>;
}

export interface GoogleAdsGateway {
  query(gaql: string): Promise<any[]>;
  mutate(operations: GoogleAdsMutationOperation[]): Promise<string[]>;
  listAccessibleCustomers(): Promise<string[]>;
}

export type GoogleAdsKeywordMatchType = "EXACT" | "PHRASE" | "BROAD";

export interface GoogleAdsCreateKeywordInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
  bidAmount: number;
}

export interface GoogleAdsCreateNegativeInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
}

export interface GoogleAdsCreateAdGroupInput {
  name: string;
  defaultBidAmount: number;
  status: "ENABLED" | "PAUSED";
  keywords: GoogleAdsCreateKeywordInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
}

export interface GoogleAdsCreateCampaignInput {
  name: string;
  dailyBudgetAmount: number;
  currency?: string;
  status: "ENABLED" | "PAUSED";
  startDate?: string;
  endDate?: string;
  adGroups: GoogleAdsCreateAdGroupInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
}

export interface GoogleAdsCreatedCampaign {
  id: string;
  name: string;
  status: string;
  budgetResourceName: string;
  adGroups: { id: string; name: string; keywords: { id: string; text: string }[] }[];
}

export interface GoogleAdsAddKeywordInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
  bidAmount?: number;
  status?: "ENABLED" | "PAUSED";
}

export interface GoogleAdsUpdateKeywordInput {
  keywordId: string;
  bidAmount?: number;
  status?: "ENABLED" | "PAUSED";
}
