-- CreateTable
CREATE TABLE "ScreenshotStudioDraft" (
    "jobId" TEXT NOT NULL,
    "style" JSONB,
    "styles" JSONB,
    "titles" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenshotStudioDraft_pkey" PRIMARY KEY ("jobId")
);

-- AddForeignKey
ALTER TABLE "ScreenshotStudioDraft" ADD CONSTRAINT "ScreenshotStudioDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScreenshotJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
