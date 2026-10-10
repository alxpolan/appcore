-- Google Ads API credentials (team level, single customer account).
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsClientId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsClientSecret" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsRefreshToken" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsDeveloperToken" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsCustomerId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "googleAdsConnectedAt" TIMESTAMP(3);
