-- CreateTable
CREATE TABLE "AppStoreCommerceDownload" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "downloadType" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "platformVersion" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "preOrder" TEXT NOT NULL,
    "territory" TEXT NOT NULL,
    "counts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreCommerceDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppStoreCommercePurchase" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "purchaseType" TEXT NOT NULL,
    "contentName" TEXT NOT NULL,
    "contentAppleId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "platformVersion" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "appDownloadDate" TEXT NOT NULL,
    "preOrder" TEXT NOT NULL,
    "territory" TEXT NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "proceedsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payingUsers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreCommercePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppStoreCommerceDownload_bundleId_reportDate_idx" ON "AppStoreCommerceDownload"("bundleId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreCommerceDownload_downloadDimensions_key" ON "AppStoreCommerceDownload"("bundleId", "reportDate", "downloadType", "appVersion", "device", "platformVersion", "sourceType", "pageType", "preOrder", "territory");

-- CreateIndex
CREATE INDEX "AppStoreCommercePurchase_bundleId_reportDate_idx" ON "AppStoreCommercePurchase"("bundleId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreCommercePurchase_purchaseDimensions_key" ON "AppStoreCommercePurchase"("bundleId", "reportDate", "purchaseType", "contentName", "contentAppleId", "paymentMethod", "device", "platformVersion", "sourceType", "pageType", "appDownloadDate", "preOrder", "territory");
