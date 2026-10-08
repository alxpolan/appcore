-- The RevenueCat sync moved from the /purchases + /subscriptions snapshot
-- endpoints to /events, which gives real per-transaction amounts instead of
-- a subscription's lifetime-cumulative total. Almost every column changes,
-- and this table is purely a sync cache (repopulated on the next sync), so
-- it's recreated rather than altered column-by-column.
DROP TABLE "RevenueCatTransaction";

CREATE TABLE "RevenueCatTransaction" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "rcId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "isTrialConversion" BOOLEAN NOT NULL DEFAULT false,
    "renewalNumber" INTEGER,
    "transactionId" TEXT,
    "country" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proceedsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCatTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevenueCatTransaction_revenueCatTransactionKey_key" ON "RevenueCatTransaction"("bundleId", "rcId");

CREATE INDEX "RevenueCatTransaction_bundleId_occurredAt_idx" ON "RevenueCatTransaction"("bundleId", "occurredAt");
