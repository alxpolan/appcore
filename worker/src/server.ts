import "dotenv/config";
import express from "express";
import sharp from "sharp";
import { workerAuth } from "./auth";
import { workerRouter } from "./routes/index";
import { findFastlane } from "./fastlane-utils";

sharp.concurrency(2);

const app = express();
const PORT = Number(process.env.FASTLANE_WORKER_PORT ?? 3200);

app.use(express.json({ limit: "200mb" }));

app.get("/health", async (_req, res) => {
  try {
    const fp = await findFastlane();

    res.json({ ok: true, fastlane: fp });
  } catch {
    res.json({ ok: false, error: "Fastlane not found" });
  }
});

app.use("/worker", workerAuth, workerRouter);

const server = app.listen(PORT, "0.0.0.0", () => {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  console.log(`🔧 Fastlane Worker running on port ${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health           - Health check (no auth)`);
  console.log(`     GET  /worker/health    - Detailed health (auth required)`);
  console.log(`     POST /worker/snapshot  - Run fastlane snapshot`);
  console.log(`     POST /worker/build     - Build IPA with gym`);
  console.log(`     POST /worker/frameit   - Run fastlane frameit`);

  if (!process.env.FASTLANE_WORKER_SECRET) {
    console.error("⚠️  WARNING: FASTLANE_WORKER_SECRET not set! All authenticated requests will be rejected.");
  }
});
