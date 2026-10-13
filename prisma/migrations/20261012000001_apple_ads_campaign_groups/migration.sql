-- CreateTable
CREATE TABLE "AppleAdsCampaignGroup" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleAdsCampaignGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppleAdsCampaignGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,

    CONSTRAINT "AppleAdsCampaignGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppleAdsCampaignGroup_appId_idx" ON "AppleAdsCampaignGroup"("appId");

-- CreateIndex
CREATE INDEX "AppleAdsCampaignGroupMember_groupId_idx" ON "AppleAdsCampaignGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "AppleAdsCampaignGroupMember_appId_externalCampaignId_key" ON "AppleAdsCampaignGroupMember"("appId", "externalCampaignId");

-- AddForeignKey
ALTER TABLE "AppleAdsCampaignGroup" ADD CONSTRAINT "AppleAdsCampaignGroup_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleAdsCampaignGroupMember" ADD CONSTRAINT "AppleAdsCampaignGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AppleAdsCampaignGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
