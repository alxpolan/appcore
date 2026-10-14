import { GoogleAdsApi, errors } from "google-ads-api";
import { FakeGoogleAdsGateway } from "./google-ads-fake-gateway";
import type { GoogleAdsCredentials, GoogleAdsGateway, GoogleAdsMutationOperation } from "./google-ads-types";

function stringifyDetail(value: unknown): string {
  if (typeof value === "string" && value) return value;
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}" && json !== "[]") return json.slice(0, 2000);
  } catch {
    /* fall through */
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
    const res: any = await this.customer().mutateResources(operations as any);
    const list = res.mutate_operation_responses ?? res.results ?? [];

    return list.map((r: any) => String(r.resource_name ?? ""));
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
