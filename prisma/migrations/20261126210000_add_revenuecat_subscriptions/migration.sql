-- CreateTable
CREATE TABLE "RevenueCatSubscription" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "autoRenewalStatus" TEXT,
    "givesAccess" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCatSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueCatSubscription_revenueCatSubscriptionKey_key" ON "RevenueCatSubscription"("bundleId", "subscriptionId");

-- CreateIndex
CREATE INDEX "RevenueCatSubscription_bundleId_customerId_idx" ON "RevenueCatSubscription"("bundleId", "customerId");
