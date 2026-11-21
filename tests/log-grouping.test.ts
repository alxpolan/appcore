import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupLogsByWorker, workerLabelOf } from "../web/src/components/Logs";

const BUILD_LINES = [
  "[deps] Framework: native (auto-detected)",
  "npm warn deprecated inflight@1.0.6",
  "[deps] node modules installed in 42s",
  "[pods] pod install complete in 10s",
  "[!] Unable to find a specification for `Alamofire`",
  "[!] CDN: trunk Repo update failed",
  "[deps] xcodebuild FAILED — exit code: 65",
];

describe("build log grouping", () => {
  it("does not treat CocoaPods [!] output as a worker", () => {
    assert.equal(workerLabelOf("[!] Unable to find a specification for `Alamofire`"), null);
  });

  it("keeps every line instead of dropping unprefixed ones", () => {
    const groups = groupLogsByWorker(BUILD_LINES);
    const shown = [...groups.values()].flat().join("\n");

    assert.ok(!groups.has("!"), "must not create a '!' group");
    for (const line of BUILD_LINES) {
      const stripped = line.replace(/^\[[^\]]+\] /, "");
      assert.ok(
        shown.includes(stripped),
        `line lost in grouped view: ${line}`,
      );
    }
  });

  it("keeps step groups for the worker's own prefixes", () => {
    const groups = groupLogsByWorker(BUILD_LINES);

    assert.ok(groups.has("deps"));
    assert.ok(groups.has("pods"));
  });
});
