-- CreateTable
CREATE TABLE "SigningCertificate" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "certP12" TEXT NOT NULL,
    "certPassword" TEXT NOT NULL,
    "appleTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigningCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SigningCertificate_teamId_idx" ON "SigningCertificate"("teamId");

-- AlterTable
ALTER TABLE "App" ADD COLUMN "signingCertificateId" TEXT;

-- AddForeignKey
ALTER TABLE "SigningCertificate" ADD CONSTRAINT "SigningCertificate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_signingCertificateId_fkey" FOREIGN KEY ("signingCertificateId") REFERENCES "SigningCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
