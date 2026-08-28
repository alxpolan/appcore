-- CreateTable
CREATE TABLE "AppStoreInstallDeletion" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "event" TEXT NOT NULL,
    "territory" TEXT NOT NULL,
    "counts" INTEGER NOT NULL DEFAULT 0,
    "uniqueDevices" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppStoreInstallDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreInstallDeletion_bundleId_reportDate_event_territory_key" ON "AppStoreInstallDeletion"("bundleId", "reportDate", "event", "territory");

-- CreateIndex
CREATE INDEX "AppStoreInstallDeletion_bundleId_reportDate_idx" ON "AppStoreInstallDeletion"("bundleId", "reportDate");
