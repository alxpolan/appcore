import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeWorkerImageData } from "../src/services/worker-client";

describe("decodeWorkerImageData", () => {
  it("accepts the Buffer returned by the fetch-based http client", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const decoded = decodeWorkerImageData(png);

    assert.ok(decoded);
    assert.ok(Buffer.isBuffer(decoded));
    assert.deepEqual([...decoded], [...png]);
  });

  it("converts a raw ArrayBuffer", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const decoded = decodeWorkerImageData(bytes);

    assert.ok(decoded);
    assert.ok(Buffer.isBuffer(decoded));
    assert.equal(decoded.length, 4);
  });

  it("rejects empty payloads", () => {
    assert.equal(decodeWorkerImageData(Buffer.alloc(0)), null);
    assert.equal(decodeWorkerImageData(new ArrayBuffer(0)), null);
  });

  it("rejects non-binary payloads", () => {
    assert.equal(decodeWorkerImageData(null), null);
    assert.equal(decodeWorkerImageData(undefined), null);
    assert.equal(decodeWorkerImageData("89504e47"), null);
    assert.equal(decodeWorkerImageData({ byteLength: 8 }), null);
  });
});
