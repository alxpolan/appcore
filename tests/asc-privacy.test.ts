import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDataUsageCreateBody,
  buildIrisHeaders,
  dataUsageCategoriesUrl,
  dataUsageDeleteUrl,
  dataUsagePublishStateUrl,
  dataUsagePurposesUrl,
  dataUsagesListUrl,
  resolveIrisSession,
  toDataUsage,
  toDataUsageCategory,
  toDataUsagePublishState,
} from "../src/services/asc-privacy";

describe("privacy iris URL builders", () => {
  it("builds the captured list, publish-state, catalog and purposes URLs", () => {
    assert.equal(
      dataUsagesListUrl("6830250482"),
      "https://appstoreconnect.apple.com/iris/v1/apps/6830250482/dataUsages?include=category,purpose,grouping,dataProtection&limit=500",
    );
    assert.equal(
      dataUsagePublishStateUrl("6830250482"),
      "https://appstoreconnect.apple.com/iris/v1/apps/6830250482/dataUsagePublishState",
    );
    assert.equal(
      dataUsageCategoriesUrl(),
      "https://appstoreconnect.apple.com/iris/v1/appDataUsageCategories?include=grouping",
    );
    assert.equal(dataUsagePurposesUrl(), "https://appstoreconnect.apple.com/iris/v1/appDataUsagePurposes");
  });
});

describe("privacy iris headers", () => {
  it("sends the captured header set with team headers", () => {
    const headers = buildIrisHeaders({
      accept: "",
      contentType: "",
      csrfToken: "token123",
      teamId: "team1",
      teamType: "PURPLESOFTWARE",
      referer: "https://appstoreconnect.apple.com/apps/6830250482/distribution/privacy",
      cookies: "a=b",
    });

    assert.equal(headers["accept"], "application/vnd.api+json, application/json, text/csv");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers["x-csrf-itc"], "token123");
    assert.equal(headers["x-connect-team-id"], "team1");
    assert.equal(headers["x-connect-team-type"], "PURPLESOFTWARE");
    assert.equal(headers["Referer"], "https://appstoreconnect.apple.com/apps/6830250482/distribution/privacy");
    assert.equal(headers["Cookie"], "a=b");
  });

  it("omits blank team headers", () => {
    const headers = buildIrisHeaders({
      accept: "",
      contentType: "",
      csrfToken: "token123",
      teamId: "",
      teamType: "",
      referer: "https://example.com",
      cookies: "a=b",
    });

    assert.equal(headers["x-connect-team-id"], undefined);
    assert.equal(headers["x-connect-team-type"], undefined);
  });
});

describe("privacy data usage create body", () => {
  it("builds the exact captured shape", () => {
    assert.deepEqual(buildDataUsageCreateBody("6830250482", "USER_ID"), {
      data: {
        type: "appDataUsages",
        relationships: {
          category: { data: { type: "appDataUsageCategories", id: "USER_ID" } },
          app: { data: { type: "apps", id: "6830250482" } },
        },
      },
    });
  });

  it("rejects blank app and category ids", () => {
    assert.throws(() => buildDataUsageCreateBody("", "USER_ID"), /appId/);
    assert.throws(() => buildDataUsageCreateBody("6830250482", "  "), /categoryId/);
  });

  it("attaches purpose and data protection like the captured call", () => {
    assert.deepEqual(buildDataUsageCreateBody("6830250482", "USER_ID", "ANALYTICS", "DATA_NOT_LINKED_TO_YOU"), {
      data: {
        type: "appDataUsages",
        relationships: {
          category: { data: { type: "appDataUsageCategories", id: "USER_ID" } },
          app: { data: { type: "apps", id: "6830250482" } },
          dataProtection: { data: { type: "appDataUsageDataProtections", id: "DATA_NOT_LINKED_TO_YOU" } },
          purpose: { data: { type: "appDataUsagePurposes", id: "ANALYTICS" } },
        },
      },
    });
  });
});

describe("privacy data usage mapping", () => {
  it("maps linkage ids from JSON:API relationships", () => {
    const usage = toDataUsage({
      id: "u1",
      attributes: { published: true },
      relationships: {
        category: { data: { type: "appDataUsageCategories", id: "USER_ID" } },
        purpose: { data: { type: "appDataUsagePurposes", id: "ANALYTICS" } },
        dataProtection: { data: { type: "appDataUsageDataProtections", id: "DATA_NOT_LINKED_TO_YOU" } },
      },
    });

    assert.deepEqual(usage, {
      id: "u1",
      categoryId: "USER_ID",
      purposeId: "ANALYTICS",
      dataProtectionId: "DATA_NOT_LINKED_TO_YOU",
      attributes: { published: true },
    });
  });

  it("maps missing linkages to null and rejects bad shapes", () => {
    const usage = toDataUsage({ id: "u2", relationships: {} });

    assert.equal(usage.categoryId, null);
    assert.throws(() => toDataUsage({ attributes: {} }), /id/);
    assert.throws(
      () => toDataUsage({ id: "u3", relationships: { category: { data: { id: 42 } } } }),
      /invalid "category" linkage/,
    );
  });

  it("builds delete URLs", () => {
    assert.equal(dataUsageDeleteUrl("u1"), "https://appstoreconnect.apple.com/iris/v1/appDataUsages/u1");
    assert.throws(() => dataUsageDeleteUrl("  "), /usageId/);
  });
});

describe("privacy catalog and publish state mapping", () => {
  it("maps live category shapes with grouping", () => {
    assert.deepEqual(
      toDataUsageCategory({
        type: "appDataUsageCategories",
        id: "PAYMENT_INFORMATION",
        attributes: { deleted: false },
        relationships: { grouping: { data: { type: "appDataUsageGroupings", id: "FINANCIAL_INFO" } } },
      }),
      { id: "PAYMENT_INFORMATION", groupingId: "FINANCIAL_INFO" },
    );
    assert.throws(() => toDataUsageCategory({ attributes: {} }), /id/);
  });

  it("maps the live publish state shape", () => {
    assert.deepEqual(
      toDataUsagePublishState({
        data: {
          type: "appDataUsagesPublishState",
          id: "6757282968",
          attributes: { published: false, lastPublished: null, lastPublishedBy: null },
        },
      }),
      { published: false, lastPublished: null, lastPublishedBy: null },
    );
    assert.throws(() => toDataUsagePublishState({ data: { attributes: {} } }), /published flag/);
  });

  it("maps live usage shapes including empty linkages", () => {
    assert.deepEqual(
      toDataUsage({ id: "ca7629c9", relationships: {}, attributes: {} }),
      {
        id: "ca7629c9",
        categoryId: null,
        purposeId: null,
        dataProtectionId: null,
        attributes: {},
      },
    );
  });
});

describe("privacy iris session", () => {
  it("resolves cookies and team headers from env", () => {
    assert.deepEqual(
      resolveIrisSession({ ASC_ANALYTICS_COOKIES: "a=b", ASC_IRIS_TEAM_ID: "t1", ASC_IRIS_TEAM_TYPE: "X" }),
      { cookies: "a=b", teamId: "t1", teamType: "X" },
    );
  });

  it("fails loudly without cookies", () => {
    assert.throws(() => resolveIrisSession({}), /ASC_ANALYTICS_COOKIES/);
  });
});
