import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STUDIO_GEOMETRY,
  STUDIO_GEOMETRY_KEYS,
  STUDIO_TITLE_LINES_MAX,
  STUDIO_TITLE_MAX_LENGTH,
  isStudioFontId,
  matchDescriptionKey,
  matchShotStyle,
  normalizeHexColor,
  normalizeStudioStyle,
  normalizeStudioTitle,
  normalizeTitleBoxSize,
  normalizeTitleLines,
  resolveShotStyles,
  resolveStudioTitle,
  storedShotStyles,
  studioBasename,
  studioDeviceLabel,
  titleLinesForTitle,
} from "../src/services/screenshot-studio/style";
import { asFramedMap } from "../src/services/screenshot-studio/revisions";
import {
  assertStudioBasename,
  assertStudioSegment,
  pickStudioSourceLocale,
  splitIntoChunks,
} from "../src/services/screenshot-studio/render";

describe("studio style: color normalization", () => {
  it("accepts 6-digit hex with or without hash", () => {
    assert.equal(normalizeHexColor("#667eea", "#000000"), "#667eea");
    assert.equal(normalizeHexColor("667EEA", "#000000"), "#667eea");
  });

  it("expands 3-digit hex", () => {
    assert.equal(normalizeHexColor("#fff", "#000000"), "#ffffff");
    assert.equal(normalizeHexColor("abc", "#000000"), "#aabbcc");
  });

  it("falls back on garbage", () => {
    assert.equal(normalizeHexColor("red", "#000000"), "#000000");
    assert.equal(normalizeHexColor("#12", "#000000"), "#000000");
    assert.equal(normalizeHexColor("#12345g", "#000000"), "#000000");
    assert.equal(normalizeHexColor(null, "#000000"), "#000000");
    assert.equal(normalizeHexColor(42, "#000000"), "#000000");
  });
});

describe("studio style: font ids", () => {
  it("accepts the three bundled fonts", () => {
    assert.equal(isStudioFontId("rounded"), true);
    assert.equal(isStudioFontId("inter"), true);
    assert.equal(isStudioFontId("baloo"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isStudioFontId("comic-sans"), false);
    assert.equal(isStudioFontId(null), false);
    assert.equal(isStudioFontId(42), false);
  });
});

describe("studio style: full style normalization", () => {
  it("fills defaults for missing or invalid fields", () => {
    const style = normalizeStudioStyle({ bgColor1: "not-a-color", font: "comic-sans" });

    assert.equal(style.bgColor1, "#667eea");
    assert.equal(style.bgColor2, "#764ba2");
    assert.equal(style.textColor, "#ffffff");
    assert.equal(style.font, "rounded");
    assert.equal(style.textPosition, "top");
    assert.equal(style.offsetX, 0);
    assert.equal(style.offsetY, 0);
    assert.equal(style.titleOffsetX, 0);
    assert.equal(style.titleOffsetY, 0);
  });

  it("keeps valid values", () => {
    const style = normalizeStudioStyle({
      bgColor1: "#111111",
      bgColor2: "#222222",
      textColor: "#333333",
      font: "baloo",
      textPosition: "bottom",
      offsetX: 12,
      offsetY: -8,
      titleOffsetX: 4,
      titleOffsetY: 6,
    });

    assert.equal(style.bgColor1, "#111111");
    assert.equal(style.bgColor2, "#222222");
    assert.equal(style.textColor, "#333333");
    assert.equal(style.font, "baloo");
    assert.equal(style.textPosition, "bottom");
    assert.equal(style.offsetX, 12);
    assert.equal(style.offsetY, -8);
    assert.equal(style.titleOffsetX, 4);
    assert.equal(style.titleOffsetY, 6);
  });

  it("rounds and clamps offsets", () => {
    const style = normalizeStudioStyle({
      offsetX: 12.7,
      offsetY: -99999,
      titleOffsetX: "nope",
      titleOffsetY: Number.NaN,
    });

    assert.equal(style.offsetX, 13);
    assert.equal(style.offsetY, -2048);
    assert.equal(style.titleOffsetX, 0);
    assert.equal(style.titleOffsetY, 0);
  });

  it("defaults and clamps scales", () => {
    assert.equal(normalizeStudioStyle({}).titleScale, 1);
    assert.equal(normalizeStudioStyle({}).deviceScale, 1);

    const style = normalizeStudioStyle({ titleScale: 99, deviceScale: 0.001 });

    assert.equal(style.titleScale, 3);
    assert.equal(style.deviceScale, 0.2);
    assert.equal(normalizeStudioStyle({ titleScale: "big", deviceScale: Number.NaN }).titleScale, 1);
  });

  it("defaults and clamps title box sizes", () => {
    assert.equal(normalizeStudioStyle({}).titleBoxW, 0);
    assert.equal(normalizeStudioStyle({}).titleBoxH, 0);

    const style = normalizeStudioStyle({ titleBoxW: 700.6, titleBoxH: 99999 });

    assert.equal(style.titleBoxW, 701);
    assert.equal(style.titleBoxH, 4096);
    assert.equal(normalizeTitleBoxSize(-5), 0);
    assert.equal(normalizeTitleBoxSize("wide"), 0);
  });

  it("cleans title lines", () => {
    assert.deepEqual(normalizeTitleLines(["  Tap to  ", "", "count   rows  "]), ["Tap to", "count rows"]);
    assert.deepEqual(normalizeTitleLines("not-an-array"), []);
    assert.deepEqual(normalizeTitleLines([42, null]), []);
    assert.deepEqual(normalizeStudioStyle({}).titleLines, []);
  });

  it("merges title lines past the cap instead of dropping text", () => {
    const lines = Array.from({ length: STUDIO_TITLE_LINES_MAX + 3 }, (_, i) => `word${i}`);
    const merged = normalizeTitleLines(lines);

    assert.equal(merged.length, STUDIO_TITLE_LINES_MAX);
    assert.equal(merged[STUDIO_TITLE_LINES_MAX - 1], `word${STUDIO_TITLE_LINES_MAX - 1} word${STUDIO_TITLE_LINES_MAX} word${STUDIO_TITLE_LINES_MAX + 1} word${STUDIO_TITLE_LINES_MAX + 2}`);
  });

  it("keeps geometry keys and defaults in sync", () => {
    const keys = Object.keys(DEFAULT_STUDIO_GEOMETRY).sort();

    assert.deepEqual([...STUDIO_GEOMETRY_KEYS].sort(), keys);
    assert.equal(normalizeStudioStyle(DEFAULT_STUDIO_GEOMETRY).titleScale, 1);
  });

  it("handles nullish input", () => {
    const style = normalizeStudioStyle(null);

    assert.equal(style.bgColor1, "#667eea");
    assert.equal(style.font, "rounded");
  });
});

describe("studio style: title normalization", () => {
  it("collapses whitespace and trims", () => {
    assert.equal(normalizeStudioTitle("  Track   every\nrep  "), "Track every rep");
  });

  it("caps length at the studio maximum", () => {
    const long = "x".repeat(STUDIO_TITLE_MAX_LENGTH + 20);

    assert.equal(normalizeStudioTitle(long).length, STUDIO_TITLE_MAX_LENGTH);
  });

  it("returns empty string for non-strings", () => {
    assert.equal(normalizeStudioTitle(null), "");
    assert.equal(normalizeStudioTitle(42), "");
  });
});

describe("studio style: description key matching", () => {
  const descriptions = { home: "Home screen", workout_detail: "Workout details" };

  it("matches exact and device-suffixed basenames", () => {
    assert.equal(matchDescriptionKey("home.png", descriptions), "home");
    assert.equal(matchDescriptionKey("home_iphone69.png", descriptions), "home");
    assert.equal(matchDescriptionKey("workout_detail_ipad13.png", descriptions), "workout_detail");
  });

  it("returns null without a match", () => {
    assert.equal(matchDescriptionKey("settings.png", descriptions), null);
  });
});

describe("studio style: title resolution", () => {
  const sublines = {
    "en-US": { home: "Track everything" },
    "de-DE": { home: "Tracke alles" },
  };

  const descriptions = { home: "Home screen" };

  it("prefers the requested locale subline", () => {
    assert.equal(
      resolveStudioTitle({ basename: "home_iphone69.png", locale: "de-DE", sublines, descriptions, fallback: "App" }),
      "Tracke alles",
    );
  });

  it("falls back to en-US then the app fallback", () => {
    assert.equal(
      resolveStudioTitle({ basename: "home.png", locale: "fr-FR", sublines, descriptions, fallback: "App" }),
      "Track everything",
    );
    assert.equal(
      resolveStudioTitle({ basename: "other.png", locale: "fr-FR", sublines, descriptions, fallback: "App" }),
      "App",
    );
  });
});

describe("studio style: device labels and basenames", () => {
  it("labels known devices and falls back to Other", () => {
    assert.equal(studioDeviceLabel("/screenshots/j/en-US/01_home_iphone6.9.png"), 'iPhone 6.9"');
    assert.equal(studioDeviceLabel("/screenshots/j/en-US/01_home_ipad13.png"), 'iPad 13"');
    assert.equal(studioDeviceLabel("/screenshots/j/en-US/shot.png"), "Other");
  });

  it("takes the basename off a url", () => {
    assert.equal(studioBasename("/screenshots/j/en-US/01_home.png"), "01_home.png");
    assert.equal(studioBasename("01_home.png"), "01_home.png");
  });
});

describe("studio revisions: framed map guard", () => {
  it("keeps string arrays per locale", () => {
    assert.deepEqual(asFramedMap({ "en-US": ["/a.png", 42, null] }), { "en-US": ["/a.png"] });
  });

  it("returns an empty map for garbage", () => {
    assert.deepEqual(asFramedMap(null), {});
    assert.deepEqual(asFramedMap([]), {});
    assert.deepEqual(asFramedMap("nope"), {});
  });
});

describe("studio render: input guards", () => {
  it("accepts safe segments and basenames", () => {
    assertStudioSegment("cm123abc", "job");
    assertStudioSegment("en-US", "locale");
    assert.equal(assertStudioBasename("01_home_iphone69.png"), "01_home_iphone69.png");
  });

  it("rejects traversal and odd names", () => {
    assert.throws(() => assertStudioSegment("../x", "job"));
    assert.throws(() => assertStudioSegment("a/b", "locale"));
    assert.throws(() => assertStudioBasename("../evil.png"));
    assert.throws(() => assertStudioBasename("shot.jpg"));
  });
});

describe("studio render: source locale picking", () => {
  it("prefers exact, then english, then first", () => {
    assert.equal(pickStudioSourceLocale("de-DE", ["de-DE", "en-US"]), "de-DE");
    assert.equal(pickStudioSourceLocale("de-DE", ["en-US", "fr-FR"]), "en-US");
    assert.equal(pickStudioSourceLocale("de-DE", ["en-GB", "fr-FR"]), "en-GB");
    assert.equal(pickStudioSourceLocale("de-DE", ["fr-FR"]), "fr-FR");
    assert.equal(pickStudioSourceLocale("de-DE", []), null);
  });
});

describe("studio render: chunk splitting", () => {
  it("splits evenly and keeps order", () => {
    assert.deepEqual(splitIntoChunks([1, 2, 3, 4], 2), [
      [1, 2],
      [3, 4],
    ]);
  });

  it("keeps the remainder in a final chunk", () => {
    assert.deepEqual(splitIntoChunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk for short lists and none for empty lists", () => {
    assert.deepEqual(splitIntoChunks([1, 2], 8), [[1, 2]]);
    assert.deepEqual(splitIntoChunks([], 8), []);
  });

  it("guards non-positive sizes with single-item chunks", () => {
    assert.deepEqual(splitIntoChunks([1, 2], 0), [[1], [2]]);
    assert.deepEqual(splitIntoChunks([1, 2], -3), [[1], [2]]);
  });
});

describe("studio style: title lines stay with their title", () => {
  it("keeps line breaks that segment the same title", () => {
    assert.deepEqual(titleLinesForTitle(["Tap to", "count rows"], "Tap   to count rows"), ["Tap to", "count rows"]);
  });

  it("drops lines copied from another caption", () => {
    assert.deepEqual(titleLinesForTitle(["Tap to", "count rows"], "Projekte auf einen Blick"), []);
  });

  it("drops empty titles and non-line input", () => {
    assert.deepEqual(titleLinesForTitle([], "Tap to count rows"), []);
    assert.deepEqual(titleLinesForTitle(["Tap to count rows"], ""), []);
    assert.deepEqual(titleLinesForTitle("not-an-array", "Tap to count rows"), []);
  });
});

describe("studio style: stored shot styles", () => {
  it("cleans a whole map and drops default-equal patches", () => {
    assert.deepEqual(
      storedShotStyles({
        "01_Projects__iphone_6.9.png": { offsetY: 238, titleScale: 0.947, titleLines: ["x"] },
        "02_Counter__iphone_6.9.png": {},
        "03_Other__iphone_6.9.png": null,
      }),
      { "01_Projects__iphone_6.9.png": { offsetY: 238, titleScale: 0.947 } },
    );
  });

  it("returns an empty map for garbage", () => {
    assert.deepEqual(storedShotStyles(null), {});
    assert.deepEqual(storedShotStyles([]), {});
    assert.deepEqual(storedShotStyles("nope"), {});
  });
});

describe("studio style: shot style matching", () => {
  const styles = {
    "01_Projects__iphone_6.9.png": { offsetY: 238 },
    "04_NewProject__iphone_6.9.png": { offsetY: 100 },
    "04_NewProject__ipad_unknown.png": { offsetY: 50 },
  };

  it("matches exact filenames", () => {
    assert.deepEqual(matchShotStyle(styles, "01_Projects__iphone_6.9.png"), { offsetY: 238 });
  });

  it("follows renumbered shots with the same core and device", () => {
    assert.deepEqual(matchShotStyle(styles, "05_NewProject__iphone_6.9.png"), { offsetY: 100 });
  });

  it("misses across devices and on ambiguous or unknown cores", () => {
    assert.equal(matchShotStyle({ "04_NewProject__iphone_6.9.png": { offsetY: 100 } }, "05_NewProject__ipad_unknown.png"), null);
    assert.equal(
      matchShotStyle(
        { "01_Foo__iphone_6.9.png": { offsetY: 1 }, "02_Foo__iphone_6.9.png": { offsetY: 2 } },
        "03_Foo__iphone_6.9.png",
      ),
      null,
    );
    assert.equal(matchShotStyle(styles, "03_PatternCrochet__iphone_6.9.png"), null);
    assert.equal(matchShotStyle(styles, "notes.txt"), null);
  });
});

describe("studio style: shot style resolution", () => {
  it("resolves each basename to the stored map keys", () => {
    assert.deepEqual(
      resolveShotStyles(
        {
          "01_Projects__iphone_6.9.png": { offsetY: 238 },
          "04_NewProject__iphone_6.9.png": { offsetY: 100 },
        },
        ["01_Projects__iphone_6.9.png", "05_NewProject__iphone_6.9.png", "03_PatternCrochet__iphone_6.9.png"],
      ),
      {
        "01_Projects__iphone_6.9.png": { offsetY: 238 },
        "05_NewProject__iphone_6.9.png": { offsetY: 100 },
      },
    );
  });
});
