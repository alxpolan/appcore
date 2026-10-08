-- AlterTable
ALTER TABLE "TeamSettings" ADD COLUMN "revenueCatProjectId" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "revenueCatProjectName" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "revenueCatApiKey" TEXT;
ALTER TABLE "TeamSettings" ADD COLUMN "revenueCatConnectedAt" TIMESTAMP(3);
