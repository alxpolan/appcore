import axios, { AxiosInstance } from "./utils/http";
import * as fs from "fs";
import * as path from "path";
import { logger, env } from "../config";
import { generateClientSecret, type AppleAdsOrgCredentials } from "./apple-ads";

interface SearchAdsToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface KeywordInsight {
  keyword: string;
  popularity: number;
  rankRange?: { low: number; high: number };
}

interface SearchTermSource {
  searchTermText: string;
  impressions: number;
  taps: number;
  conversions: number;
  avgCPA: number;
  avgCPT: number;
}

export class AppleSearchAdsClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor() {
    this.client = axios.create({
      baseURL: "https://api.searchads.apple.com/api/v5",
      headers: { "Content-Type": "application/json" },
    });

    this.client.interceptors.request.use(async (config) => {
      const token = await this.authenticate();
      config.headers.Authorization = `Bearer ${token}`;

      if (env.APPLE_ADS_ORG_ID) {
        config.headers["X-AP-Context"] = `orgId=${env.APPLE_ADS_ORG_ID}`;
      }

      return config;
    });
  }

  private clientSecret(): string {
    const keyPath = path.resolve(env.APPLE_ADS_KEY_PATH || "./keys/apple_ads_private_key.pem");

    if (!fs.existsSync(keyPath)) {
      throw new Error(
        `Search Ads private key not found at ${keyPath}. ` + `Download it from Apple Search Ads UI → Settings → API.`,
      );
    }

    const privateKey = fs.readFileSync(keyPath, "utf8");
    const clientId = env.APPLE_ADS_CLIENT_ID || "";
    if (!clientId) throw new Error("APPLE_ADS_CLIENT_ID is required");

    const creds: AppleAdsOrgCredentials = {
      clientId,
      teamId: env.APPLE_ADS_TEAM_ID || clientId,
      keyId: env.APPLE_ADS_KEY_ID || "",
      privateKey,
    };

    return generateClientSecret(creds);
  }

  private async authenticate(): Promise<string> {
    const now = Date.now();

    if (this.accessToken && this.tokenExpiry > now + 60000) {
      return this.accessToken;
    }

    if (!env.APPLE_ADS_CLIENT_ID) {
      throw new Error("Apple Search Ads credentials missing. Set APPLE_ADS_CLIENT_ID.");
    }

    const clientSecret = this.clientSecret();

    const { data } = await axios.post<SearchAdsToken>(
      "https://appleid.apple.com/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.APPLE_ADS_CLIENT_ID,
        client_secret: clientSecret,
        scope: "searchadsorg",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    this.accessToken = data.access_token;
    this.tokenExpiry = now + data.expires_in * 1000;

    logger.info("Authenticated with Apple Search Ads API");

    return this.accessToken;
  }

  async getTargetingKeywords(appId: string, limit = 50): Promise<KeywordInsight[]> {
    const recommended = await this.getRecommendedKeywords(appId, limit);
    if (recommended.length > 0) return recommended;

    try {
      const { data } = await this.client.post("/keywords/targeting", {
        appId,
        limit,
      });

      return (
        data.data?.map((kw: any) => ({
          keyword: kw.text,
          popularity: kw.popularity ?? 0,
        })) ?? []
      );
    } catch (error) {
      logger.warn("Failed to get targeting keywords", {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async getRecommendedKeywords(appId: string, limit = 50): Promise<KeywordInsight[]> {
    try {
      const { data } = await this.client.post("/keywords/recommended", {
        appId,
        limit,
      });

      const results =
        data.data?.map((kw: any) => ({
          keyword: kw.text ?? kw.keyword,
          popularity: kw.popularity ?? 0,
        })) ?? [];

      if (results.length > 0) {
        logger.info(`Got ${results.length} recommended keywords from Search Ads`);
      }

      return results;
    } catch (error) {
      logger.debug("Recommended keywords not available", {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async getSearchTermReport(campaignId: string, startDate: string, endDate: string): Promise<SearchTermSource[]> {
    try {
      const { data } = await this.client.post(`/reports/campaigns/${campaignId}/searchterms`, {
        startTime: startDate,
        endTime: endDate,
        granularity: "DAILY",
        selector: {
          pagination: { offset: 0, limit: 100 },
        },
      });

      return (
        data.data?.reportingDataResponse?.row?.map((row: any) => ({
          searchTermText: row.metadata?.searchTermText ?? "",
          impressions: row.total?.impressions ?? 0,
          taps: row.total?.taps ?? 0,
          conversions: row.total?.conversions ?? 0,
          avgCPA: row.total?.avgCPA?.amount ?? 0,
          avgCPT: row.total?.avgCPT?.amount ?? 0,
        })) ?? []
      );
    } catch (error) {
      logger.warn("Failed to get search term report", {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async getCampaigns(): Promise<any[]> {
    try {
      const { data } = await this.client.get("/campaigns", {
        params: { limit: 100 },
      });

      return data.data ?? [];
    } catch (error) {
      logger.warn("Failed to get campaigns", {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async getKeywordReport(campaignId: string, adGroupId: string, startDate: string, endDate: string): Promise<any[]> {
    try {
      const { data } = await this.client.post(`/reports/campaigns/${campaignId}/adgroups/${adGroupId}/keywords`, {
        startTime: startDate,
        endTime: endDate,
        granularity: "DAILY",
        selector: {
          pagination: { offset: 0, limit: 200 },
        },
      });

      return data.data?.reportingDataResponse?.row ?? [];
    } catch (error) {
      logger.warn("Failed to get keyword report", {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }
}
