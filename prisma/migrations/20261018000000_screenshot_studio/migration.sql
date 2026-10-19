-- AlterTable
ALTER TABLE "ScreenshotJob" ADD COLUMN "screenshotStyle" JSONB;
ALTER TABLE "ScreenshotJob" ADD COLUMN "activeRevisionId" TEXT;

-- CreateTable
CREATE TABLE "ScreenshotStylePreset" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bgColor1" TEXT NOT NULL DEFAULT '#667eea',
    "bgColor2" TEXT NOT NULL DEFAULT '#764ba2',
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "font" TEXT NOT NULL DEFAULT 'rounded',
    "textPosition" TEXT NOT NULL DEFAULT 'top',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenshotStylePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenshotRevision" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "name" TEXT,
    "framedByLocale" JSONB NOT NULL,
    "style" JSONB,
    "titles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenshotRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScreenshotStylePreset_appId_name_key" ON "ScreenshotStylePreset"("appId", "name");

-- CreateIndex
CREATE INDEX "ScreenshotStylePreset_appId_idx" ON "ScreenshotStylePreset"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenshotRevision_jobId_rev_key" ON "ScreenshotRevision"("jobId", "rev");

-- CreateIndex
CREATE INDEX "ScreenshotRevision_jobId_idx" ON "ScreenshotRevision"("jobId");

-- AddForeignKey
ALTER TABLE "ScreenshotStylePreset" ADD CONSTRAINT "ScreenshotStylePreset_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenshotRevision" ADD CONSTRAINT "ScreenshotRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScreenshotJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
