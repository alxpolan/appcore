-- AlterTable
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "titleBoxW" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "titleBoxH" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "titleLines" TEXT NOT NULL DEFAULT '[]';
