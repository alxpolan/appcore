import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storefrontCount, storefrontToTerritory } from "../src/services/utils/asc-storefronts";

describe("asc storefronts: id to territory mapping", () => {
  it("covers all 175 storefronts", () => {
    assert.equal(storefrontCount(), 175);
  });

  it("maps probe-verified storefronts", () => {
    assert.equal(storefrontToTerritory("143441"), "US");
    assert.equal(storefrontToTerritory("143444"), "GB");
    assert.equal(storefrontToTerritory("143460"), "AU");
    assert.equal(storefrontToTerritory("143443"), "DE");
    assert.equal(storefrontToTerritory("143442"), "FR");
    assert.equal(storefrontToTerritory("143462"), "JP");
  });

  it("maps tricky territories", () => {
    assert.equal(storefrontToTerritory("143527"), "CI");
    assert.equal(storefrontToTerritory("143466"), "KR");
    assert.equal(storefrontToTerritory("143470"), "TW");
    assert.equal(storefrontToTerritory("143624"), "XK");
    assert.equal(storefrontToTerritory("143613"), "CD");
    assert.equal(storefrontToTerritory("143582"), "CG");
    assert.equal(storefrontToTerritory("143605"), "ZW");
  });

  it("returns null for unknown or missing keys", () => {
    assert.equal(storefrontToTerritory("999999"), null);
    assert.equal(storefrontToTerritory(null), null);
    assert.equal(storefrontToTerritory(undefined), null);
    assert.equal(storefrontToTerritory(""), null);
  });
});
