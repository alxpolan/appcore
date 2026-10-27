export type {
  FakeMetrics,
  FakeCampaign,
  FakeAdGroup,
  FakeCriterion,
  FakeStore,
} from "./google-ads-fake-store";
export {
  fakeStoreFor,
  blankMetrics,
  resetFakeGoogleAds,
  getFakeGoogleAdsCampaign,
  seedFakeGoogleAdsMetrics,
} from "./google-ads-fake-store";
export { FakeGoogleAdsGateway } from "./google-ads-fake-gateway-impl";
