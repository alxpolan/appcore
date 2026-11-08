-- CreateTable
CREATE TABLE "AppReviewAnswers" (
    "bundleId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppReviewAnswers_pkey" PRIMARY KEY ("bundleId")
);
