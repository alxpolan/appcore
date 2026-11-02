CREATE TABLE "ScreenshotStudioRender" (
    "jobId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "progress" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ScreenshotStudioRender_pkey" PRIMARY KEY ("jobId")
);
CREATE UNIQUE INDEX "ScreenshotStudioRender_operationId_key" ON "ScreenshotStudioRender"("operationId");
ALTER TABLE "ScreenshotStudioRender" ADD CONSTRAINT "ScreenshotStudioRender_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ScreenshotJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
