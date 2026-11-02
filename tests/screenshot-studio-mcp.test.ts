import { installStudioRenderStore } from "./studio-render-store";
import { it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../src/config";
import { workerClient } from "../src/services/worker-client";
import { registerScreenshotStudioTools } from "../src/web/mcp/tools/screenshot-studio-tools";
import { getStudioData } from "../src/services/screenshot-studio/render";
import { getStudioWorkspace, saveStudioWorkspaceDraft } from "../src/services/screenshot-studio/workspace";
import { DEFAULT_STUDIO_STYLE } from "../src/services/screenshot-studio/style";

it("MCP screenshot tools preserve locale state and expose management actions", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-"));
  const a = "01_Projects__iphone_6.9.png";
  const b = "02_Tasks__iphone_6.9.png";
  const tablet = "01_Projects__ipad_13.png";
  const app: any = { id: "app-test", teamId: "team-test", name: "Test", defaultScreenshotTitles: {} };
  const overlay = { id: "placement", url: "/screenshots/job-test/overlays/asset.png", x: 50, y: 60, scale: 1, rotation: 0 };
  const job: any = {
    id: "job-test", appId: app.id, app, commitSha: "abc", createdAt: new Date(),
    screenshotStyle: DEFAULT_STUDIO_STYLE,
    screenshotShotStyles: {
      "en-US": { [a]: { offsetX: 10, titleLineHeight: 1.6, overlays: [overlay] }, [tablet]: { offsetX: -45 } },
      "de-DE": { [a]: { offsetX: -20, overlays: [{ ...overlay, x: 90 }] }, [b]: { deviceFrame: "blue.png" } },
    },
    screenshotUrls: [],
    framedByLocale: Object.fromEntries(["en-US", "de-DE"].map((locale) => [locale, [a, b, tablet].map((base) => `/screenshots/job-test/framed/${locale}/${base}`)])),
    activeRevisionId: null,
  };
  const revisions: any[] = [];
  const rendered: any[] = [];
  let draft: any = null;
  let allowed = true;
  let failWorker = false;
  let editDuringRender = false;
  const restores: Array<() => void> = [];
  const stub = (target: any, key: string, implementation: any) => {
    const original = target[key]; target[key] = implementation;
    restores.push(() => { target[key] = original; });
  };
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = { registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }) } as unknown as McpServer;
  const call = async (name: string, args: any) => {
    const tool = tools.get(name)!;
    assert.ok(tool, `Tool ${name} is registered`);
    return tool.handler(z.object(tool.config.inputSchema).parse({ jobId: job.id, ...args }));
  };
  const state = async () => Object.fromEntries((await getStudioWorkspace(job.id)).locales.map((l) => [l.locale, l]));
  try {
    installStudioRenderStore(stub);
    mock.method(process, "cwd", () => temp);
    for (const locale of ["en-US", "de-DE"]) {
      const raw = path.join(temp, "screenshots", job.id, "raw", locale);
      fs.mkdirSync(raw, { recursive: true });
      for (const base of [a, b, tablet]) fs.writeFileSync(path.join(raw, base), "fake image");
    }
    fs.mkdirSync(path.join(temp, "screenshots", job.id, "overlays"));
    fs.writeFileSync(path.join(temp, "screenshots", job.id, "overlays", "asset.png"), "fake overlay");
    stub(prisma.screenshotJob, "findUnique", async () => job);
    stub(prisma.screenshotJob, "update", async ({ data }: any) => Object.assign(job, data));
    stub(prisma.screenshotRevision, "findFirst", async (args: any) => args.where.id
      ? revisions.find((r) => r.id === args.where.id)
      : [...revisions].sort((a, b) => args.orderBy.rev === "desc" ? b.rev - a.rev : a.rev - b.rev)[0] ?? null);
    stub(prisma.screenshotRevision, "findMany", async () => revisions);
    stub(prisma.screenshotRevision, "create", async ({ data }: any) => {
      const revision = { ...data, id: `revision-${revisions.length}`, createdAt: new Date() };
      revisions.push(revision); return revision;
    });
    stub(prisma.screenshotRevision, "update", async ({ where, data }: any) => Object.assign(revisions.find((r) => r.id === where.id), data));
    stub(prisma.screenshotStylePreset, "findMany", async () => []);
    stub(prisma.screenshotStudioDraft, "findUnique", async () => draft);
    stub(prisma.screenshotStudioDraft, "create", async ({ data }: any) => {
      if (draft) throw Object.assign(new Error("Already exists"), { code: "P2002" });
      draft = { ...data, updatedAt: new Date() }; return draft;
    });
    stub(prisma.screenshotStudioDraft, "updateMany", async ({ where, data }: any) => {
      if (!draft || (where.updatedAt && draft.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
      Object.assign(draft, data); return { count: 1 };
    });
    stub(prisma.screenshotStudioDraft, "deleteMany", async ({ where }: any) => {
      if (!draft || (where.updatedAt && draft.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
      draft = null; return { count: 1 };
    });
    stub(prisma.app, "findUnique", async () => ({ ...app, teamId: allowed ? "team-test" : "other-team" }));
    stub(prisma.teamMember, "findFirst", async () => ({ teamId: "team-test" }));
    stub(prisma.teamMember, "findUnique", async () => ({ role: "ADMIN", appAccess: [] }));
    stub(prisma.user, "findUnique", async () => ({ email: "test@example.com" }));
    stub(prisma.activityLog, "create", async () => ({}));
    mock.method(workerClient, "frameitSlotCount", () => 1);
    mock.method(workerClient, "frameit", async ({ images }: any) => {
      rendered.push(...images);
      if (failWorker) return { ok: false, error: "Test render failed", framedImages: [] };
      if (editDuringRender) {
        editDuringRender = false;
        draft = { ...draft, titles: { ...draft.titles, "en-US": { ...draft.titles["en-US"], [a]: "Concurrent edit" } }, updatedAt: new Date(draft.updatedAt.getTime() + 1) };
      }
      return { ok: true, framedImages: images.map((image: any) => ({ filename: image.filename, data: Buffer.from("framed").toString("base64") })) };
    });
    registerScreenshotStudioTools(server, "user-test");

    await t.test("new tools are registered, validate scopes, and enforce app access", async () => {
      for (const name of ["delete_screenshot_locales", "reorder_screenshots", "apply_screenshot_layout", "get_screenshot_render_status"]) assert.ok(tools.has(name));
      await assert.rejects(call("apply_screenshot_layout", { locale: "en-US", basename: a, scope: "everything" }));
      await assert.rejects(call("delete_screenshot_locales", { locales: ["../en-US"] }));
      allowed = false;
      for (const [name, args] of [
        ["delete_screenshot_locales", { locales: ["de-DE"] }],
        ["reorder_screenshots", { locale: "en-US", basenames: [b, a, tablet] }],
        ["apply_screenshot_layout", { locale: "en-US", basename: a, scope: "device-all" }],
      ] as const) assert.match((await call(name, args)).content[0].text, /not found/);
      assert.equal(revisions.length, 0); assert.equal(rendered.length, 0);
      allowed = true;
    });

    await t.test("overview returns each language's effective layout and order", async () => {
      const overview = JSON.parse((await call("get_screenshot_studio_overview", { basename: a })).content[0].text);
      assert.equal(overview.locales.find((l: any) => l.locale === "en-US").items[0].layout.offsetX, 10);
      assert.equal(overview.locales.find((l: any) => l.locale === "de-DE").items[0].layout.offsetX, -20);
      assert.equal(overview.locales[0].items[0].order, 1);
    });

    await t.test("caption and layout edits preserve unrelated per-language geometry", async () => {
      await call("update_screenshot_caption", { locale: "en-US", basename: a, caption: "New caption" });
      assert.equal(rendered.length, 0);
      assert.equal(revisions.length, 0);
      assert.equal(job.activeRevisionId, null);
      let loaded = await state();
      assert.equal(loaded["en-US"].styles[a].offsetX, 10);
      assert.deepEqual(loaded["en-US"].styles[a].overlays, [overlay]);
      assert.equal(loaded["de-DE"].styles[a].offsetX, -20);
      await call("update_screenshot_layout", { basename: a, locales: ["en-US"], titleLineHeight: 1.9 });
      assert.equal(rendered.length, 0);
      assert.equal(revisions.length, 0);
      loaded = await state();
      assert.equal(loaded["en-US"].styles[a].titleLineHeight, 1.9);
      assert.equal(loaded["de-DE"].styles[a].offsetX, -20);
      await assert.rejects(call("update_screenshot_layout", { basename: a, locales: ["xx"], offsetX: 30 }), /Requested locales/);
    });

    await t.test("all Apply scopes copy geometry and preserve targets' other settings", async () => {
      await call("apply_screenshot_layout", { locale: "en-US", basename: a, scope: "device-locale" });
      let loaded = await state();
      assert.equal(loaded["en-US"].styles[b].offsetX, 10);
      assert.equal(loaded["en-US"].styles[b].titleLineHeight, 1.9);
      assert.equal(loaded["en-US"].styles[tablet].offsetX, -45);
      assert.equal(loaded["de-DE"].styles[a].offsetX, -20);
      await call("apply_screenshot_layout", { locale: "en-US", basename: a, scope: "screen-all" });
      loaded = await state();
      assert.equal(loaded["de-DE"].styles[a].offsetX, 10);
      assert.equal(loaded["de-DE"].styles[a].overlays![0].x, 90);
      assert.equal(loaded["de-DE"].styles[b].offsetX, undefined);
      await call("apply_screenshot_layout", { locale: "en-US", basename: a, scope: "device-all" });
      loaded = await state();
      assert.equal(loaded["de-DE"].styles[b].offsetX, 10);
      assert.equal(loaded["de-DE"].styles[b].deviceFrame, "blue.png");
      const count = revisions.length;
      const unchanged = await call("apply_screenshot_layout", { locale: "en-US", basename: a, scope: "device-all" });
      assert.match(unchanged.content[0].text, /no images were rendered/);
      assert.equal(revisions.length, count);
      assert.equal(loaded["en-US"].items.find((i) => i.basename === a)!.title, "New caption");
    });

    await t.test("overlay edits are locale-specific and deletion retains a shared asset", async () => {
      await call("update_screenshot_overlay", { basename: a, locales: ["en-US"], overlayId: "placement", x: 120 });
      let loaded = await state();
      assert.equal(loaded["en-US"].styles[a].overlays![0].x, 120);
      assert.equal(loaded["de-DE"].styles[a].overlays![0].x, 90);
      await call("delete_screenshot_overlay", { basename: a, locales: ["en-US"], overlayId: "placement" });
      loaded = await state();
      assert.equal(loaded["en-US"].styles[a].overlays, undefined);
      assert.equal(loaded["de-DE"].styles[a].overlays![0].x, 90);
      assert.ok(fs.existsSync(path.join(temp, "screenshots", job.id, "overlays", "asset.png")));
    });

    await t.test("ordering supports one or all languages and rejects duplicate basenames", async () => {
      rendered.length = 0;
      await call("reorder_screenshots", { locale: "en-US", basenames: [b, a, tablet] });
      let loaded = await state();
      assert.deepEqual(loaded["en-US"].items.map((i) => i.basename), [b, a, tablet]);
      assert.deepEqual(loaded["de-DE"].items.map((i) => i.basename), [a, b, tablet]);
      await call("reorder_screenshots", { locale: "en-US", basenames: [tablet, b, a], allLocales: true });
      loaded = await state();
      assert.deepEqual(loaded["de-DE"].items.map((i) => i.basename), [tablet, b, a]);
      await assert.rejects(call("reorder_screenshots", { locale: "en-US", basenames: [a, a, tablet] }), /exactly once/);
      assert.equal(rendered.length, 0);
      assert.equal(revisions.length, 0);
    });

    await t.test("draft overview and preview include edits without creating revisions", async () => {
      const overview = JSON.parse((await call("get_screenshot_studio_overview", { locale: "en-US", basename: a })).content[0].text);
      assert.equal(overview.state, "draft");
      const original = JSON.parse((await call("get_screenshot_studio_overview", { locale: "en-US", basename: a, state: "saved" })).content[0].text);
      assert.equal(original.state, "saved");
      assert.equal(original.locales[0].items[0].caption, "Test");
      assert.equal(overview.locales[0].items[0].caption, "New caption");
      assert.equal(overview.locales[0].items[0].layout.titleLineHeight, 1.9);
      const saved = await getStudioData(job.id);
      assert.equal(saved.locales.find((l) => l.locale === "en-US")!.items.find((i) => i.basename === a)!.title, "Test");
      const preview = await call("view_app_screenshot", { locale: "en-US", basename: a });
      assert.equal(preview.content[0].type, "image");
      assert.equal(rendered.at(-1).title, "New caption");
      assert.equal(rendered.at(-1).titleLineHeight, 1.9);
      assert.equal(revisions.length, 0);
      assert.equal(job.activeRevisionId, null);
    });

    await t.test("only an explicit save creates a revision and clears the consumed draft", async () => {
      rendered.length = 0;
      const result = JSON.parse((await call("save_screenshot_revision", { name: "AI approved" })).content[0].text);
      assert.equal(result.revision.name, "AI approved");
      assert.equal(job.activeRevisionId, result.revision.id);
      const renderStatus = JSON.parse((await call("get_screenshot_render_status", {})).content[0].text).render;
      assert.equal(renderStatus.status, "SUCCEEDED");
      assert.equal(renderStatus.result.revision.id, result.revision.id);
      assert.equal(draft, null);
      const saved = await getStudioData(job.id);
      assert.deepEqual(saved.locales[0].items.map((i) => i.basename), [tablet, b, a]);
      assert.equal(saved.locales.find((l) => l.locale === "en-US")!.styles[a].titleLineHeight, 1.9);
    });

    await t.test("order-only drafts save without rendering and failed saves preserve edits", async () => {
      const before = revisions.length;
      rendered.length = 0;
      await call("reorder_screenshots", { locale: "en-US", basenames: [a, b, tablet] });
      assert.equal(revisions.length, before);
      await call("save_screenshot_revision", { name: "Reordered" });
      assert.equal(revisions.length, before + 1);
      assert.equal(rendered.length, 0);
      await call("update_screenshot_caption", { locale: "en-US", basename: a, caption: "Pending" });
      failWorker = true;
      await assert.rejects(call("save_screenshot_revision", {}), /Test render failed/);
      failWorker = false;
      assert.equal(revisions.length, before + 1);
      assert.equal(draft.titles["en-US"][a], "Pending");
      await call("discard_screenshot_draft", {});
      assert.equal(draft, null);
      assert.equal((await state())["en-US"].items.find((i) => i.basename === a)!.title, "New caption");
    });

    await t.test("stale draft edits cannot overwrite a newer human or AI edit", async () => {
      const empty = await getStudioWorkspace(job.id);
      await call("update_screenshot_caption", { locale: "en-US", basename: a, caption: "First" });
      await assert.rejects(saveStudioWorkspaceDraft(empty, "user-test"), /Draft changed/);
      const stale = await getStudioWorkspace(job.id);
      await call("update_screenshot_caption", { locale: "en-US", basename: a, caption: "Newer" });
      await assert.rejects(saveStudioWorkspaceDraft(stale, "user-test"), /Draft changed/);
      assert.equal(draft.titles["en-US"][a], "Newer");
    });

    await t.test("saving a snapshot retains draft edits made while images render", async () => {
      editDuringRender = true;
      const result = JSON.parse((await call("save_screenshot_revision", { name: "Snapshot before concurrent edit" })).content[0].text);
      assert.equal(result.draftRemaining, true);
      assert.equal(draft.titles["en-US"][a], "Concurrent edit");
      const saved = await getStudioData(job.id);
      assert.equal(saved.locales.find((l) => l.locale === "en-US")!.items.find((i) => i.basename === a)!.title, "Newer");
      assert.equal((await state())["en-US"].items.find((i) => i.basename === a)!.title, "Concurrent edit");
    });

    await t.test("locale deletion removes files and metadata from revisions and drafts", async () => {
      draft = { style: DEFAULT_STUDIO_STYLE, styles: { "en-US": { [a]: { offsetX: 1 } }, "de-DE": { [a]: { offsetX: 2 } } }, titles: { "en-US": {}, "de-DE": { [a]: "Entwurf" } }, updatedAt: new Date(), updatedBy: null };
      await assert.rejects(call("delete_screenshot_locales", { locales: ["en-US", "de-DE"] }), /at least one/);
      await assert.rejects(call("delete_screenshot_locales", { locales: ["xx"] }), /not found/);
      const result = JSON.parse((await call("delete_screenshot_locales", { locales: ["de-DE"] })).content[0].text);
      assert.deepEqual(result.remainingLocales, ["en-US"]);
      for (const revision of revisions) {
        assert.equal(revision.framedByLocale["de-DE"], undefined);
        assert.equal(revision.styles["de-DE"], undefined);
        assert.equal(revision.titles?.["de-DE"], undefined);
      }
      assert.equal(draft.styles["de-DE"], undefined);
      assert.equal(draft.titles["de-DE"], undefined);
      assert.ok(!fs.existsSync(path.join(temp, "screenshots", job.id, "raw", "de-DE")));
      assert.ok(fs.existsSync(path.join(temp, "screenshots", job.id, "raw", "en-US")));
      await assert.rejects(call("delete_screenshot_locales", { locales: ["en-US"] }), /at least one/);
    });
  } finally {
    for (const restore of restores.reverse()) restore();
    mock.restoreAll();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
