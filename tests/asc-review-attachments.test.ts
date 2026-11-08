import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReviewAttachmentFile,
  toReviewAttachment,
  uploadReviewAttachment,
} from "../src/services/asc-review-attachments";

const MP4_DATA_URL = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

describe("review attachment mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const attachment = toReviewAttachment({
      id: "a1",
      attributes: { fileName: "screen-recording.mp4", fileSize: 1024, assetDeliveryState: "READY" },
    });

    assert.deepEqual(attachment, {
      id: "a1",
      fileName: "screen-recording.mp4",
      fileSize: 1024,
      assetDeliveryState: "READY",
    });
  });

  it("rejects responses missing attributes or id", () => {
    assert.throws(() => toReviewAttachment({ id: "a1" }), /attributes/);
    assert.throws(() => toReviewAttachment({ attributes: {} }), /id/);
  });
});

describe("review attachment file resolution", () => {
  it("resolves MP4 data URLs", async () => {
    const file = await resolveReviewAttachmentFile({ fileDataUrl: MP4_DATA_URL });

    assert.equal(file.fileName, "screen-recording.mp4");
    assert.ok(file.bytes.length > 0);
  });

  it("requires exactly one of fileDataUrl or fileUrl", async () => {
    await assert.rejects(resolveReviewAttachmentFile({}), /exactly one/);
    await assert.rejects(
      resolveReviewAttachmentFile({ fileDataUrl: MP4_DATA_URL, fileUrl: "https://example.com/a.mp4" }),
      /exactly one/,
    );
  });

  it("rejects unsupported data URL types", async () => {
    await assert.rejects(resolveReviewAttachmentFile({ fileDataUrl: "data:video/avi;base64,AAAA" }), /MP4, MOV/);
    await assert.rejects(resolveReviewAttachmentFile({ fileDataUrl: "not-a-url" }), /MP4, MOV/);
  });

  it("rejects non-http file URLs", async () => {
    await assert.rejects(resolveReviewAttachmentFile({ fileUrl: "ftp://example.com/a.mp4" }), /http or https/);
  });

  it("fetches file URLs server-side and derives the file name", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const fetchHttp: any = {
      get: async () => ({ data: bytes, headers: { "content-type": "video/mp4" } }),
    };
    const file = await resolveReviewAttachmentFile({ fileUrl: "https://example.com/shots/flow.mp4" }, fetchHttp);

    assert.equal(file.fileName, "flow.mp4");
    assert.deepEqual(file.bytes, bytes);
  });

  it("rejects file URLs without a video or image content type", async () => {
    const fetchHttp: any = {
      get: async () => ({ data: Buffer.from([1]), headers: { "content-type": "application/zip" } }),
    };

    await assert.rejects(
      resolveReviewAttachmentFile({ fileUrl: "https://example.com/a.mp4" }, fetchHttp),
      /must serve a video or image/,
    );
  });
});

describe("review attachment upload flow", () => {
  it("reserves, uploads each operation chunk, then confirms", async () => {
    const calls: Array<{ method: string; url: string; body?: any }> = [];
    const puts: Array<{ url: string; bytes: Buffer }> = [];
    const asc: any = {
      client: {
        post: async (url: string, body: any) => {
          calls.push({ method: "POST", url, body });

          return {
            data: {
              data: {
                id: "att1",
                attributes: {
                  uploadOperations: [
                    { url: "https://uploads.example.com/p1", offset: 0, length: 2, requestHeaders: [] },
                    { url: "https://uploads.example.com/p2", offset: 2, length: 2, requestHeaders: [] },
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
      put: async (url: string, bytes: Buffer) => {
        puts.push({ url, bytes });
      },
    };

    const id = await uploadReviewAttachment(
      asc,
      "detail1",
      { fileName: "screen-recording.mp4", bytes: Buffer.from([10, 20, 30, 40]) },
      putHttp,
    );

    assert.equal(id, "att1");
    assert.equal(calls[0].url, "/appStoreReviewAttachments");
    assert.deepEqual(calls[0].body.data.attributes, { fileName: "screen-recording.mp4", fileSize: 4 });
    assert.deepEqual(calls[0].body.data.relationships.appStoreReviewDetail.data, {
      type: "appStoreReviewDetails",
      id: "detail1",
    });
    assert.deepEqual(
      puts.map((p) => [p.url, [...p.bytes]]),
      [
        ["https://uploads.example.com/p1", [10, 20]],
        ["https://uploads.example.com/p2", [30, 40]],
      ],
    );
    assert.equal(calls[1].url, "/appStoreReviewAttachments/att1");
    assert.deepEqual(calls[1].body.data.attributes, { uploaded: true });
  });
});
