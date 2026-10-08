-- RevenueCat Secret API keys are scoped per RevenueCat project (one app),
-- not per developer account, so the connection moves from TeamSettings to App.

-- AlterTable
ALTER TABLE "TeamSettings" DROP COLUMN IF EXISTS "revenueCatProjectId";
ALTER TABLE "TeamSettings" DROP COLUMN IF EXISTS "revenueCatProjectName";
ALTER TABLE "TeamSettings" DROP COLUMN IF EXISTS "revenueCatApiKey";
ALTER TABLE "TeamSettings" DROP COLUMN IF EXISTS "revenueCatConnectedAt";

-- AlterTable
ALTER TABLE "App" ADD COLUMN "revenueCatProjectId" TEXT;
ALTER TABLE "App" ADD COLUMN "revenueCatProjectName" TEXT;
ALTER TABLE "App" ADD COLUMN "revenueCatApiKey" TEXT;
ALTER TABLE "App" ADD COLUMN "revenueCatConnectedAt" TIMESTAMP(3);
