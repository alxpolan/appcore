-- AlterTable
ALTER TABLE "RevenueCatTransaction" DROP COLUMN IF EXISTS "subscriptionStartsAt";
ALTER TABLE "RevenueCatTransaction" ADD COLUMN "renewalCount" INTEGER NOT NULL DEFAULT 0;
