-- AlterTable
ALTER TABLE "App" ADD COLUMN "supportedLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
