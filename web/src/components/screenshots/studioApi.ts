export type StudioFontId = "rounded" | "inter" | "baloo";
export type StudioTextPosition = "top" | "bottom";

export interface StudioStyle {
  bgColor1: string;
  bgColor2: string;
  textColor: string;
  font: StudioFontId;
  textPosition: StudioTextPosition;
  offsetX: number;
  offsetY: number;
  titleOffsetX: number;
  titleOffsetY: number;
  titleScale: number;
  deviceScale: number;
  titleBoxW: number;
  titleBoxH: number;
  titleLines: string[];
}

export const STUDIO_GEOMETRY_KEYS: Array<keyof StudioStyle> = [
  "offsetX",
  "offsetY",
  "titleOffsetX",
  "titleOffsetY",
  "titleScale",
  "deviceScale",
  "titleBoxW",
  "titleBoxH",
  "titleLines",
];

export const DEFAULT_STUDIO_GEOMETRY: Pick<StudioStyle, (typeof STUDIO_GEOMETRY_KEYS)[number]> = {
  offsetX: 0,
  offsetY: 0,
  titleOffsetX: 0,
  titleOffsetY: 0,
  titleScale: 1,
  deviceScale: 1,
  titleBoxW: 0,
  titleBoxH: 0,
  titleLines: [],
};

export type StudioLayer = "caption" | "device" | "background";

export interface StudioItem {
  basename: string;
  url: string;
  rawUrl: string | null;
  deviceLabel: string;
  descKey: string | null;
  title: string;
  hasRaw: boolean;
}

export interface StudioLocaleData {
  locale: string;
  items: StudioItem[];
}

export interface StudioRevisionInfo {
  id: string;
  rev: number;
  name: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface StudioPresetInfo extends StudioStyle {
  id: string;
  name: string;
  updatedAt: string;
}

export interface StudioData {
  job: {
    id: string;
    appId: string;
    commitSha: string;
    commitMessage: string | null;
    branch: string | null;
    createdAt: string;
  };
  style: StudioStyle;
  styles: Record<string, Partial<StudioStyle>>;
  locales: StudioLocaleData[];
  revisions: StudioRevisionInfo[];
  activeRevisionId: string | null;
  presets: StudioPresetInfo[];
}

export interface StudioSaveLocale {
  titles: Record<string, string>;
  styles?: Record<string, Partial<StudioStyle>>;
}

export interface StudioSaveResponse {
  revision: StudioRevisionInfo;
  modes: { worker: number };
  skipped: string[];
  jobId: string;
}

export interface StudioProgressEvent {
  done: number;
  total: number;
  locale: string | null;
  basenames: string[];
}

export function revisionLabel(rev: { rev: number; name: string | null }): string {
  if (rev.name) return rev.name;
  if (rev.rev === 0) return "Original";

  return `Rev ${rev.rev}`;
}

async function studioRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;

  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return body as T;
}

export const studioApi = {
  getData: (jobId: string) => studioRequest<StudioData>(`/github/screenshots/studio/${jobId}`),
  saveRevisionStream: async (
    jobId: string,
    payload: { name?: string; style: StudioStyle; locales: Record<string, StudioSaveLocale> },
    onEvent: (event: StudioProgressEvent) => void,
  ): Promise<StudioSaveResponse> => {
    const res = await fetch(`/api/github/screenshots/studio/${jobId}/revisions/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      throw new Error(body.error ?? `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const msg = JSON.parse(line) as
          | { heartbeat: boolean }
          | { error: string }
          | { result: StudioSaveResponse }
          | StudioProgressEvent;

        if ("heartbeat" in msg) continue;
        if ("error" in msg) throw new Error(msg.error);
        if ("result" in msg) return msg.result;

        onEvent(msg);
      }
    }

    throw new Error("Render stream ended early");
  },
  saveRevision: (
    jobId: string,
    payload: { name?: string; style: StudioStyle; locales: Record<string, StudioSaveLocale> },
  ) =>
    studioRequest<StudioSaveResponse>(`/github/screenshots/studio/${jobId}/revisions`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  activateRevision: (jobId: string, revisionId: string) =>
    studioRequest<{ ok: boolean }>(`/github/screenshots/studio/${jobId}/active-revision`, {
      method: "PATCH",
      body: JSON.stringify({ revisionId }),
    }),
  deleteRevision: (revisionId: string) =>
    studioRequest<{ jobId: string; activeRevisionId: string | null }>(
      `/github/screenshots/studio/revisions/${revisionId}`,
      { method: "DELETE" },
    ),
  createPreset: (appId: string, payload: { name: string; style: StudioStyle }) =>
    studioRequest<{ preset: StudioPresetInfo }>(`/github/screenshots/presets/${appId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deletePreset: (presetId: string) =>
    studioRequest<{ ok: boolean }>(`/github/screenshots/presets/${presetId}`, { method: "DELETE" }),
};
