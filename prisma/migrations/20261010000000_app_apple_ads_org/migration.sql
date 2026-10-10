-- Move the Apple Search Ads campaign group (org) from team level to per-app mapping.
ALTER TABLE "App" ADD COLUMN "appleAdsOrgId" TEXT;
ALTER TABLE "App" ADD COLUMN "appleAdsOrgName" TEXT;

-- Carry the existing team-wide org over to all own apps of connected teams.
UPDATE "App"
SET "appleAdsOrgId" = "TeamSettings"."appleAdsOrgId",
    "appleAdsOrgName" = "TeamSettings"."appleAdsOrgName"
FROM "TeamSettings"
WHERE "App"."teamId" = "TeamSettings"."teamId"
  AND "App"."isOwnApp" = true
  AND "TeamSettings"."appleAdsOrgId" IS NOT NULL;

ALTER TABLE "TeamSettings" DROP COLUMN "appleAdsOrgId";
ALTER TABLE "TeamSettings" DROP COLUMN "appleAdsOrgName";
