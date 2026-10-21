export type CppProposalStatus = "draft" | "rendering" | "ready" | "applying" | "applied" | "failed";

export interface CppProposalKeyword {
  term: string;
  keyword: string | null;
  matchType: string | null;
  adGroupId: string;
  adGroupName: string | null;
  spend: number;
  taps: number;
  installs: number;
}

export interface CppProposalTotals {
  spend: number;
  taps: number;
  installs: number;
  conversionRate: number | null;
  coverage: number;
}

export interface CppProposalJob {
  id: string;
  commitSha: string | null;
  status: string;
  framedByLocale: Record<string, string[]>;
}

export interface CppProposal {
  id: string;
  appId: string;
  campaignId: string;
  campaignName: string | null;
  groupKey: string;
  label: string;
  status: CppProposalStatus;
  keywords: CppProposalKeyword[];
  totals: CppProposalTotals | null;
  captions: Record<string, Record<string, string>>;
  locales: string[];
  sourceJobId: string | null;
  screenshotJobId: string | null;
  cppPageId: string | null;
  cppVersionId: string | null;
  cppUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  screenshotJob: CppProposalJob | null;
}

export interface CppProgressEvent {
  done: number;
  total: number;
  locale: string | null;
  basenames: string[];
}

async function cppRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/cpp-proposals${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;

  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return body as T;
}

export const cppApi = {
  list: (campaignId: string) =>
    cppRequest<{ proposals: CppProposal[] }>(`?campaignId=${encodeURIComponent(campaignId)}`),
  generate: (campaignId: string, days = 30) =>
    cppRequest<{ proposals: CppProposal[] }>("/generate", {
      method: "POST",
      body: JSON.stringify({ campaignId, days }),
    }),
  renderStream: async (
    id: string,
    onEvent: (event: CppProgressEvent) => void,
  ): Promise<{ proposal: CppProposal }> => {
    const res = await fetch(`/api/cpp-proposals/${id}/render/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
          | { result: { proposal: CppProposal } }
          | CppProgressEvent;

        if ("heartbeat" in msg) continue;
        if ("error" in msg) throw new Error(msg.error);
        if ("result" in msg) return msg.result;

        onEvent(msg);
      }
    }

    throw new Error("Render stream ended without result");
  },
  apply: (id: string) => cppRequest<{ proposal: CppProposal }>(`/${id}/apply`, { method: "POST" }),
  remove: (id: string) => cppRequest<{ ok: boolean }>(`/${id}`, { method: "DELETE" }),
};

export function isCppStuck(proposal: CppProposal): boolean {
  if (proposal.status !== "rendering" && proposal.status !== "applying") return false;

  return Date.now() - new Date(proposal.updatedAt).getTime() > 60 * 60 * 1000;
}

export function cppStatusLabel(status: CppProposalStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "rendering":
      return "Rendering";
    case "ready":
      return "Ready";
    case "applying":
      return "Applying";
    case "applied":
      return "Applied";
    case "failed":
      return "Failed";
  }
}
