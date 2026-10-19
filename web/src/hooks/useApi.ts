import { useState, useEffect, useCallback, useRef } from "react";
const BASE = "/api";

export const ACTIVE_BUNDLE_KEY = "appcore_active_bundle";
export const getActiveBundleId = () => localStorage.getItem(ACTIVE_BUNDLE_KEY);
export const setActiveBundleId = (bundleId: string | null) => {
  if (bundleId) localStorage.setItem(ACTIVE_BUNDLE_KEY, bundleId);
  else localStorage.removeItem(ACTIVE_BUNDLE_KEY);
  window.dispatchEvent(new Event("app-changed"));
};

export function authHeaders(): HeadersInit {
  return {};
}

type ApiQuery = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: ApiQuery): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const bundleId = getActiveBundleId();
  if (bundleId) url.searchParams.set("bundleId", bundleId);
  return url.toString().replace(window.location.origin, "");
}

const apiCache = new Map<string, any>();
const apiPreloading = new Map<string, Promise<void>>();

export function clearApiCache() {
  apiCache.clear();
  apiPreloading.clear();
}

export function preloadApi(path: string, skipBundleId = false): Promise<void> {
  const url = skipBundleId ? `${BASE}${path}` : buildUrl(path);
  if (apiCache.has(url)) return Promise.resolve();
  if (apiPreloading.has(url)) return apiPreloading.get(url)!;
  const promise = fetch(url, { credentials: "include", headers: authHeaders() })
    .then((r) => {
      if (!r.ok) return;
      return r.json().then((d) => {
        apiCache.set(url, d);
      });
    })
    .catch(() => {})
    .finally(() => {
      apiPreloading.delete(url);
    });
  apiPreloading.set(url, promise);
  return promise;
}

export function useApi<T>(path: string, deps: any[] = [], skipBundleId = false) {
  const getUrl = () => (skipBundleId ? `${BASE}${path}` : buildUrl(path));

  const [data, setData] = useState<T | null>(() => apiCache.get(getUrl()) ?? null);
  const [loading, setLoading] = useState(() => !apiCache.has(getUrl()));
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const refetch = useCallback(() => {
    const url = getUrl();
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fetch(url, { credentials: "include", headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        apiCache.set(url, d);
        if (reqId !== reqIdRef.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (reqId !== reqIdRef.current) return;
        setError(e.message);
        setLoading(false);
      });
  }, [path, skipBundleId, ...deps]);

  useEffect(() => {
    const url = getUrl();
    const applyFromCache = () => {
      const c = apiCache.get(url);
      if (!c) return false;
      reqIdRef.current++;
      setData(c as T);
      setLoading(false);
      return true;
    };
    const pending = apiPreloading.get(url);
    if (pending) {
      pending.then(() => {
        if (!applyFromCache()) refetch();
      });
    } else {
      if (!applyFromCache()) refetch();
    }
  }, [refetch]);

  useEffect(() => {
    const handler = () => {
      setData(null);
      setLoading(true);
      refetch();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [refetch]);

  return { data, loading, error, refetch };
}

export async function apiGet<T = any>(path: string, query?: ApiQuery): Promise<T> {
  const res = await fetch(buildUrl(path, query), { credentials: "include", headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = void>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json", ...authHeaders() } : authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json().catch(() => undefined) as Promise<T>;
}
