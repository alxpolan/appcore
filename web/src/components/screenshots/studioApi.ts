export type StudioFontId = "rounded" | "inter" | "baloo";
export type StudioTextPosition = "top" | "bottom";

export interface StudioOverlay {
  id: string;
  url: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

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
  deviceFrame: string;
  overlays: StudioOverlay[];
  rotation: number;
  titleRotation: number;
}

export const STUDIO_GEOMETRY_KEYS = [
  "offsetX",
  "offsetY",
  "titleOffsetX",
  "titleOffsetY",
  "titleScale",
  "deviceScale",
  "titleBoxW",
  "titleBoxH",
  "titleLines",
  "rotation",
  "titleRotation",
] as const;

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
  rotation: 0,
  titleRotation: 0,
};

export const STUDIO_APPLY_GEOMETRY_KEYS: Array<keyof StudioStyle> = STUDIO_GEOMETRY_KEYS.filter(
  (key) => key !== "titleLines",
);

export type StudioLayer = "caption" | "device" | "image" | "background";

export interface StudioBezelOption {
  file: string;
  color: string;
  frameW: number;
  frameH: number;
}

export interface StudioBezelDevice {
  offsetX: number;
  offsetY: number;
  width: number;
  rounded: boolean;
}

export interface StudioBezels {
  current: string | null;
  options: StudioBezelOption[];
  device: StudioBezelDevice | null;
}

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
  defaultRevisionId: string | null;
  presets: StudioPresetInfo[];
  draft: StudioDraft | null;
}

export interface StudioSaveLocale {
  titles: Record<string, string>;
  styles?: Record<string, Partial<StudioStyle>>;
  titleLines?: Record<string, string[]>;
}

export interface StudioDraft {
  style: StudioStyle;
  styles: Record<string, Partial<StudioStyle>>;
  titles: Record<string, Record<string, string>>;
  updatedBy: string | null;
  updatedAt: string;
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
  renameJob: (jobId: string, name: string) =>
    studioRequest<{ jobId: string; commitMessage: string | null }>(`/github/screenshots/studio/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteRevision: (revisionId: string) =>
    studioRequest<{ jobId: string; activeRevisionId: string | null }>(
      `/github/screenshots/studio/revisions/${revisionId}`,
      { method: "DELETE" },
    ),
  setDefaultRevision: (revisionId: string, appId: string) =>
    studioRequest<{ appId: string; revisionId: string }>(
      `/github/screenshots/studio/revisions/${revisionId}/set-default`,
      { method: "POST", body: JSON.stringify({ appId }) },
    ),
  createPreset: (appId: string, payload: { name: string; style: StudioStyle }) =>
    studioRequest<{ preset: StudioPresetInfo }>(`/github/screenshots/presets/${appId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deletePreset: (presetId: string) =>
    studioRequest<{ ok: boolean }>(`/github/screenshots/presets/${presetId}`, { method: "DELETE" }),
  duplicate: (jobId: string) =>
    studioRequest<{ jobId: string }>(`/github/screenshots/studio/${jobId}/duplicate`, { method: "POST" }),
  getBezels: (jobId: string, basename: string) =>
    studioRequest<StudioBezels>(`/github/screenshots/studio/${jobId}/bezels/${encodeURIComponent(basename)}`),
  uploadOverlay: (jobId: string, data: string) =>
    studioRequest<{ overlay: { id: string; url: string } }>(`/github/screenshots/studio/${jobId}/overlays`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
  deleteOverlay: (jobId: string, overlayId: string) =>
    studioRequest<{ ok: boolean }>(`/github/screenshots/studio/${jobId}/overlays/${encodeURIComponent(overlayId)}`, {
      method: "DELETE",
    }),
  duplicateOverlay: (jobId: string, overlayId: string) =>
    studioRequest<{ overlay: { id: string; url: string } }>(
      `/github/screenshots/studio/${jobId}/overlays/${encodeURIComponent(overlayId)}/duplicate`,
      { method: "POST" },
    ),
  saveDraft: (
    jobId: string,
    draft: { style: StudioStyle; styles: Record<string, Partial<StudioStyle>>; titles: Record<string, Record<string, string>> },
  ) =>
    studioRequest<{ draft: StudioDraft }>(`/github/screenshots/studio/${jobId}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),
  deleteDraft: (jobId: string) =>
    studioRequest<{ ok: boolean }>(`/github/screenshots/studio/${jobId}/draft`, { method: "DELETE" }),
};
