import { it } from "node:test";
import assert from "node:assert/strict";
import { getStudioRenderStatus, trackStudioRender } from "../src/services/screenshot-studio/progress";
import { installStudioRenderStore } from "./studio-render-store";
import type { StudioProgressEvent, StudioSaveResult } from "../src/services/screenshot-studio/render";

it("render progress survives a detached client and records completion, failure and retry", async () => {
  const restores: Array<() => void> = [];
  const stub = (target: any, key: string, implementation: any) => {
    const original = target[key]; target[key] = implementation;
    restores.push(() => { target[key] = original; });
  };
  const rows = installStudioRenderStore(stub);
  const result: StudioSaveResult = { jobId: "test", revision: { id: "revision", rev: 1, name: "Saved", createdAt: new Date(), isActive: true }, modes: { worker: 3 }, skipped: [] };
  let release!: () => void;
  let ready!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let emit!: (event: StudioProgressEvent) => void;
  let connected = true;
  const received: number[] = [];
  try {
    const rendering = trackStudioRender("test", async (report) => {
      emit = report;
      report({ done: 1, total: 3, locale: "en-US", basenames: ["a.png"] });
      ready();
      await waiting;
      report({ done: 3, total: 3, locale: "de-DE", basenames: [] });
      return result;
    }, (event) => { if (connected) received.push(event.done); });
    await started;
    await new Promise(setImmediate);
    connected = false; // The browser reloads; no progress is delivered to its old listener.
    const reloaded = await getStudioRenderStatus("test");
    assert.equal(reloaded?.status, "RUNNING");
    assert.equal(reloaded?.progress.done, 1);
    assert.equal(reloaded?.progress.total, 3);
    assert.deepEqual(reloaded?.progress.basenames, ["a.png"]);
    let duplicateStarted = false;
    await assert.rejects(trackStudioRender("test", async () => { duplicateStarted = true; return result; }), /already running/);
    assert.equal(duplicateStarted, false);
    emit({ done: 2, total: 3, locale: "de-DE", basenames: ["b.png"] });
    await new Promise(setImmediate);
    assert.equal((await getStudioRenderStatus("test"))?.progress.done, 2);
    release();
    await rendering;
    const completed = await getStudioRenderStatus("test");
    assert.equal(completed?.operationId, reloaded?.operationId);
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(completed?.progress.done, 3);
    assert.equal(completed?.result?.revision.id, "revision");
    assert.deepEqual(received, [1]);

    await assert.rejects(trackStudioRender("test", async (report) => {
      report({ done: 0, total: 2, locale: "fr-FR", basenames: ["c.png"] });
      throw new Error("Worker unavailable");
    }), /Worker unavailable/);
    assert.equal((await getStudioRenderStatus("test"))?.status, "FAILED");
    assert.match((await getStudioRenderStatus("test"))?.error ?? "", /Worker unavailable/);

    const stale = rows.get("test");
    stale.status = "RUNNING";
    stale.updatedAt = new Date(Date.now() - 5 * 60_000);
    assert.equal((await getStudioRenderStatus("test"))?.status, "FAILED");
    assert.match((await getStudioRenderStatus("test"))?.error ?? "", /interrupted/);
    await trackStudioRender("test", async () => result);
    assert.equal((await getStudioRenderStatus("test"))?.status, "SUCCEEDED");
    assert.notEqual((await getStudioRenderStatus("test"))?.operationId, reloaded?.operationId);
  } finally { release?.(); for (const restore of restores.reverse()) restore(); }
});
