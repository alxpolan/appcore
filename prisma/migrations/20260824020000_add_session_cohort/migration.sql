-- CreateTable
CREATE TABLE "AppStoreSessionCohort" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "downloadDate" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "totalDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueDevices" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreSessionCohort_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreSessionCohort_bundleId_reportDate_downloadDate_key" ON "AppStoreSessionCohort"("bundleId", "reportDate", "downloadDate");

-- CreateIndex
CREATE INDEX "AppStoreSessionCohort_bundleId_reportDate_idx" ON "AppStoreSessionCohort"("bundleId", "reportDate");
