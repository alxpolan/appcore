import { installStudioRenderStore } from "./studio-render-store";
import { it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/config";
import { workerClient } from "../src/services/worker-client";
import { getStudioData, renderStudioRevision } from "../src/services/screenshot-studio/render";
import { frameScreenshots } from "../src/services/generate-screenshots-framing";
import { DEFAULT_STUDIO_STYLE } from "../src/services/screenshot-studio/style";
import { setAppDefaultFromRevision } from "../src/services/screenshot-studio/revisions";

it("round-trips locale geometry through rendering, revisions, reload and pinned defaults", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-locale-test-"));
  const basename = "01_Projects__iphone_6.9.png";
  const unchanged = "02_Tasks__iphone_6.9.png";
  const image = Buffer.from("fake image").toString("base64");
  const app: any = { id: "app-test", name: "Test", currentSubtitle: "Test", defaultScreenshotTitles: {} };
  const job: any = {
    id: "job-test", appId: app.id, app, commitSha: "abc", createdAt: new Date(),
    screenshotStyle: DEFAULT_STUDIO_STYLE, screenshotShotStyles: { [basename]: { offsetX: 5 } },
    framedByLocale: Object.fromEntries(["en-US", "de-DE"].map((locale) => [locale, [basename, unchanged].map((base) => `/screenshots/job-test/framed/${locale}/${base}`)])),
    activeRevisionId: null,
  };
  const revisions: any[] = [];
  const renderedOffsets: number[] = [];

  const restores: Array<() => void> = [];
  const stub = (target: any, key: string, implementation: any) => {
    const original = target[key];
    target[key] = implementation;
    restores.push(() => { target[key] = original; });
  };

  try {
    installStudioRenderStore(stub);
    mock.method(process, "cwd", () => temp);
    for (const locale of ["en-US", "de-DE"]) {
      const rawDir = path.join(temp, "screenshots", job.id, "raw", locale);
      fs.mkdirSync(rawDir, { recursive: true });
      for (const base of [basename, unchanged]) fs.writeFileSync(path.join(rawDir, base), "fake image");
    }
    stub(prisma.screenshotJob, "findUnique", async () => job);
    stub(prisma.screenshotJob, "update", async ({ data }: any) => Object.assign(job, data));
    stub(prisma.screenshotRevision, "findFirst", async (args: any) =>
      args.where.id ? revisions.find((r) => r.id === args.where.id) :
        [...revisions].sort((a, b) => args.orderBy.rev === "desc" ? b.rev - a.rev : a.rev - b.rev)[0] ?? null);
    stub(prisma.screenshotRevision, "findMany", async () => revisions);
    stub(prisma.screenshotRevision, "findUnique", async ({ where }: any) => ({ ...revisions.find((r) => r.id === where.id), job: { appId: app.id } }));
    stub(prisma.screenshotRevision, "create", async ({ data }: any) => {
      const revision = { ...data, id: `revision-${revisions.length}`, createdAt: new Date() };
      revisions.push(revision);
      return revision;
    });
    stub(prisma.screenshotStylePreset, "findMany", async () => []);
    stub(prisma.screenshotStudioDraft, "findUnique", async () => null);
    stub(prisma.app, "update", async ({ data }: any) => Object.assign(app, data));
    mock.method(workerClient, "frameitSlotCount", () => 1);
    mock.method(workerClient, "frameit", async ({ images }: any) => {
      renderedOffsets.push(...images.map((i: any) => i.offsetX));
      return { ok: true, framedImages: images.map((i: any) => ({ filename: i.filename, data: image })) };
    });

    // Existing flat job snapshots must appear in both languages.
    let loaded = await getStudioData(job.id);
    for (const locale of loaded.locales) assert.equal(locale.styles[basename].offsetX, 5);

    await renderStudioRevision({
      jobId: job.id, style: DEFAULT_STUDIO_STYLE,
      locales: {
        "en-US": { titles: {}, styles: { [basename]: { offsetX: 10, titleLineHeight: 1.6 } } },
        "de-DE": { titles: {}, styles: { [basename]: { offsetX: -20 } } },
      },
    });
    assert.deepEqual(renderedOffsets, [10, -20]);
    assert.equal(revisions[0].styles["en-US"][basename].offsetX, 5);
    assert.equal(revisions[0].styles["de-DE"][basename].offsetX, 5);
    loaded = await getStudioData(job.id);
    assert.equal(loaded.locales.find((l) => l.locale === "en-US")!.styles[basename].offsetX, 10);
    assert.equal(loaded.locales.find((l) => l.locale === "en-US")!.styles[basename].titleLineHeight, 1.6);
    assert.equal(loaded.locales.find((l) => l.locale === "de-DE")!.styles[basename].offsetX, -20);

    for (const locale of loaded.locales) {
      assert.equal(locale.items.find((item) => item.basename === unchanged)!.url, `/screenshots/job-test/framed/${locale.locale}/${unchanged}`);
    }

    // Saving one language retains the other's geometry and rendered URLs.
    const germanUrl = loaded.locales.find((l) => l.locale === "de-DE")!.items[0].url;
    await renderStudioRevision({
      jobId: job.id, style: DEFAULT_STUDIO_STYLE,
      locales: {
        "en-US": { titles: {}, styles: { [basename]: { offsetX: 30 } } },
        "de-DE": { titles: {}, styles: { [basename]: { offsetX: -20 } } },
      },
    });
    loaded = await getStudioData(job.id);
    assert.equal(loaded.locales.find((l) => l.locale === "en-US")!.styles[basename].offsetX, 30);
    assert.equal(loaded.locales.find((l) => l.locale === "de-DE")!.styles[basename].offsetX, -20);
    assert.equal(loaded.locales.find((l) => l.locale === "de-DE")!.items[0].url, germanUrl);

    assert.deepEqual(renderedOffsets, [10, -20, 30]);

    // Caption-only edits render only that screenshot, including when Save sends all languages.
    const localesToSave = {
      "en-US": { titles: { [unchanged]: "New caption" }, styles: { [basename]: { offsetX: 30 } } },
      "de-DE": { titles: {}, styles: { [basename]: { offsetX: -20 } } },
    };
    renderedOffsets.length = 0;
    await renderStudioRevision({ jobId: job.id, style: DEFAULT_STUDIO_STYLE, locales: localesToSave });
    assert.deepEqual(renderedOffsets, [0]);
    loaded = await getStudioData(job.id);
    assert.equal(loaded.locales.find((l) => l.locale === "de-DE")!.items[0].url, germanUrl);

    // Shared design changes affect all four screenshots.
    renderedOffsets.length = 0;
    await renderStudioRevision({
      jobId: job.id, style: { ...DEFAULT_STUDIO_STYLE, bgColor1: "#112233" }, locales: localesToSave,
    });
    assert.equal(renderedOffsets.length, 4);

    await setAppDefaultFromRevision(app.id, job.activeRevisionId);
    assert.equal(app.defaultScreenshotShotStyles["en-US"][basename].offsetX, 30);
    assert.equal(app.defaultScreenshotShotStyles["de-DE"][basename].offsetX, -20);

    // Future captures use each language's pinned geometry and snapshot it by locale.
    renderedOffsets.length = 0;
    await frameScreenshots(job.id, job, path.join(temp, "screenshots", job.id), {}, false, {}, {}, ["en-US", "de-DE"], {}, () => {});
    assert.deepEqual(renderedOffsets.sort((a, b) => a - b), [-20, 0, 0, 30]);
    assert.equal(job.screenshotShotStyles["en-US"][basename].offsetX, 30);
    assert.equal(job.screenshotShotStyles["de-DE"][basename].offsetX, -20);

    // A legacy flat revision still loads across every language.
    revisions[0].styles = { [basename]: { titleBoxW: 240 } };
    job.activeRevisionId = revisions[0].id;
    loaded = await getStudioData(job.id);
    for (const locale of loaded.locales) assert.equal(locale.styles[basename].titleBoxW, 240);
  } finally {
    for (const restore of restores.reverse()) restore();
    mock.restoreAll();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
