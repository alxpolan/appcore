-- RevenueCat first-seen timestamp per customer (install/open proxy for Google Ads click matching).
ALTER TABLE "RevenueCatCustomer" ADD COLUMN "firstSeenAt" TIMESTAMP(3);
CREATE INDEX "RevenueCatCustomer_bundleId_firstSeenAt_idx" ON "RevenueCatCustomer"("bundleId", "firstSeenAt");
