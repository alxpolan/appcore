import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  buildRetentionMessageCreateBody,
  buildRetentionMessageLocalizationCreateBody,
  buildRetentionMessageLocalizationUpdateBody,
  buildRetentionMessagePlacementCreateBody,
  buildRetentionMessageVersionCreateBody,
  resolveRetentionMessageImageFile,
  toRetentionMessage,
  toRetentionMessageLocalization,
  toRetentionMessageVersion,
  uploadRetentionMessageImage,
} from "../src/services/asc-retention-messages";

describe("retention message create body", () => {
  it("builds a create body with the app relationship", () => {
    const body = buildRetentionMessageCreateBody({ appId: "app1", referenceName: "Cancel flow message" }) as any;

    assert.equal(body.data.type, "retentionMessages");
    assert.equal(body.data.attributes.referenceName, "Cancel flow message");
    assert.deepEqual(body.data.relationships.app.data, { type: "apps", id: "app1" });
  });

  it("rejects a blank referenceName or appId", () => {
    assert.throws(() => buildRetentionMessageCreateBody({ appId: "app1", referenceName: "  " }), /referenceName/);
    assert.throws(() => buildRetentionMessageCreateBody({ appId: "", referenceName: "Save" }), /appId/);
  });
});

describe("retention message version create body", () => {
  it("builds a create body with the message relationship", () => {
    const body = buildRetentionMessageVersionCreateBody({ retentionMessageId: "msg1" }) as any;

    assert.equal(body.data.type, "retentionMessageVersions");
    assert.deepEqual(body.data.relationships.retentionMessage.data, { type: "retentionMessages", id: "msg1" });
  });

  it("rejects a blank retentionMessageId", () => {
    assert.throws(() => buildRetentionMessageVersionCreateBody({ retentionMessageId: "" }), /retentionMessageId/);
  });
});

describe("retention message localization create body", () => {
  it("builds a create body with header and body", () => {
    const body = buildRetentionMessageLocalizationCreateBody({
      retentionMessageVersionId: "v1",
      locale: "en-US",
      header: "Wait, don't go!",
      body: "Here's what you'd miss.",
    }) as any;

    assert.equal(body.data.type, "retentionMessageLocalizations");
    assert.equal(body.data.attributes.locale, "en-US");
    assert.equal(body.data.attributes.header, "Wait, don't go!");
    assert.equal(body.data.attributes.body, "Here's what you'd miss.");
    assert.deepEqual(body.data.relationships.retentionMessageVersion.data, {
      type: "retentionMessageVersions",
      id: "v1",
    });
  });

  it("allows header-only or body-only localizations", () => {
    const headerOnly = buildRetentionMessageLocalizationCreateBody({
      retentionMessageVersionId: "v1",
      locale: "en-US",
      header: "Wait, don't go!",
    }) as any;

    assert.equal(headerOnly.data.attributes.body, undefined);

    const bodyOnly = buildRetentionMessageLocalizationCreateBody({
      retentionMessageVersionId: "v1",
      locale: "en-US",
      body: "Here's what you'd miss.",
    }) as any;

    assert.equal(bodyOnly.data.attributes.header, undefined);
  });

  it("requires at least one of header or body", () => {
    assert.throws(
      () => buildRetentionMessageLocalizationCreateBody({ retentionMessageVersionId: "v1", locale: "en-US" }),
      /At least one of header or body/,
    );
  });

  it("enforces the header and body length limits", () => {
    assert.throws(
      () =>
        buildRetentionMessageLocalizationCreateBody({
          retentionMessageVersionId: "v1",
          locale: "en-US",
          header: "x".repeat(67),
        }),
      /header must be at most 66 characters/,
    );
    assert.throws(
      () =>
        buildRetentionMessageLocalizationCreateBody({
          retentionMessageVersionId: "v1",
          locale: "en-US",
          body: "x".repeat(145),
        }),
      /body must be at most 144 characters/,
    );
  });

  it("rejects a blank locale or version id", () => {
    assert.throws(
      () =>
        buildRetentionMessageLocalizationCreateBody({ retentionMessageVersionId: "v1", locale: "", header: "Hi" }),
      /locale/,
    );
    assert.throws(
      () =>
        buildRetentionMessageLocalizationCreateBody({ retentionMessageVersionId: "", locale: "en-US", header: "Hi" }),
      /retentionMessageVersionId/,
    );
  });
});

describe("retention message localization update body", () => {
  it("only sets attributes that were provided", () => {
    const body = buildRetentionMessageLocalizationUpdateBody({ id: "loc1", header: "New header" }) as any;

    assert.deepEqual(body.data.attributes, { header: "New header" });
  });

  it("clears a field with null", () => {
    const body = buildRetentionMessageLocalizationUpdateBody({ id: "loc1", body: null }) as any;

    assert.deepEqual(body.data.attributes, { body: null });
  });

  it("enforces the length limits on update", () => {
    assert.throws(
      () => buildRetentionMessageLocalizationUpdateBody({ id: "loc1", header: "x".repeat(67) }),
      /header must be at most 66 characters/,
    );
  });
});

describe("retention message placement create body", () => {
  it("builds a create body linking the image and version", () => {
    const body = buildRetentionMessagePlacementCreateBody({
      imageId: "img1",
      retentionMessageVersionId: "v1",
    }) as any;

    assert.equal(body.data.type, "appAssetLibraryPlacements");
    assert.equal(body.data.attributes.placementType, "RETENTION_MESSAGE_ASSET");
    assert.deepEqual(body.data.relationships.image.data, { type: "appAssetLibraryImages", id: "img1" });
    assert.deepEqual(body.data.relationships.retentionMessageVersion.data, {
      type: "retentionMessageVersions",
      id: "v1",
    });
  });
});

describe("retention message mapping", () => {
  it("maps a retentionMessages resource", () => {
    assert.deepEqual(toRetentionMessage({ id: "msg1", attributes: { referenceName: "Save" } }), {
      id: "msg1",
      referenceName: "Save",
    });
  });

  it("rejects a retentionMessages response missing required fields", () => {
    assert.throws(() => toRetentionMessage({ id: "msg1" }), /referenceName/);
  });

  it("maps a retentionMessageVersions resource", () => {
    assert.deepEqual(toRetentionMessageVersion({ id: "v1", attributes: { state: "PREPARE_FOR_SUBMISSION" } }), {
      id: "v1",
      state: "PREPARE_FOR_SUBMISSION",
    });
    assert.deepEqual(toRetentionMessageVersion({ id: "v2" }), { id: "v2", state: null });
  });

  it("maps a retentionMessageLocalizations resource", () => {
    assert.deepEqual(
      toRetentionMessageLocalization({ id: "loc1", attributes: { locale: "en-US", header: "Hi", body: "Bye" } }),
      { id: "loc1", locale: "en-US", header: "Hi", body: "Bye" },
    );
  });

  it("rejects a retentionMessageLocalizations response missing locale", () => {
    assert.throws(() => toRetentionMessageLocalization({ id: "loc1", attributes: {} }), /locale/);
  });
});

async function makePng(width: number, height: number, withAlpha: boolean): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: withAlpha ? 4 : 3, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe("retention message image resolution", () => {
  it("requires exactly one of imageDataUrl or imageUrl", async () => {
    await assert.rejects(resolveRetentionMessageImageFile({}), /exactly one/);
    await assert.rejects(
      resolveRetentionMessageImageFile({ imageDataUrl: "data:image/png;base64,AA==", imageUrl: "https://x/a.png" }),
      /exactly one/,
    );
  });

  it("rejects a non-PNG data URL", async () => {
    await assert.rejects(resolveRetentionMessageImageFile({ imageDataUrl: "data:image/jpeg;base64,AAAA" }), /PNG data URL/);
  });

  it("rejects non-http image URLs", async () => {
    await assert.rejects(resolveRetentionMessageImageFile({ imageUrl: "ftp://example.com/a.png" }), /http or https/);
    await assert.rejects(resolveRetentionMessageImageFile({ imageUrl: "notaurl" }), /Invalid image URL/);
  });

  it("rejects a fetched URL that doesn't serve PNG", async () => {
    const fetchHttp: any = { get: async () => ({ data: Buffer.from([1]), headers: { "content-type": "image/jpeg" } }) };

    await assert.rejects(
      resolveRetentionMessageImageFile({ imageUrl: "https://example.com/a.png" }, fetchHttp),
      /must serve a PNG/,
    );
  });

  it("rejects images with the wrong dimensions", async () => {
    const tiny = await makePng(10, 10, false);
    const dataUrl = `data:image/png;base64,${tiny.toString("base64")}`;

    await assert.rejects(resolveRetentionMessageImageFile({ imageDataUrl: dataUrl }), /must be 3840x2160 or 5244x2950/);
  });

  it("rejects images with transparency", async () => {
    const withAlpha = await makePng(3840, 2160, true);
    const dataUrl = `data:image/png;base64,${withAlpha.toString("base64")}`;

    await assert.rejects(resolveRetentionMessageImageFile({ imageDataUrl: dataUrl }), /must not have transparency/);
  });

  it("accepts a correctly sized opaque PNG", async () => {
    const valid = await makePng(3840, 2160, false);
    const dataUrl = `data:image/png;base64,${valid.toString("base64")}`;

    const file = await resolveRetentionMessageImageFile({ imageDataUrl: dataUrl, fileName: "banner.png" });

    assert.equal(file.fileName, "banner.png");
    assert.ok(file.bytes.length > 0);
  });
});

describe("retention message image upload flow", () => {
  it("resolves the asset library, reserves, uploads each chunk, then confirms", async () => {
    const calls: Array<{ method: string; url: string; body?: any }> = [];
    const puts: Array<{ url: string; bytes: Buffer; headers: any }> = [];
    const asc: any = {
      client: {
        get: async (url: string) => {
          calls.push({ method: "GET", url });

          return { data: { data: { id: "lib1" } } };
        },
        post: async (url: string, body: any) => {
          calls.push({ method: "POST", url, body });

          return {
            data: {
              data: {
                id: "img1",
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

    const imageId = await uploadRetentionMessageImage(asc, "app1", { fileName: "banner.png", bytes }, putHttp);

    assert.equal(imageId, "img1");
    assert.equal(calls[0].url, "/apps/app1/assetLibrary");
    assert.equal(calls[1].url, "/appAssetLibraryImages");
    assert.deepEqual(calls[1].body.data.attributes, {
      category: "CREATIVE_ASSETS",
      fileName: "banner.png",
      fileSize: 4,
    });
    assert.deepEqual(calls[1].body.data.relationships.assetLibrary.data, {
      type: "appAssetLibraries",
      id: "lib1",
    });
    assert.deepEqual(
      puts.map((p) => [p.url, [...p.bytes]]),
      [
        ["https://uploads.example.com/part1", [10, 20]],
        ["https://uploads.example.com/part2", [30, 40]],
      ],
    );
    assert.equal(calls[2].url, "/appAssetLibraryImages/img1");
    assert.deepEqual(calls[2].body.data.attributes, { uploaded: true });
  });

  it("fails loudly when the app has no resolvable asset library", async () => {
    const asc: any = { client: { get: async () => ({ data: { data: null } }) } };

    await assert.rejects(
      uploadRetentionMessageImage(asc, "app1", { fileName: "banner.png", bytes: Buffer.from([1]) }),
      /asset library/,
    );
  });
});
