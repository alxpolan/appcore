import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteOverlayUrls, rewriteOverlayUrlsInStyles } from "../src/services/screenshot-studio/render";
import type { StudioStyle } from "../src/services/screenshot-studio/style";

const baseOverlay = { id: "abc123", x: 10, y: 20, scale: 1, rotation: 0 };

describe("studio duplicate: overlay url rewriting", () => {
  it("rewrites an overlay url scoped to the source job", () => {
    const style = { overlays: [{ ...baseOverlay, url: "/screenshots/job-old/overlays/abc123.png" }] };

    const rewritten = rewriteOverlayUrls(style, "job-old", "job-new");

    assert.equal(rewritten.overlays[0].url, "/screenshots/job-new/overlays/abc123.png");
  });

  it("leaves unrelated overlay urls untouched", () => {
    const style = { overlays: [{ ...baseOverlay, url: "/screenshots/other-job/overlays/abc123.png" }] };

    const rewritten = rewriteOverlayUrls(style, "job-old", "job-new");

    assert.equal(rewritten.overlays[0].url, "/screenshots/other-job/overlays/abc123.png");
  });

  it("returns the same object when there are no overlays", () => {
    const style = { overlays: [] };

    assert.equal(rewriteOverlayUrls(style, "job-old", "job-new"), style);
  });

  it("handles a style with overlays left undefined", () => {
    const style: { overlays?: typeof baseOverlay[] & { url: string }[] } = {};

    assert.equal(rewriteOverlayUrls(style, "job-old", "job-new"), style);
  });

  it("rewrites overlays nested per locale and basename", () => {
    const styles = {
      "en-US": {
        "shot1.png": {
          overlays: [{ ...baseOverlay, url: "/screenshots/job-old/overlays/abc123.png" }],
        } as Partial<StudioStyle>,
        "shot2.png": {} as Partial<StudioStyle>,
      },
      "de-DE": {
        "shot1.png": {
          overlays: [{ ...baseOverlay, id: "xyz789", url: "/screenshots/job-old/overlays/xyz789.png" }],
        } as Partial<StudioStyle>,
      },
    };

    const rewritten = rewriteOverlayUrlsInStyles(styles, "job-old", "job-new");

    assert.equal(rewritten["en-US"]["shot1.png"].overlays?.[0].url, "/screenshots/job-new/overlays/abc123.png");
    assert.deepEqual(rewritten["en-US"]["shot2.png"], {});
    assert.equal(rewritten["de-DE"]["shot1.png"].overlays?.[0].url, "/screenshots/job-new/overlays/xyz789.png");
  });
});
