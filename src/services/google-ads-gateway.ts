import { GoogleAdsApi, errors } from "google-ads-api";
import { FakeGoogleAdsGateway } from "./google-ads-fake-gateway";
import type { GoogleAdsCredentials, GoogleAdsGateway, GoogleAdsMutationOperation } from "./google-ads-types";

function stringifyDetail(value: unknown): string {
  if (typeof value === "string" && value) return value;
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}" && json !== "[]") return json.slice(0, 2000);
  } catch {
  }

  return String(value);
}

export function googleAdsErrorMessage(err: any, context: string): string {
  if (err instanceof errors.GoogleAdsFailure) {
    const details = (err.errors ?? [])
      .map((e: any) => e?.message ?? e?.error_code?.toString?.() ?? stringifyDetail(e))
      .filter(Boolean)
      .join("; ");

    return `Google Ads ${context} failed${details ? `: ${details}` : ""}`;
  }

  return `Google Ads ${context} failed: ${stringifyDetail(err?.message ?? err?.errors ?? err)}`;
}

function responseResourceName(r: any): string {
  if (!r || typeof r !== "object") return "";
  const direct = r.resource_name ?? r.resourceName;
  if (typeof direct === "string" && direct) return direct;
  for (const v of Object.values(r)) {
    if (v && typeof v === "object") {
      const nested = (v as any).resource_name ?? (v as any).resourceName;
      if (typeof nested === "string" && nested) return nested;
    }
  }

  return "";
}

export function parseMutateResourceNames(res: any): string[] {
  const list = res?.mutate_operation_responses ?? res?.mutateOperationResponses ?? res?.results ?? [];

  return (Array.isArray(list) ? list : []).map(responseResourceName);
}

class RealGoogleAdsGateway implements GoogleAdsGateway {
  private client: InstanceType<typeof GoogleAdsApi>;
  private creds: GoogleAdsCredentials;

  constructor(creds: GoogleAdsCredentials) {
    this.creds = creds;
    this.client = new GoogleAdsApi({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      developer_token: creds.developerToken,
    });
  }

  private customer() {
    return this.client.Customer({ customer_id: this.creds.customerId, refresh_token: this.creds.refreshToken });
  }

  async query(gaql: string): Promise<any[]> {
    return this.customer().query(gaql);
  }

  async mutate(operations: GoogleAdsMutationOperation[]): Promise<string[]> {
    if (operations.length === 0) return [];
    const res: any = await this.customer().mutateResources(operations as any);

    return parseMutateResourceNames(res);
  }

  async listAccessibleCustomers(): Promise<string[]> {
    const res: any = await this.client.listAccessibleCustomers(this.creds.refreshToken);

    return (res.resource_names ?? []) as string[];
  }
}

export function googleAdsGateway(creds: GoogleAdsCredentials): GoogleAdsGateway {
  if (process.env.GOOGLE_ADS_FAKE === "1") return new FakeGoogleAdsGateway(creds);

  return new RealGoogleAdsGateway(creds);
}
