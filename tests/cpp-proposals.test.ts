import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CPP_MAX_GROUPS,
  groupKeywordsByTheme,
  tokenizeKeywordTerm,
  type CppKeywordStat,
} from "../src/services/cpp-proposals/grouping";
import { countryToScreenshotLocales, resolveProposalLocales } from "../src/services/cpp-proposals/locales";
import { cppFrameConfig } from "../src/services/cpp-proposals/render";

function stat(term: string, spend: number, taps = 10, installs = 2): CppKeywordStat {
  return { term, keyword: term, matchType: "EXACT", adGroupId: "g1", adGroupName: null, spend, taps, installs };
}

describe("cpp grouping: tokenizing", () => {
  it("lowercases, splits compounds and drops stopwords", () => {
    assert.deepEqual(tokenizeKeywordTerm("Reihenzähler stricken App"), ["reihenzähler", "stricken"]);
  });

  it("drops short tokens", () => {
    assert.deepEqual(tokenizeKeywordTerm("ab cd stricken"), ["stricken"]);
  });
});

describe("cpp grouping: themes", () => {
  const terms = [
    stat("reihenzähler stricken", 40.95, 392, 92),
    stat("maschenzähler", 39.83, 446, 96),
    stat("reihenzähler", 12.41, 141, 30),
    stat("row counter", 6.46, 66, 13),
    stat("maschenzähler app", 4.8, 53, 12),
    stat("häkeln app", 4.69, 94, 12),
    stat("stricken app", 3.02, 128, 8),
    stat("rundenzähler", 2.71, 56, 13),
    stat("zähler app", 0, 0, 0),
  ];

  it("groups multi-word terms under their strongest token", () => {
    const groups = groupKeywordsByTheme(terms);
    const keys = groups.map((group) => group.key);

    assert.ok(keys.includes("reihenzähler"));
    assert.ok(keys.includes("maschenzähler"));

    const rows = groups.find((group) => group.key === "reihenzähler")!;

    assert.deepEqual(
      rows.keywords.map((item) => item.term),
      ["reihenzähler stricken", "reihenzähler"],
    );
    assert.equal(rows.spend, 53.36);
  });

  it("ranks groups by spend and caps the count", () => {
    const groups = groupKeywordsByTheme(terms);

    assert.ok(groups.length <= CPP_MAX_GROUPS);
    assert.equal(groups[0].key, "reihenzähler");
    assert.deepEqual(
      groups.map((group) => group.spend),
      [...groups.map((group) => group.spend)].sort((a, b) => b - a),
    );
  });

  it("computes conversion rate and coverage", () => {
    const groups = groupKeywordsByTheme(terms);
    const rows = groups.find((group) => group.key === "reihenzähler")!;

    assert.equal(rows.taps, 533);
    assert.equal(rows.installs, 122);
    assert.ok(Math.abs((rows.conversionRate ?? 0) - 122 / 533) < 1e-9);
    assert.ok(rows.coverage > 0 && rows.coverage <= 1);
  });

  it("drops zero-spend terms", () => {
    const groups = groupKeywordsByTheme(terms);
    const grouped = groups.flatMap((group) => group.keywords.map((item) => item.term));

    assert.ok(!grouped.includes("zähler app"));
  });

  it("returns nothing without funded terms", () => {
    assert.deepEqual(groupKeywordsByTheme([]), []);
    assert.deepEqual(groupKeywordsByTheme([stat("zähler app", 0, 0, 0)]), []);
  });

  it("breaks token ties deterministically", () => {
    const first = groupKeywordsByTheme([stat("alpha beta", 5), stat("beta alpha", 5)]);
    const second = groupKeywordsByTheme([stat("beta alpha", 5), stat("alpha beta", 5)]);

    assert.deepEqual(
      first.map((group) => group.key),
      second.map((group) => group.key),
    );
  });
});

describe("cpp render: shared framing input", () => {
  it("hands the shared framing only the source palette as repo config", () => {
    assert.deepEqual(
      cppFrameConfig({ bgColor1: "#112233", bgColor2: "#445566", textColor: "#ffffff", textPosition: "bottom", offsetX: 40 }),
      { bgColor1: "#112233", bgColor2: "#445566", textColor: "#ffffff", textPosition: "bottom" },
    );
  });

  it("falls back to normalized defaults without a source style", () => {
    const config = cppFrameConfig(null);

    assert.equal(typeof config.bgColor1, "string");
    assert.equal(config.textPosition, "top");
  });
});

describe("cpp locales: campaign targeting", () => {
  it("maps countries to real screenshot locales", () => {
    assert.deepEqual(countryToScreenshotLocales("DE"), ["de-DE"]);
    assert.deepEqual(countryToScreenshotLocales("de"), ["de-DE"]);
    assert.deepEqual(countryToScreenshotLocales("BR"), ["pt-BR"]);
    assert.deepEqual(countryToScreenshotLocales("NO"), ["no"]);
    assert.deepEqual(countryToScreenshotLocales("JP"), ["ja"]);
    assert.deepEqual(countryToScreenshotLocales("XX"), []);
  });

  it("keeps only locales the app actually has", () => {
    assert.deepEqual(resolveProposalLocales(["DE", "AT", "CH"], ["en-US", "de-DE", "fr-FR"]), ["de-DE"]);
  });

  it("prefers regional variants the app has", () => {
    assert.deepEqual(resolveProposalLocales(["MX"], ["es-ES", "es-MX"]), ["es-MX"]);
    assert.deepEqual(resolveProposalLocales(["MX"], ["es-ES"]), ["es-ES"]);
  });

  it("falls back to english when nothing matches", () => {
    assert.deepEqual(resolveProposalLocales(["JP"], ["en-US", "de-DE"]), ["en-US"]);
  });

  it("falls back to the first locale without english", () => {
    assert.deepEqual(resolveProposalLocales(["JP"], ["de-DE", "fr-FR"]), ["de-DE"]);
  });

  it("keeps mapped locales without a source run", () => {
    assert.deepEqual(resolveProposalLocales(["DE", "FR"], []), ["de-DE", "fr-FR"]);
  });

  it("returns nothing without countries or source", () => {
    assert.deepEqual(resolveProposalLocales([], []), []);
    assert.deepEqual(resolveProposalLocales(["XX"], []), []);
  });
});
