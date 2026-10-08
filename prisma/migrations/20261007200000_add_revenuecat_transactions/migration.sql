-- CreateTable
CREATE TABLE "RevenueCatTransaction" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "rcId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "country" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "periodEndsAt" TIMESTAMP(3),
    "autoRenewalStatus" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proceedsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCatTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueCatTransaction_revenueCatTransactionKey_key" ON "RevenueCatTransaction"("bundleId", "kind", "rcId");

-- CreateIndex
CREATE INDEX "RevenueCatTransaction_bundleId_occurredAt_idx" ON "RevenueCatTransaction"("bundleId", "occurredAt");
