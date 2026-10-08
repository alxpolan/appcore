import axios from "./utils/http";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../config";

const API_BASE = "https://api.revenuecat.com/v2";
const CUSTOMERS_PAGE_SIZE = 100;
const EVENTS_PAGE_SIZE = 100;
const CUSTOMER_CONCURRENCY = 5;
const MAX_RETRIES = 3;

const REVENUE_EVENT_TYPES = new Set([
  "PURCHASES_INITIAL_PURCHASE",
  "PURCHASES_RENEWAL",
  "PURCHASES_NON_RENEWING_PURCHASE",
]);

export interface RevenueCatProjectOption {
  projectId: string;
  projectName: string;
}

interface RevenueCatProject {
  id: string;
  object: string;
  name: string;
  created_at: number;
}

interface RevenueCatList<T> {
  object: "list";
  items: T[];
  next_page?: string | null;
  url: string;
}

interface RevenueCatCustomerRaw {
  id: string;
  object: string;
  last_seen_app_version: string | null;
  last_seen_country: string | null;
  last_seen_platform: string | null;
  last_seen_platform_version: string | null;
  apple_attribution?: Record<string, unknown> | null;
}

interface RevenueCatAttributeRaw {
  object: "customer.attribute";
  name: string;
  value: string | null;
  updated_at: number;
}

interface RevenueCatEventBody {
  app_user_id: string;
  country_code: string | null;
  environment: "SANDBOX" | "PRODUCTION";
  product_id: string;
  store: string;
  period_type: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
  purchased_at_ms: number;
  price: number | null;
  tax_percentage: number | null;
  commission_percentage: number | null;
  renewal_number?: number;
  is_trial_conversion?: boolean;
  transaction_id: string;
}

interface RevenueCatEventRaw {
  object: "customer.event";
  id: string;
  app_id: string | null;
  type: string;
  body: RevenueCatEventBody;
  created_at: number;
  occurred_at: number | null;
}

export interface RevenueCatSyncResult {
  customers: number;
  events: number;
}

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWithRetry<T>(url: string, apiKey: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios.get<T>(url, {
        baseURL: /^https?:\/\//i.test(url) ? undefined : "https://api.revenuecat.com",
        headers: authHeaders(apiKey),
      });

      return res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        const backoffMs =
          Number(err.response?.data?.backoff_ms) || Number(err.response?.headers?.["retry-after"]) * 1000 || 1000;
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }
}

async function paginate<T>(firstUrl: string, apiKey: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = firstUrl;

  while (url) {
    const page: RevenueCatList<T> = await getWithRetry<RevenueCatList<T>>(url, apiKey);
    items.push(...(page.items ?? []));
    url = page.next_page ?? null;
  }
  return items;
}

async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

export async function listRevenueCatProjects(apiKey: string): Promise<RevenueCatProjectOption[]> {
  const res = await axios.get<{ items: RevenueCatProject[] }>(`${API_BASE}/projects`, {
    headers: authHeaders(apiKey),
  });

  const projects = res.data.items ?? [];
  if (projects.length === 0) {
    throw new Error("No RevenueCat projects are visible to this API key");
  }

  return projects.map((p) => ({ projectId: p.id, projectName: p.name }));
}

async function listAllCustomers(apiKey: string, projectId: string): Promise<RevenueCatCustomerRaw[]> {
  return paginate<RevenueCatCustomerRaw>(
    `${API_BASE}/projects/${projectId}/customers?limit=${CUSTOMERS_PAGE_SIZE}`,
    apiKey,
  );
}

async function getCustomerAttributes(
  apiKey: string,
  projectId: string,
  customerId: string,
): Promise<Record<string, string | null>> {
  const attrs = await paginate<RevenueCatAttributeRaw>(
    `${API_BASE}/projects/${projectId}/customers/${customerId}/attributes?limit=100`,
    apiKey,
  );
  return Object.fromEntries(attrs.map((a) => [a.name, a.value]));
}

function toDate(ms: number): Date {
  return new Date(ms);
}

export async function syncRevenueCatTransactions(
  apiKey: string,
  projectId: string,
  bundleId: string,
): Promise<RevenueCatSyncResult> {
  const customers = await listAllCustomers(apiKey, projectId);
  logger.info(`[revenuecat] syncing ${customers.length} customers for ${bundleId}`);

  let eventCount = 0;

  await runConcurrent(customers, CUSTOMER_CONCURRENCY, async (customer) => {
    const customerId = customer.id;
    const [events, attributes, customerDetail] = await Promise.all([
      paginate<RevenueCatEventRaw>(
        `${API_BASE}/projects/${projectId}/customers/${customerId}/events?environment=production&limit=${EVENTS_PAGE_SIZE}`,
        apiKey,
      ),
      getCustomerAttributes(apiKey, projectId, customerId),
      getWithRetry<RevenueCatCustomerRaw>(`${API_BASE}/projects/${projectId}/customers/${customerId}`, apiKey),
    ]);

    const customerDims = { bundleId, customerId };
    const customerFields = {
      platform: customer.last_seen_platform,
      platformVersion: customer.last_seen_platform_version,
      appVersion: customer.last_seen_app_version,
      country: customer.last_seen_country,
      attributes,
      appleAttribution: ((customerDetail.apple_attribution ?? customer.apple_attribution) as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      syncedAt: new Date(),
    };
    await prisma.revenueCatCustomer.upsert({
      where: { revenueCatCustomerKey: customerDims },
      create: { ...customerDims, ...customerFields },
      update: customerFields,
    });

    const revenueEvents = events.filter((e) => REVENUE_EVENT_TYPES.has(e.type));

    await Promise.all(
      revenueEvents.map((e) => {
        const b = e.body;
        const dims = { bundleId, rcId: e.id };
        const gross = b.price ?? 0;
        const tax = gross * (b.tax_percentage ?? 0);
        const commission = gross * (b.commission_percentage ?? 0);
        const fields = {
          customerId: b.app_user_id,
          productId: b.product_id,
          store: b.store,
          environment: "production",
          eventType: e.type.replace(/^PURCHASES_/, ""),
          periodType: b.period_type,
          isTrialConversion: b.is_trial_conversion ?? false,
          renewalNumber: b.renewal_number ?? null,
          transactionId: b.transaction_id,
          country: b.country_code,
          occurredAt: toDate(e.occurred_at ?? b.purchased_at_ms),
          quantity: 1,
          grossUsd: gross,
          commissionUsd: commission,
          taxUsd: tax,
          proceedsUsd: gross - tax - commission,
          syncedAt: new Date(),
        };
        return prisma.revenueCatTransaction.upsert({
          where: { revenueCatTransactionKey: dims },
          create: { ...dims, ...fields },
          update: fields,
        });
      }),
    );
    eventCount += revenueEvents.length;
  });

  return { customers: customers.length, events: eventCount };
}
