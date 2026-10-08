-- CreateTable
CREATE TABLE "RevenueCatCustomer" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" TEXT,
    "platformVersion" TEXT,
    "appVersion" TEXT,
    "country" TEXT,
    "attributes" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCatCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueCatCustomer_revenueCatCustomerKey_key" ON "RevenueCatCustomer"("bundleId", "customerId");
