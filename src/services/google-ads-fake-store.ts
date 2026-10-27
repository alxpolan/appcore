export interface FakeMetrics {
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface FakeCampaign {
  id: string;
  name: string;
  status: string;
  budgetId: string;
  budgetMicros: number | null;
  startDate: string | null;
  endDate: string | null;
  metrics: FakeMetrics;
  removed: boolean;
  biddingStrategy: string;
  biddingCeilingMicros: number | null;
  biddingTargetCpaMicros: number | null;
  biddingTargetRoas: number | null;
  displayNetwork: boolean;
  searchPartners: boolean;
  presenceOnly: boolean;
}

export interface FakeAdGroup {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  defaultCpcMicros: number | null;
  metrics: FakeMetrics;
  removed: boolean;
}

export interface FakeCriterion {
  id: string;
  adGroupId: string | null;
  campaignId: string;
  text: string;
  matchType: string;
  status: string;
  negative: boolean;
  cpcBidMicros: number | null;
  metrics: FakeMetrics;
  removed: boolean;
  locationId: string | null;
  languageId: string | null;
}

export interface FakeStore {
  campaigns: Map<string, FakeCampaign>;
  adGroups: Map<string, FakeAdGroup>;
  criteria: Map<string, FakeCriterion>;
  ads: Map<string, { id: string; adGroupId: string }>;
  countries: Map<string, { code: string; name: string; metrics: FakeMetrics }[]>;
  nextId: number;
}

const fakeStores = new Map<string, FakeStore>();

export function fakeStoreFor(customerId: string): FakeStore {
  let store = fakeStores.get(customerId);

  if (!store) {
    store = {
      campaigns: new Map(),
      adGroups: new Map(),
      criteria: new Map(),
      ads: new Map(),
      countries: new Map(),
      nextId: 1000,
    };
    fakeStores.set(customerId, store);
  }

  return store;
}

export function blankMetrics(): FakeMetrics {
  return { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
}

export function resetFakeGoogleAds(customerId?: string): void {
  if (customerId) fakeStores.delete(customerId);
  else fakeStores.clear();
}

export function getFakeGoogleAdsCampaign(
  customerId: string,
  campaignId: string,
): {
  id: string;
  name: string;
  displayNetwork: boolean;
  searchPartners: boolean;
  presenceOnly: boolean;
  biddingStrategy: string;
} | null {
  const c = fakeStores.get(customerId)?.campaigns.get(campaignId);
  if (!c || c.removed) return null;

  return {
    id: c.id,
    name: c.name,
    displayNetwork: c.displayNetwork,
    searchPartners: c.searchPartners,
    presenceOnly: c.presenceOnly,
    biddingStrategy: c.biddingStrategy,
  };
}

export function seedFakeGoogleAdsMetrics(
  customerId: string,
  seed: {
    campaigns?: Record<string, Partial<FakeMetrics>>;
    adGroups?: Record<string, Partial<FakeMetrics>>;
    criteria?: Record<string, Partial<FakeMetrics>>;
    countries?: Record<string, { code: string; name: string; metrics: Partial<FakeMetrics> }[]>;
  },
): void {
  const store = fakeStoreFor(customerId);
  for (const [id, m] of Object.entries(seed.campaigns ?? {})) {
    const c = store.campaigns.get(id);
    if (c) c.metrics = { ...blankMetrics(), ...m };
  }

  for (const [id, m] of Object.entries(seed.adGroups ?? {})) {
    const g = store.adGroups.get(id);
    if (g) g.metrics = { ...blankMetrics(), ...m };
  }

  for (const [key, m] of Object.entries(seed.criteria ?? {})) {
    for (const [storeKey, k] of store.criteria) {
      if (storeKey.endsWith(`:${key}`)) k.metrics = { ...blankMetrics(), ...m };
    }
  }

  for (const [campaignId, list] of Object.entries(seed.countries ?? {})) {
    store.countries.set(
      campaignId,
      list.map((c) => ({ code: c.code, name: c.name, metrics: { ...blankMetrics(), ...c.metrics } })),
    );
  }
}
