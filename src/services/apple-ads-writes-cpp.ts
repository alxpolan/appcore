import axios from "./utils/http";
import { API_BASE, authedHeaders, fetchAppleAdsAccessToken, throwIfAppleError } from "./apple-ads-auth";
import type { AppleAdsAd, AppleAdsCreative, AppleAdsCredentials, AppleAdsProductPage } from "./apple-ads-types";

function toProductPage(row: any): AppleAdsProductPage {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    state: String(row.state ?? ""),
    adamId: Number(row.adamId),
  };
}

function toCreative(row: any): AppleAdsCreative {
  return {
    id: String(row.id),
    adamId: Number(row.adamId),
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    state: String(row.state ?? ""),
    productPageId: row.productPageId != null ? String(row.productPageId) : null,
  };
}

function toAd(row: any): AppleAdsAd {
  return {
    id: String(row.id),
    campaignId: String(row.campaignId),
    adGroupId: String(row.adGroupId),
    creativeId: String(row.creativeId),
    name: String(row.name ?? ""),
    creativeType: String(row.creativeType ?? ""),
    status: String(row.status ?? ""),
    servingStatus: row.servingStatus != null ? String(row.servingStatus) : null,
    deleted: Boolean(row.deleted),
  };
}

export async function listAppleAdsProductPages(
  creds: AppleAdsCredentials,
  adamId: number,
): Promise<AppleAdsProductPage[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.get<any>(`${API_BASE}/apps/${adamId}/product-pages`, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "product page listing");
  const raw = res.data?.data ?? res.data;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return rows.map(toProductPage);
}

export async function createAppleAdsCreative(
  creds: AppleAdsCredentials,
  adamId: number,
  productPageId: string,
  name: string,
): Promise<AppleAdsCreative> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/creatives`,
    { adamId, name, type: "CUSTOM_PRODUCT_PAGE", productPageId },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "creative creation");
  const created = res.data?.data;
  if (created?.id == null) throw new Error("Apple Search Ads creative creation returned no creative id");

  return toCreative(created);
}

export async function listAppleAdsCreatives(creds: AppleAdsCredentials): Promise<AppleAdsCreative[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.get<any>(`${API_BASE}/creatives`, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "creative listing");
  const rows: any[] = Array.isArray(res.data?.data) ? res.data.data : [];

  return rows.map(toCreative);
}

export async function listAppleAdsAds(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId?: string,
): Promise<AppleAdsAd[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/campaigns/${campaignId}/ads/find`,
    { conditions: [], fields: null, orderBy: [], pagination: { limit: 1000, offset: 0 } },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "ad listing");
  const rows: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
  const ads = rows.filter((row) => !row.deleted).map(toAd);

  return adGroupId ? ads.filter((ad) => ad.adGroupId === String(adGroupId)) : ads;
}

export async function createAppleAdsAd(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  creativeId: string,
  name: string,
  status: "ENABLED" | "PAUSED",
): Promise<AppleAdsAd> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/ads`,
    { creativeId: Number(creativeId), name, status },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "ad creation");
  const created = res.data?.data;
  if (created?.id == null) throw new Error("Apple Search Ads ad creation returned no ad id");

  return toAd(created);
}

export async function updateAppleAdsAdCreative(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  adId: string,
  patch: { creativeId?: string; name?: string; status?: "ENABLED" | "PAUSED" },
): Promise<AppleAdsAd> {
  const body: Record<string, unknown> = {};

  if (patch.creativeId != null) body.creativeId = Number(patch.creativeId);
  if (patch.name != null) body.name = patch.name;
  if (patch.status != null) body.status = patch.status;

  if (Object.keys(body).length === 0) throw new Error("Nothing to update: pass at least one field");

  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.put<any>(`${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/ads/${adId}`, body, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "ad update");
  const updated = res.data?.data;
  if (updated?.id == null) throw new Error("Apple Search Ads ad update returned no ad");

  return toAd(updated);
}

export async function assignCustomProductPageToAdGroup(
  creds: AppleAdsCredentials,
  adamId: number,
  campaignId: string,
  adGroupId: string,
  productPageId: string,
  name: string,
  status: "ENABLED" | "PAUSED",
): Promise<{ ad: AppleAdsAd; creative: AppleAdsCreative }> {
  const existingCreatives = await listAppleAdsCreatives(creds);
  const reusableCreative = existingCreatives.find((row) => row.productPageId === productPageId);
  const creative = reusableCreative ?? (await createAppleAdsCreative(creds, adamId, productPageId, name));
  const existingAds = await listAppleAdsAds(creds, campaignId, adGroupId);
  const existingCppAd = existingAds.find((row) => row.creativeType === "CUSTOM_PRODUCT_PAGE");

  if (existingCppAd) {
    const ad = await updateAppleAdsAdCreative(creds, campaignId, adGroupId, existingCppAd.id, {
      creativeId: creative.id,
      name,
      status,
    });

    return { ad, creative };
  }

  const ad = await createAppleAdsAd(creds, campaignId, adGroupId, creative.id, name, status);

  return { ad, creative };
}
