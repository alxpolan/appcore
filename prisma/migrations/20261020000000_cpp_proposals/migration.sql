-- CreateTable
CREATE TABLE "CppProposal" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT,
    "groupKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "keywords" JSONB NOT NULL,
    "totals" JSONB,
    "captions" JSONB,
    "locales" TEXT[] NOT NULL,
    "sourceJobId" TEXT,
    "screenshotJobId" TEXT,
    "cppPageId" TEXT,
    "cppVersionId" TEXT,
    "cppUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CppProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CppProposal_appId_campaignId_groupKey_key" ON "CppProposal"("appId", "campaignId", "groupKey");

-- CreateIndex
CREATE INDEX "CppProposal_appId_idx" ON "CppProposal"("appId");

-- AddForeignKey
ALTER TABLE "CppProposal" ADD CONSTRAINT "CppProposal_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
