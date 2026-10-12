-- Track Apple campaign-link downloads/purchases per territory instead of only per day.
-- Existing rows (aggregated across territories before this change) get the "ZZ" sentinel.
ALTER TABLE "AppStoreCampaignMetrics" ADD COLUMN "territory" TEXT NOT NULL DEFAULT 'ZZ';

DROP INDEX "AppStoreCampaignMetrics_bundleId_campaign_reportDate_key";
CREATE UNIQUE INDEX "AppStoreCampaignMetrics_bundleId_campaign_reportDate_terri_key" ON "AppStoreCampaignMetrics"("bundleId", "campaign", "reportDate", "territory");
