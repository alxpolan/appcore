import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReviewScreenshotFile,
  toReviewScreenshot,
  uploadReviewScreenshot,
} from "../src/services/asc-review-screenshots";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("review screenshot mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const screenshot = toReviewScreenshot({
      id: "s1",
      attributes: {
        fileName: "review.png",
        fileSize: 1234,
        assetDeliveryState: "READY",
        imageAsset: {
          templateUrl: "https://example.com/{w}x{h}.{f}",
          width: 640,
          height: 360,
        },
      },
    });

    assert.deepEqual(screenshot, {
      id: "s1",
      fileName: "review.png",
      fileSize: 1234,
      assetDeliveryState: "READY",
      imageUrl: "https://example.com/640x360.png",
      width: 640,
      height: 360,
    });
  });

  it("maps missing screenshots and assets to null", () => {
    assert.equal(toReviewScreenshot(null), null);
    assert.equal(toReviewScreenshot(undefined), null);

    const screenshot = toReviewScreenshot({ id: "s2", attributes: { fileName: "a.png" } });

    assert.equal(screenshot?.imageUrl, null);
    assert.equal(screenshot?.fileSize, null);
  });

  it("rejects responses missing attributes or id", () => {
    assert.throws(() => toReviewScreenshot({ id: "s1" }), /attributes/);
    assert.throws(() => toReviewScreenshot({ attributes: {} }), /id/);
  });
});

describe("review screenshot file resolution", () => {
  it("resolves PNG data URLs", async () => {
    const file = await resolveReviewScreenshotFile({ imageDataUrl: PNG_DATA_URL, fileName: "shot.png" });

    assert.equal(file.fileName, "shot.png");
    assert.ok(file.bytes.length > 0);
  });

  it("requires exactly one of imageDataUrl or imageUrl", async () => {
    await assert.rejects(resolveReviewScreenshotFile({}), /exactly one/);
    await assert.rejects(
      resolveReviewScreenshotFile({ imageDataUrl: PNG_DATA_URL, imageUrl: "https://example.com/a.png" }),
      /exactly one/,
    );
  });

  it("rejects malformed data URLs", async () => {
    await assert.rejects(resolveReviewScreenshotFile({ imageDataUrl: "data:image/gif;base64,AAAA" }), /PNG or JPEG/);
    await assert.rejects(resolveReviewScreenshotFile({ imageDataUrl: "not-a-url" }), /PNG or JPEG/);
  });

  it("rejects non-http image URLs", async () => {
    await assert.rejects(resolveReviewScreenshotFile({ imageUrl: "ftp://example.com/a.png" }), /http or https/);
    await assert.rejects(resolveReviewScreenshotFile({ imageUrl: "notaurl" }), /Invalid image URL/);
  });

  it("fetches image URLs server-side and derives the file name", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const fetchHttp: any = {
      get: async () => ({ data: bytes, headers: { "content-type": "image/png" } }),
    };
    const file = await resolveReviewScreenshotFile(
      { imageUrl: "https://example.com/shots/review-1.png" },
      fetchHttp,
    );

    assert.equal(file.fileName, "review-1.png");
    assert.deepEqual(file.bytes, bytes);
  });

  it("rejects image URLs without an image content type", async () => {
    const fetchHttp: any = {
      get: async () => ({ data: Buffer.from([1]), headers: { "content-type": "text/html" } }),
    };

    await assert.rejects(
      resolveReviewScreenshotFile({ imageUrl: "https://example.com/a.png" }, fetchHttp),
      /must serve an image/,
    );
  });
});

describe("review screenshot upload flow", () => {
  it("reserves, uploads each operation chunk, then confirms", async () => {
    const calls: Array<{ method: string; url: string; body?: any }> = [];
    const puts: Array<{ url: string; bytes: Buffer; headers: any }> = [];
    const asc: any = {
      client: {
        post: async (url: string, body: any) => {
          calls.push({ method: "POST", url, body });

          return {
            data: {
              data: {
                id: "shot1",
                attributes: {
                  uploadOperations: [
                    {
                      url: "https://uploads.example.com/part1",
                      offset: 0,
                      length: 2,
                      requestHeaders: [{ name: "Content-Type", value: "application/octet-stream" }],
                    },
                    { url: "https://uploads.example.com/part2", offset: 2, length: 2, requestHeaders: [] },
                  ],
                },
              },
            },
          };
        },
        patch: async (url: string, body: any) => {
          calls.push({ method: "PATCH", url, body });
        },
      },
    };
    const putHttp: any = {
      put: async (url: string, bytes: Buffer, config: any) => {
        puts.push({ url, bytes, headers: config.headers });
      },
    };
    const bytes = Buffer.from([10, 20, 30, 40]);

    const id = await uploadReviewScreenshot(asc, "sub1", { fileName: "review.png", bytes }, putHttp);

    assert.equal(id, "shot1");
    assert.equal(calls[0].url, "/subscriptionAppStoreReviewScreenshots");
    assert.deepEqual(calls[0].body.data.attributes, { fileName: "review.png", fileSize: 4 });
    assert.deepEqual(calls[0].body.data.relationships.subscription.data, {
      type: "subscriptions",
      id: "sub1",
    });
    assert.deepEqual(
      puts.map((p) => [p.url, [...p.bytes]]),
      [
        ["https://uploads.example.com/part1", [10, 20]],
        ["https://uploads.example.com/part2", [30, 40]],
      ],
    );
    assert.deepEqual(puts[0].headers, { "Content-Type": "application/octet-stream" });
    assert.equal(calls[1].url, "/subscriptionAppStoreReviewScreenshots/shot1");
    assert.deepEqual(calls[1].body.data.attributes, { uploaded: true });
  });
});
