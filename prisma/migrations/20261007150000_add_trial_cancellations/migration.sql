-- CreateTable
CREATE TABLE "AppStoreTrialCancellation" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "originalStartDate" TIMESTAMP(3) NOT NULL,
    "trialEndDate" TIMESTAMP(3) NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreTrialCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppStoreTrialCancellation_bundleId_subscriptionId_country_idx" ON "AppStoreTrialCancellation"("bundleId", "subscriptionId", "country", "trialEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreTrialCancellation_trialCancelDimensions_key" ON "AppStoreTrialCancellation"("bundleId", "subscriptionId", "country", "originalStartDate", "eventDate");
