// One-off: resume a screenshot job whose finishScreenshotCapture() got killed mid-framing
// by a server crash (unrelated IMAP bug). Raw screenshots + descriptions + sublines are
// already persisted; this only redoes the framing + final status flip, skipping the
// (already-done, AI-costing) subline generation step.
import path from "path";
import { prisma } from "./src/config";
import { frameScreenshots, resolveLatestVersionLocales } from "./src/services/generate-screenshots-framing";
import type { ScreenshotSublines } from "./src/services/screenshot-subline-generator";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: tsx retrigger-finish.ts <jobId>");
  process.exit(1);
}

async function main() {
  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, include: { app: true } });
  if (!job) throw new Error(`job ${jobId} not found`);

  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    console.log(msg);
  };

  const outputDir = path.join(process.cwd(), "screenshots", jobId);
  const effectiveDescriptions = (job.screenshotDescriptions as Record<string, string>) ?? {};
  const sublines = (job.screenshotSublines as ScreenshotSublines) ?? {};
  const hasDescriptions = Object.keys(effectiveDescriptions).length > 0;
  const frameConfig = { bgColor1: "#0E0E10", bgColor2: "#1A1A1D", textColor: "#F2F0EB" };

  const targetVersionLocales = await resolveLatestVersionLocales(job, log);
  const targetLocales = targetVersionLocales.length > 0 ? targetVersionLocales.map((l) => l.locale) : ["en-US"];
  const versionLocaleMap = Object.fromEntries(targetVersionLocales.map((l) => [l.locale, l]));

  log(`[retrigger] job=${jobId} descriptions=${Object.keys(effectiveDescriptions).length} sublineLocales=${Object.keys(sublines).length} targetLocales=${targetLocales.length}`);

  await frameScreenshots(
    jobId,
    job,
    outputDir,
    effectiveDescriptions,
    hasDescriptions,
    sublines,
    frameConfig,
    targetLocales,
    versionLocaleMap,
    log,
  );

  await prisma.screenshotJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date(), logs: JSON.stringify(logs) },
  });

  console.log(`[retrigger] done: ${jobId}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[retrigger] FAILED", e);
  await prisma.$disconnect();
  process.exit(1);
});
