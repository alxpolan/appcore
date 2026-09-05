import fs from "fs";
import path from "path";
import { workerClient } from "./worker-client";

export interface FrameOptions {
  subtitle?: string;
  title?: string;
  bgColor1?: string;
  bgColor2?: string;
  textColor?: string;
  /**
   * Per-screenshot subline keyed by filename basename. Supplying this frames the whole
   * directory in a single worker call instead of one call (and one fastlane boot) per image.
   * Images without an entry fall back to `subtitle`.
   */
  titles?: Record<string, string>;
}

// undici collapses every transport-level failure into "fetch failed" and hides the real
// reason in `cause`, so both have to be inspected to decide whether a retry is worthwhile.
function isRetryableTransportError(err: unknown): boolean {
  const messages: string[] = [];
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    messages.push(e.message, (e as { code?: string }).code ?? "");
  }
  const joined = messages.join(" ").toLowerCase();
  // Deliberately excludes timeouts: the request timeout is already 15 minutes, so a
  // timeout means the worker is genuinely stuck and retrying just burns another 30.
  return ["terminated", "fetch failed", "econnreset", "econnrefused", "epipe", "socket"].some((needle) =>
    joined.includes(needle),
  );
}

export async function frameWithFastlane(
  inputDir: string,
  outputDir: string,
  options: FrameOptions,
  unframedOutputDir?: string,
  log?: (msg: string) => void,
): Promise<string[]> {
  const srcFiles = fs
    .readdirSync(inputDir)
    .filter((f) => /\.(png)$/i.test(f))
    .map((f) => path.join(inputDir, f))
    .filter((f) => fs.statSync(f).isFile());

  if (srcFiles.length === 0) {
    throw new Error("No images found in input directory");
  }

  const { titles, ...workerOptions } = options;

  const images = srcFiles.map((f) => {
    const filename = path.basename(f);
    const title = titles?.[filename.replace(/\.[^.]+$/, "")];
    return {
      filename,
      data: fs.readFileSync(f).toString("base64"),
      ...(title ? { title } : {}),
    };
  });

  let result: Awaited<ReturnType<typeof workerClient.frameit>>;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Asking for an unframed directory is the signal that the second, background-less
      // frameit pass is worth its cost. No directory, no second pass.
      result = await workerClient.frameit({
        images,
        options: { ...workerOptions, includeUnframed: !!unframedOutputDir },
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      if (isRetryableTransportError(err)) {
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  if (lastErr !== undefined) throw lastErr;
  result = result!;

  if (!result.ok) {
    throw new Error(`Worker frameit failed: ${result.error ?? "unknown error"}`);
  }

  log?.(`[framing] Title font: ${result.fontUsed ?? "not reported (worker is running old code - update it)"}`);

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPaths: string[] = [];

  for (const img of result.framedImages) {
    const dest = path.join(outputDir, img.filename);
    fs.writeFileSync(dest, Buffer.from(img.data, "base64"));
    outputPaths.push(dest);
  }

  if (unframedOutputDir && result.unframedImages && result.unframedImages.length > 0) {
    fs.mkdirSync(unframedOutputDir, { recursive: true });
    for (const img of result.unframedImages) {
      fs.writeFileSync(path.join(unframedOutputDir, img.filename), Buffer.from(img.data, "base64"));
    }
  }

  return outputPaths;
}
