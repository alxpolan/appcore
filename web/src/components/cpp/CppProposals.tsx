import { useCallback, useEffect, useState } from "react";
import { cppApi, cppStatusLabel, isCppStuck, type CppProgressEvent, type CppProposal } from "./cppApi";

interface CppProposalsProps {
  campaignId: string;
  canWrite: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percent(value: number | null): string {
  if (value == null) return "—";

  return `${(value * 100).toFixed(1)}%`;
}

function statusBadge(status: CppProposal["status"]): string {
  switch (status) {
    case "ready":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "applied":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "rendering":
    case "applying":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse";
    case "failed":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  }
}

export default function CppProposals({ campaignId, canWrite, addToast }: CppProposalsProps) {
  const [proposals, setProposals] = useState<CppProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState<Record<string, CppProgressEvent | null>>({});
  const [shotLocale, setShotLocale] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await cppApi.list(campaignId);
      setProposals(res.proposals);
    } catch (err: any) {
      addToast(`Proposals failed: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [campaignId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const patchProposal = (id: string, next: CppProposal) => {
    setProposals((current) => current.map((proposal) => (proposal.id === id ? next : proposal)));
  };

  const handleGenerate = async () => {
    setGenerating(true);

    try {
      const res = await cppApi.generate(campaignId);
      setProposals(res.proposals);
      addToast(`Found ${res.proposals.length} keyword groups`, "success");
    } catch (err: any) {
      addToast(`Generate failed: ${err.message}`, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRender = async (id: string) => {
    setBusy((current) => ({ ...current, [id]: "render" }));
    setProgress((current) => ({ ...current, [id]: { done: 0, total: 0, locale: null, basenames: [] } }));

    try {
      const res = await cppApi.renderStream(id, (event) => {
        setProgress((current) => ({ ...current, [id]: event }));
      });
      patchProposal(id, res.proposal);
      addToast(`Screenshots ready for ${res.proposal.label}`, "success");
    } catch (err: any) {
      addToast(`Render failed: ${err.message}`, "error");
      load();
    } finally {
      setBusy((current) => ({ ...current, [id]: null }));
      setProgress((current) => ({ ...current, [id]: null }));
    }
  };

  const handleApply = async (proposal: CppProposal) => {
    if (!confirm(`Create "${proposal.label}" product page and submit for review?`)) return;

    setBusy((current) => ({ ...current, [proposal.id]: "apply" }));

    try {
      const res = await cppApi.apply(proposal.id);
      patchProposal(proposal.id, res.proposal);
      addToast(`Product page submitted for ${proposal.label}`, "success");
    } catch (err: any) {
      addToast(`Apply failed: ${err.message}`, "error");
      load();
    } finally {
      setBusy((current) => ({ ...current, [proposal.id]: null }));
    }
  };

  const handleDelete = async (proposal: CppProposal) => {
    if (!confirm(`Delete proposal "${proposal.label}"?`)) return;

    try {
      await cppApi.remove(proposal.id);
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      addToast("Proposal deleted", "success");
    } catch (err: any) {
      addToast(`Delete failed: ${err.message}`, "error");
    }
  };

  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white dark:bg-[#1c212d] dark:border-[#2a2f3d] shadow-sm mt-6">
      <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
        <div>
          <div className="text-[16px] font-semibold text-gray-900 dark:text-white">Product Page Proposals</div>
          <div className="text-[12px] text-gray-500 dark:text-gray-400">
            Top keywords by spend, grouped into themes with matching screenshots
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={!canWrite || generating}
          className="px-4 py-2 text-[13px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? "Analyzing…" : "Generate proposals"}
        </button>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="py-6 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</div>
        ) : proposals.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-gray-500 dark:text-gray-400">
            No proposals yet — generate them from the last 30 days of keywords
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {proposals.map((proposal) => {
              const totals = proposal.totals;
              const event = progress[proposal.id];
              const pct = event && event.total > 0 ? Math.round((event.done / event.total) * 100) : 0;
              const framed = proposal.screenshotJob?.framedByLocale ?? {};
              const locales = Object.keys(framed).filter((locale) => (framed[locale]?.length ?? 0) > 0);
              const activeLocale = shotLocale[proposal.id] ?? locales[0] ?? proposal.locales[0];
              const shots = activeLocale ? (framed[activeLocale] ?? []) : [];
              const captionLocales = Object.keys(proposal.captions ?? {});
              const firstCaptions = captionLocales.length > 0 ? Object.values(proposal.captions[captionLocales[0]]) : [];

              return (
                <div
                  key={proposal.id}
                  className="rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] font-semibold text-gray-900 dark:text-white">{proposal.label}</div>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${statusBadge(proposal.status)}`}>
                      {cppStatusLabel(proposal.status)}
                    </span>
                  </div>
                  {totals && (
                    <div className="flex gap-4 text-[12px] text-gray-500 dark:text-gray-400">
                      <span>
                        Spend <span className="font-semibold text-gray-900 dark:text-white">{money(totals.spend)}</span>
                      </span>
                      <span>
                        Taps <span className="font-semibold text-gray-900 dark:text-white">{totals.taps}</span>
                      </span>
                      <span>
                        CR <span className="font-semibold text-gray-900 dark:text-white">{percent(totals.conversionRate)}</span>
                      </span>
                    </div>
                  )}
                  <div className="text-[12px] text-gray-500 dark:text-gray-400">
                    {proposal.keywords
                      .slice(0, 4)
                      .map((item) => item.term)
                      .join(" · ")}
                    {proposal.keywords.length > 4 && ` · +${proposal.keywords.length - 4} more`}
                  </div>
                  {proposal.locales.length > 0 && (
                    <div className="text-[12px] text-gray-500 dark:text-gray-400">
                      <span className="font-medium">Locales: </span>
                      {proposal.locales.join(", ")}
                    </div>
                  )}
                  {firstCaptions.length > 0 && (
                    <div className="text-[12px] text-gray-500 dark:text-gray-400">
                      <span className="font-medium">Captions ({captionLocales.length} locales): </span>
                      {firstCaptions.slice(0, 2).join(" / ")}
                      {firstCaptions.length > 2 && " …"}
                    </div>
                  )}
                  {shots.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {locales.length > 1 && (
                        <select
                          value={activeLocale}
                          onChange={(e) => setShotLocale((current) => ({ ...current, [proposal.id]: e.target.value }))}
                          className="w-40 text-[12px] rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] bg-white dark:bg-[#252b38] text-gray-900 dark:text-white px-2 py-1"
                        >
                          {locales.map((locale) => (
                            <option key={locale} value={locale}>
                              {locale}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {shots.map((url) => (
                          <img
                            key={url}
                            src={url}
                            alt={`${proposal.label} screenshot`}
                            className="h-40 rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] object-cover"
                            loading="lazy"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {proposal.error && <div className="text-[12px] text-red-600 dark:text-red-400">{proposal.error}</div>}
                  {proposal.cppUrl && (
                    <a
                      href={proposal.cppUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View product page
                    </a>
                  )}
                  {event && event.total > 0 && (
                    <div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        Rendering {event.locale ?? "…"} · {event.done}/{event.total}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 mt-auto pt-1">
                    {(proposal.status === "draft" ||
                      proposal.status === "failed" ||
                      proposal.status === "ready" ||
                      (isCppStuck(proposal) && proposal.status === "rendering")) && (
                      <button
                        onClick={() => handleRender(proposal.id)}
                        disabled={!canWrite || !!busy[proposal.id]}
                        className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busy[proposal.id] === "render"
                          ? "Rendering…"
                          : proposal.status === "ready"
                            ? "Re-render"
                            : isCppStuck(proposal)
                              ? "Retry render"
                              : "Render screenshots"}
                      </button>
                    )}
                    {((proposal.status === "ready" || proposal.status === "failed") ||
                      (isCppStuck(proposal) && proposal.status === "applying")) &&
                      proposal.screenshotJobId && (
                      <button
                        onClick={() => handleApply(proposal)}
                        disabled={!canWrite || !!busy[proposal.id]}
                        className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy[proposal.id] === "apply" ? "Applying…" : "Create page"}
                      </button>
                    )}
                    {proposal.status !== "applied" && proposal.status !== "rendering" && proposal.status !== "applying" && (
                      <button
                        onClick={() => handleDelete(proposal)}
                        disabled={!canWrite || !!busy[proposal.id]}
                        className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#252b38] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
