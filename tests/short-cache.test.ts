import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ShortCache } from "../src/services/utils/short-cache";
import { adsResponseCache } from "../src/web/api/response-cache";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("short cache: TTL + LRU store", () => {
  it("returns misses for unknown keys and hits after set", () => {
    const cache = new ShortCache();

    assert.equal(cache.get("a"), undefined);
    cache.set("a", "1", 1000);
    assert.equal(cache.get("a"), "1");
  });

  it("expires entries after their TTL", async () => {
    const cache = new ShortCache();

    cache.set("a", "1", 20);
    assert.equal(cache.get("a"), "1");
    await sleep(40);
    assert.equal(cache.get("a"), undefined);
  });

  it("evicts the least recently used key beyond capacity", () => {
    const cache = new ShortCache(2);

    cache.set("a", "1", 1000);
    cache.set("b", "2", 1000);
    assert.equal(cache.get("a"), "1");
    cache.set("c", "3", 1000);
    assert.equal(cache.get("a"), "1");
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("c"), "3");
  });

  it("overwriting a key refreshes its value and TTL", async () => {
    const cache = new ShortCache();

    cache.set("a", "1", 20);
    cache.set("a", "2", 1000);
    await sleep(40);
    assert.equal(cache.get("a"), "2");
  });

  it("invalidates by prefix and keeps other keys", () => {
    const cache = new ShortCache();

    cache.set("ads:t1:/x", "1", 1000);
    cache.set("ads:t1:/y", "2", 1000);
    cache.set("ads:t2:/x", "3", 1000);
    assert.equal(cache.invalidatePrefix("ads:t1:"), 2);
    assert.equal(cache.get("ads:t1:/x"), undefined);
    assert.equal(cache.get("ads:t2:/x"), "3");
  });
});

describe("ads response cache: middleware", () => {
  const mw = adsResponseCache();
  const req = (method: string, url: string, user: any = { userId: "u1", teamId: "t1" }) =>
    ({ method, originalUrl: url, user }) as any;

  function fakeRes() {
    const state = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      sentBody: undefined as unknown,
      finishHandlers: [] as (() => void)[],
    };

    const res: any = {
      get statusCode() {
        return state.statusCode;
      },
      set statusCode(v: number) {
        state.statusCode = v;
      },
      setHeader: (k: string, v: string) => {
        state.headers[k] = v;
      },
      type: () => res,
      send: (body: unknown) => {
        state.sentBody = body;
        return res;
      },
      json: (body: unknown) => {
        state.sentBody = body;
        return res;
      },
      on: (ev: string, fn: () => void) => {
        if (ev === "finish") state.finishHandlers.push(fn);
      },
      finish: (code: number) => {
        state.statusCode = code;
        for (const fn of state.finishHandlers) fn();
      },
    };

    return { res, state };
  }

  it("caches GET JSON and serves repeats without the handler", () => {
    const url = "/api/apple-ads/campaigns?days=30&case=hit";
    const first = fakeRes();
    let nextCalls = 0;

    mw(req("GET", url), first.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    first.res.json({ campaigns: [1] });
    assert.equal(first.state.headers["X-Cache"], "MISS");

    const second = fakeRes();

    mw(req("GET", url), second.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    assert.equal(second.state.headers["X-Cache"], "HIT");
    assert.equal(second.state.sentBody, JSON.stringify({ campaigns: [1] }));
  });

  it("keys entries per URL and per user", () => {
    const a = fakeRes();

    mw(req("GET", "/api/apple-ads/campaigns?case=url-a"), a.res, () => {});
    a.res.json({ v: "a" });

    const otherUrl = fakeRes();
    let nextCalls = 0;

    mw(req("GET", "/api/apple-ads/campaigns?case=url-b"), otherUrl.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    assert.equal(otherUrl.state.headers["X-Cache"], undefined);

    const otherUser = fakeRes();

    mw(
      req("GET", "/api/apple-ads/campaigns?case=url-a", { userId: "u2", teamId: "t1" }),
      otherUser.res,
      () => {
        nextCalls++;
      },
    );
    assert.equal(nextCalls, 2);
    assert.equal(otherUser.state.headers["X-Cache"], undefined);
  });

  it("never caches error responses", () => {
    const url = "/api/apple-ads/campaigns?case=err";
    const failing = fakeRes();

    mw(req("GET", url), failing.res, () => {});
    failing.res.statusCode = 500;
    failing.res.json({ error: "boom" });
    assert.equal(failing.state.headers["X-Cache"], undefined);

    const retry = fakeRes();
    let nextCalls = 0;

    mw(req("GET", url), retry.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    assert.equal(retry.state.headers["X-Cache"], undefined);
  });

  it("successful mutations invalidate the team's cached reads", () => {
    const url = "/api/apple-ads/campaigns?case=invalidate";
    const primed = fakeRes();

    mw(req("GET", url), primed.res, () => {});
    primed.res.json({ campaigns: [] });

    const mutating = fakeRes();
    let nextCalls = 0;

    mw(req("POST", "/api/apple-ads/campaigns"), mutating.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    mutating.res.finish(200);

    const after = fakeRes();

    mw(req("GET", url), after.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 2);
    assert.equal(after.state.headers["X-Cache"], undefined);
  });

  it("failed mutations keep the cache", () => {
    const url = "/api/apple-ads/campaigns?case=keep";
    const primed = fakeRes();

    mw(req("GET", url), primed.res, () => {});
    primed.res.json({ campaigns: [] });

    const mutating = fakeRes();

    mw(req("POST", "/api/apple-ads/campaigns"), mutating.res, () => {});
    mutating.res.finish(500);

    const after = fakeRes();
    let nextCalls = 0;

    mw(req("GET", url), after.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 0);
    assert.equal(after.state.headers["X-Cache"], "HIT");
  });

  it("passes requests without a user straight through", () => {
    const plain = fakeRes();
    let nextCalls = 0;

    mw(req("GET", "/api/apple-ads/campaigns?case=anon", undefined), plain.res, () => {
      nextCalls++;
    });
    assert.equal(nextCalls, 1);
    assert.equal(plain.state.headers["X-Cache"], undefined);
  });
});
