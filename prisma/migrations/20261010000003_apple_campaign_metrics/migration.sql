-- Per-day Apple campaign-link metrics (ct token) + Google campaign to token mapping.
CREATE TABLE "AppStoreCampaignMetrics" (
  "id" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "campaign" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "downloads" INTEGER NOT NULL DEFAULT 0,
  "purchases" INTEGER NOT NULL DEFAULT 0,
  "trials" INTEGER NOT NULL DEFAULT 0,
  "proceedsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppStoreCampaignMetrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppStoreCampaignMetrics_bundleId_campaign_reportDate_key" ON "AppStoreCampaignMetrics"("bundleId", "campaign", "reportDate");
CREATE INDEX "AppStoreCampaignMetrics_bundleId_campaign_reportDate_idx" ON "AppStoreCampaignMetrics"("bundleId", "campaign", "reportDate");

CREATE TABLE "GoogleAdsCampaignToken" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "googleCampaignId" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "ctToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleAdsCampaignToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleAdsCampaignToken_teamId_googleCampaignId_key" ON "GoogleAdsCampaignToken"("teamId", "googleCampaignId");
CREATE INDEX "GoogleAdsCampaignToken_teamId_idx" ON "GoogleAdsCampaignToken"("teamId");
ALTER TABLE "GoogleAdsCampaignToken" ADD CONSTRAINT "GoogleAdsCampaignToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsCampaignToken" ADD CONSTRAINT "GoogleAdsCampaignToken_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
