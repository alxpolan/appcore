-- AlterTable
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "textAlign" TEXT NOT NULL DEFAULT 'center';
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "maxLines" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "ScreenshotStylePreset" ADD COLUMN "shadow" BOOLEAN NOT NULL DEFAULT true;
