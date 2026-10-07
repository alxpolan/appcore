-- AlterTable
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsOrgId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsOrgName" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsClientId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsTeamId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsKeyId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsPrivateKey" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "appleAdsConnectedAt" TIMESTAMP(3);
