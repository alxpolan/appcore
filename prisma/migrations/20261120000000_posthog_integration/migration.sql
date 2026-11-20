-- AlterTable
ALTER TABLE "TeamSettings"
  ADD COLUMN IF NOT EXISTS "posthogHost" TEXT,
  ADD COLUMN IF NOT EXISTS "posthogApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "posthogOrganizationName" TEXT,
  ADD COLUMN IF NOT EXISTS "posthogProjectId" TEXT,
  ADD COLUMN IF NOT EXISTS "posthogProjectName" TEXT,
  ADD COLUMN IF NOT EXISTS "posthogConnectedAt" TIMESTAMP(3);
