import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reorderFramedScreenshots } from "../src/services/screenshot-studio/ordering";
import { applyStudioGeometry } from "../web/src/components/screenshots/studioApply";
import type { StudioItem, StudioLocaleData, LocaleStylesMap } from "../web/src/components/screenshots/studioApi";
import { DEFAULT_STUDIO_STYLE } from "../src/services/screenshot-studio/style";
import { effectiveLocaleStyles, parseLocaleStyles } from "../src/services/screenshot-studio/revisions";

const item = (basename: string, deviceLabel = 'iPhone 6.9"'): StudioItem => ({
  basename, deviceLabel, title: "Localized caption", url: "", rawUrl: null, descKey: null, hasRaw: true,
});
const a = item("01_Projects__iphone_6.9.png");
const b = item("02_Tasks__iphone_6.9.png");
const tablet = item("01_Projects__ipad.png", 'iPad 13"');
const locales: StudioLocaleData[] = [
  { locale: "en-US", items: [a, b, tablet], styles: {} },
  { locale: "de-DE", items: [a, b, tablet], styles: {} },
  { locale: "fr-FR", items: [b, tablet], styles: {} },
];
const source = { ...DEFAULT_STUDIO_STYLE, offsetX: 40, deviceScale: 1.2, titleRotation: 12 };
const initial: LocaleStylesMap = {
  "en-US": { [tablet.basename]: { offsetX: -30 }, [b.basename]: { deviceFrame: "blue.png", titleLines: ["Keep me"] } },
  "de-DE": { [a.basename]: { offsetX: 7 } },
  "fr-FR": {},
};

describe("Studio Apply geometry scopes", () => {
  it("applies only to this device in the current language", () => {
    const before = JSON.stringify(initial);
    const result = applyStudioGeometry(initial, locales, "en-US", a, source, "device-locale");
    assert.equal(result["en-US"][a.basename].offsetX, 40);
    assert.equal(result["en-US"][b.basename].deviceScale, 1.2);
    assert.deepEqual(result["en-US"][tablet.basename], initial["en-US"][tablet.basename]);
    assert.deepEqual(result["de-DE"], initial["de-DE"]);
    assert.deepEqual(result["fr-FR"], {});
    assert.equal(result["en-US"][b.basename].deviceFrame, "blue.png");
    assert.deepEqual(result["en-US"][b.basename].titleLines, ["Keep me"]);
    assert.equal(JSON.stringify(initial), before);
  });

  it("applies this exact screenshot to all languages where it exists", () => {
    const result = applyStudioGeometry(initial, locales, "en-US", a, source, "screen-all");
    for (const locale of ["en-US", "de-DE"]) assert.equal(result[locale][a.basename].offsetX, 40);
    assert.deepEqual(result["en-US"][b.basename], initial["en-US"][b.basename]);
    assert.deepEqual(result["fr-FR"], {});
  });

  it("applies only this device to all languages", () => {
    const result = applyStudioGeometry(initial, locales, "en-US", a, source, "device-all");
    for (const locale of locales) {
      for (const shot of locale.items.filter((i) => i.deviceLabel === a.deviceLabel)) {
        assert.equal(result[locale.locale][shot.basename].offsetX, 40);
        assert.equal(result[locale.locale][shot.basename].titleRotation, 12);
      }
      assert.deepEqual(result[locale.locale][tablet.basename], initial[locale.locale][tablet.basename]);
    }
  });

  it("copies default geometry without clearing unrelated shots or languages", () => {
    const result = applyStudioGeometry(initial, locales, "en-US", a, DEFAULT_STUDIO_STYLE, "device-locale");
    assert.equal(result["en-US"][b.basename].offsetX, 0);
    assert.equal(result["en-US"][b.basename].deviceScale, 1);
    assert.equal(result["en-US"][b.basename].deviceFrame, "blue.png");
    assert.deepEqual(result["de-DE"], initial["de-DE"]);
    assert.deepEqual(result["en-US"][tablet.basename], initial["en-US"][tablet.basename]);
  });
});

describe("locale geometry compatibility", () => {
  it("reads every legacy style key, including patches without offsets", () => {
    for (const patch of [{ titleBoxW: 200 }, { deviceFrame: "blue.png" }, { bgColor1: "#ffffff" }]) {
      const parsed = parseLocaleStyles({ [a.basename]: patch });
      assert.deepEqual(effectiveLocaleStyles(parsed, "de-DE"), { [a.basename]: patch });
    }
  });

  it("keeps locale styles independent and explicit empty locales override legacy fallback", () => {
    const parsed = parseLocaleStyles({ "*": { [a.basename]: { offsetX: 10 } }, "de-DE": {} });
    assert.deepEqual(effectiveLocaleStyles(parsed, "de-DE"), {});
    assert.equal(effectiveLocaleStyles(parsed, "en-US")[a.basename].offsetX, 10);
  });

  it("does not turn malformed values into locale maps", () => {
    assert.deepEqual(parseLocaleStyles(null), {});
    assert.deepEqual(parseLocaleStyles([]), {});
    assert.deepEqual(parseLocaleStyles({ "de-DE": 42 }), {});
  });
});


describe("screenshot ordering", () => {
  const framed = { "en-US": ["/en/a.png", "/en/b.png"], "de-DE": ["/de/extra.png", "/de/b.png", "/de/a.png", "/de/last.png"] };
  it("preserves other languages unless propagation is requested", () => {
    const result = reorderFramedScreenshots(framed, "en-US", ["b.png", "a.png"]);
    assert.deepEqual(result["en-US"], ["/en/b.png", "/en/a.png"]);
    assert.deepEqual(result["de-DE"], framed["de-DE"]);
  });
  it("leaves unmatched screenshots at the end in their existing order", () => {
    const result = reorderFramedScreenshots(framed, "en-US", ["b.png", "a.png"], true);
    assert.deepEqual(result["de-DE"], ["/de/b.png", "/de/a.png", "/de/extra.png", "/de/last.png"]);
    assert.deepEqual(framed["en-US"], ["/en/a.png", "/en/b.png"]);
  });
  it("rejects duplicate, missing, unknown basenames and nonexistent languages", () => {
    for (const order of [["a.png", "a.png"], ["a.png"], ["a.png", "unknown.png"]]) {
      assert.throws(() => reorderFramedScreenshots(framed, "en-US", order), /exactly once/);
    }
    assert.throws(() => reorderFramedScreenshots(framed, "xx", ["a.png", "b.png"]), /not found/);
  });
});
