const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");
const outDir = path.join(root, "dist");

async function main() {
  const entryPoints = fs.globSync("**/*.ts", { cwd: srcDir }).map((f) => path.join(srcDir, f));

  fs.rmSync(outDir, { recursive: true, force: true });

  await esbuild.build({
    entryPoints,
    outdir: outDir,
    outbase: srcDir,
    bundle: false,
    platform: "node",
    format: "cjs",
    target: "es2022",
    sourcemap: true,
    logLevel: "info",
  });

  const assetSrc = path.join(srcDir, "services/notifications/assets/logo-wordmark.png");
  const assetDest = path.join(outDir, "services/notifications/assets/logo-wordmark.png");

  fs.mkdirSync(path.dirname(assetDest), { recursive: true });
  fs.copyFileSync(assetSrc, assetDest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
