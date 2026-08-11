-- CreateTable
CREATE TABLE "AppStoreAnalyticsPlatform" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "platformVersion" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "taps" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreAnalyticsPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppStoreAnalyticsPlatform_bundleId_reportDate_idx" ON "AppStoreAnalyticsPlatform"("bundleId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreAnalyticsPlatform_bundleId_reportDate_platformVer_key" ON "AppStoreAnalyticsPlatform"("bundleId", "reportDate", "platformVersion");
