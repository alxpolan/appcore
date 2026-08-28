import { Readable } from "stream";

type FetchBody = NonNullable<Parameters<typeof fetch>[1]>["body"];

export type ResponseType = "json" | "text" | "arraybuffer" | "stream";

export interface RequestConfig {
  baseURL?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string | number | undefined>;
  params?: Record<string, unknown>;
  data?: unknown;
  timeout?: number;
  headersTimeout?: number;
  responseType?: ResponseType;
  validateStatus?: ((status: number) => boolean) | null;
  maxBodyLength?: number;
  maxContentLength?: number;
  signal?: AbortSignal;
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: RequestConfig;
}

export interface HttpError<T = any> extends Error {
  response?: HttpResponse<T>;
  config?: RequestConfig;
  code?: string;
  isHttpError: true;
}

export type ResolvedRequestConfig = RequestConfig & {
  headers: Record<string, string | number | undefined>;
};

type RequestInterceptor = (config: ResolvedRequestConfig) => ResolvedRequestConfig | Promise<ResolvedRequestConfig>;
type ResponseFulfilled<T> = (response: HttpResponse<T>) => HttpResponse<T> | Promise<HttpResponse<T>>;
type ResponseRejected = (error: any) => any;

class InterceptorManager {
  private handlers: RequestInterceptor[] = [];

  use(fn: RequestInterceptor): number {
    this.handlers.push(fn);
    return this.handlers.length - 1;
  }

  async run(config: ResolvedRequestConfig): Promise<ResolvedRequestConfig> {
    let cfg = config;
    for (const h of this.handlers) cfg = await h(cfg);
    return cfg;
  }
}

class ResponseInterceptorManager {
  private handlers: { fulfilled: ResponseFulfilled<any>; rejected: ResponseRejected }[] = [];

  use(fulfilled: ResponseFulfilled<any>, rejected: ResponseRejected): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  async runFulfilled<T>(response: HttpResponse<T>): Promise<HttpResponse<T>> {
    let res: HttpResponse<T> = response;
    for (const h of this.handlers) res = await h.fulfilled(res);
    return res;
  }

  async runRejected(error: any): Promise<never> {
    let err = error;
    for (const h of this.handlers) {
      try {
        err = await h.rejected(err);
      } catch (e) {
        err = e;
      }
    }
    throw err;
  }
}

function buildUrl(baseURL: string | undefined, url: string, params?: Record<string, unknown>): string {
  let full: string;
  if (/^https?:\/\//i.test(url)) {
    full = url;
  } else if (baseURL) {
    const base = baseURL.replace(/\/+$/, "");
    const path = url.startsWith("/") ? url : `/${url}`;
    full = base + path;
  } else {
    full = url;
  }

  if (params && Object.keys(params).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) sp.append(k, String(item));
      } else {
        sp.append(k, String(v));
      }
    }
    const q = sp.toString();
    if (q) full += (full.includes("?") ? "&" : "?") + q;
  }
  return full;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === target) return headers[k];
  return undefined;
}

function prepareBody(data: unknown, headers: Record<string, string>): FetchBody | undefined {
  if (data === undefined || data === null) return undefined;
  if (data instanceof URLSearchParams) {
    if (!findHeader(headers, "content-type")) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    return data;
  }
  if (Buffer.isBuffer(data)) return data as unknown as FetchBody;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data as FetchBody;
  if (typeof data === "string") return data;
  if (!findHeader(headers, "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  return JSON.stringify(data);
}

// Agents own a connection pool, so they must be reused across requests rather than
// created per call. Keyed by timeout pair; the promise is cached so concurrent
// callers share one agent instead of racing to build duplicates.
const agentCache = new Map<string, Promise<unknown>>();

function getAgent(headersTimeout: number, bodyTimeout: number): Promise<unknown> {
  const key = `${headersTimeout}:${bodyTimeout}`;
  let agent = agentCache.get(key);
  if (!agent) {
    agent = import("undici").then(({ Agent }) => new Agent({ headersTimeout, bodyTimeout }));
    agentCache.set(key, agent);
  }
  return agent;
}

async function dispatch<T>(config: RequestConfig): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(config.headers ?? {})) {
    if (v !== undefined && v !== null) headers[k] = String(v);
  }

  const method = (config.method ?? "GET").toUpperCase();
  const url = buildUrl(config.baseURL, config.url ?? "", config.params);
  const body = method === "GET" || method === "HEAD" ? undefined : prepareBody(config.data, headers);

  let signal = config.signal;
  let timeoutId: NodeJS.Timeout | undefined;
  if (config.timeout && config.timeout > 0) {
    const ctrl = new AbortController();
    timeoutId = setTimeout(() => ctrl.abort(), config.timeout);
    if (signal) signal.addEventListener("abort", () => ctrl.abort());
    signal = ctrl.signal;
  }

  let fetchInit: Record<string, unknown> = { method, headers, body: body as FetchBody | undefined, signal };
  if (config.headersTimeout !== undefined) {
    (fetchInit as any).dispatcher = await getAgent(config.headersTimeout, config.timeout ?? 0);
  }

  let res: Response;
  try {
    res = await fetch(url, fetchInit as RequestInit);
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const e = err as Error & { name?: string };
    if (e?.name === "AbortError" && config.timeout && config.timeout > 0) {
      const httpErr = new Error(`timeout of ${config.timeout}ms exceeded`) as HttpError;
      httpErr.code = "ECONNABORTED";
      httpErr.config = config;
      httpErr.isHttpError = true;
      throw httpErr;
    }
    throw err;
  }
  if (timeoutId) clearTimeout(timeoutId);

  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });

  const responseType: ResponseType = config.responseType ?? "json";
  let data: unknown;

  if (responseType === "stream") {
    data = res.body ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]) : null;
  } else if (responseType === "arraybuffer") {
    const ab = await res.arrayBuffer();
    data = Buffer.from(ab);
  } else if (responseType === "text") {
    data = await res.text();
  } else {
    const text = await res.text();
    if (!text) {
      data = null;
    } else {
      const ct = (respHeaders["content-type"] ?? "").toLowerCase();
      if (ct.includes("application/json") || ct.includes("+json")) {
        data = JSON.parse(text);
      } else {
        const trimmed = text.trimStart();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      }
    }
  }

  const response: HttpResponse<T> = {
    data: data as T,
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    config,
  };

  const validate = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (validate && !validate(res.status)) {
    const err = new Error(`Request failed with status code ${res.status}`) as HttpError;
    err.response = response;
    err.config = config;
    err.isHttpError = true;
    throw err;
  }

  return response;
}

export class HttpClient {
  defaults: RequestConfig;
  interceptors = {
    request: new InterceptorManager(),
    response: new ResponseInterceptorManager(),
  };

  constructor(defaults: RequestConfig = {}) {
    this.defaults = defaults;
  }

  async request<T = any>(config: RequestConfig): Promise<HttpResponse<T>> {
    const merged: ResolvedRequestConfig = {
      ...this.defaults,
      ...config,
      headers: { ...(this.defaults.headers ?? {}), ...(config.headers ?? {}) },
    };
    const final = await this.interceptors.request.run(merged);
    try {
      const response = await dispatch<T>(final);
      return this.interceptors.response.runFulfilled(response);
    } catch (err) {
      return this.interceptors.response.runRejected(err);
    }
  }

  get<T = any>(url: string, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "GET", url });
  }
  delete<T = any>(url: string, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "DELETE", url });
  }
  head<T = any>(url: string, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "HEAD", url });
  }
  post<T = any>(url: string, data?: unknown, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "POST", url, data });
  }
  put<T = any>(url: string, data?: unknown, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "PUT", url, data });
  }
  patch<T = any>(url: string, data?: unknown, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: "PATCH", url, data });
  }
}

export type AxiosInstance = HttpClient;

interface DefaultClient extends HttpClient {
  create(config?: RequestConfig): HttpClient;
}

const defaultClient = new HttpClient() as DefaultClient;
defaultClient.create = (config: RequestConfig = {}) => new HttpClient(config);

export default defaultClient;
