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

export interface GoogleAdsSearchTerm extends GoogleAdsStats {
  searchTerm: string;
  status: string;
  adGroupId: string;
  adGroupName: string | null;
  keywordText: string | null;
  matchType: string | null;
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
  entity:
    | "campaign_budget"
    | "campaign"
    | "ad_group"
    | "ad_group_criterion"
    | "campaign_criterion"
    | "ad_group_ad"
    | "asset"
    | "campaign_asset";
  operation: "create" | "update" | "remove";
  resource: Record<string, any> | string;
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
  bidAmount?: number;
}

export interface GoogleAdsCreateNegativeInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
}

export interface GoogleAdsCreateRsaInput {
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  path1?: string;
  path2?: string;
  status?: "ENABLED" | "PAUSED";
}

export interface GoogleAdsCreatedRsa {
  id: string;
  resourceName: string;
}

export interface GoogleAdsCreateAdGroupInput {
  name: string;
  defaultBidAmount?: number;
  status: "ENABLED" | "PAUSED";
  keywords: GoogleAdsCreateKeywordInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
  ads?: GoogleAdsCreateRsaInput[];
}

export type GoogleAdsDayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export type GoogleAdsMinuteOfHour = 0 | 15 | 30 | 45;

export interface GoogleAdsAdScheduleInput {
  dayOfWeek: GoogleAdsDayOfWeek;
  startHour: number;
  startMinute?: GoogleAdsMinuteOfHour;
  endHour: number;
  endMinute?: GoogleAdsMinuteOfHour;
}

export interface GoogleAdsDeviceBidAdjustments {
  mobile?: number;
  desktop?: number;
  tablet?: number;
}

export interface GoogleAdsSitelinkInput {
  linkText: string;
  finalUrl: string;
  description1?: string;
  description2?: string;
}

export interface GoogleAdsStructuredSnippetInput {
  header: string;
  values: string[];
}

export interface GoogleAdsCallInput {
  phoneNumber: string;
  countryCode: string;
}

export type GoogleAdsBiddingStrategy =
  | "MANUAL_CPC"
  | "MAXIMIZE_CLICKS"
  | "MAXIMIZE_CONVERSIONS"
  | "TARGET_CPA"
  | "TARGET_ROAS";

export interface GoogleAdsCreateCampaignInput {
  name: string;
  dailyBudgetAmount: number;
  currency?: string;
  status: "ENABLED" | "PAUSED";
  startDate?: string;
  endDate?: string;
  adGroups: GoogleAdsCreateAdGroupInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
  locationIds?: (string | number)[];
  languageIds?: (string | number)[];
  displayNetworkEnabled?: boolean;
  searchPartnersEnabled?: boolean;
  presenceOnlyTargeting?: boolean;
  biddingStrategy?: GoogleAdsBiddingStrategy;
  cpcBidCeiling?: number;
  targetCpa?: number;
  targetRoas?: number;
  adSchedule?: GoogleAdsAdScheduleInput[];
  deviceBidAdjustments?: GoogleAdsDeviceBidAdjustments;
  sitelinks?: GoogleAdsSitelinkInput[];
  callouts?: string[];
  structuredSnippets?: GoogleAdsStructuredSnippetInput[];
  calls?: GoogleAdsCallInput[];
}

export interface GoogleAdsCampaignTargeting {
  locations: { criterionId: string; geoTargetConstant: string }[];
  languages: { criterionId: string; languageConstant: string }[];
}

export interface GoogleAdsCampaignBidding {
  strategy: string | null;
  cpcBidCeiling: number | null;
  targetCpa: number | null;
  targetRoasPercent: number | null;
}

export interface GoogleAdsCreatedCampaign {
  id: string;
  name: string;
  status: string;
  biddingStrategy: string;
  budgetResourceName: string;
  adGroups: { id: string; name: string; keywords: { id: string; text: string }[]; ads: GoogleAdsCreatedRsa[] }[];
  locations: string[];
  languages: string[];
  targetingResourceNames: string[];
  adScheduleCount: number;
  assetsCreated: number;
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
