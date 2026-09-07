import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Upload, X } from "lucide-react";
import { borderDefault, btnSecondary, textMuted, textPrimary, textSecondary } from "../../styles";
import { useClickOutside } from "../../hooks/useClickOutside";
import { apiPost, getActiveBundleId } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { countryName } from "../../utils/formatters";
import { COUNTRIES, LANGUAGE_BY_COUNTRY } from "./storefronts";

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const langOf = (c: string) => {
  const lang = LANGUAGE_BY_COUNTRY[c] ?? "en";

  try {
    return languageNames.of(lang) ?? lang.toUpperCase();
  } catch {
    return lang.toUpperCase();
  }
};

const parsePastedKeywords = (raw: string): string[] => {
  const headers = new Set(["keyword", "keywords", "term", "phrase", "query"]);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const first = line
      .split(/[\t,;]/)[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!first) continue;

    const lower = first.toLowerCase();
    if (headers.has(lower)) continue;
    if (seen.has(lower)) continue;

    seen.add(lower);
    out.push(first);
  }
  return out;
};

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCountry: string;
  onImported: (count: number) => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  remaining: number | null;
  limit: number;
}

export default function ImportKeywordsModal({
  open,
  onClose,
  defaultCountry,
  onImported,
  addToast,
  remaining,
  limit,
}: Props) {
  const { canWrite } = usePermissions();
  const [text, setText] = useState("");
  const [country, setCountry] = useState(defaultCountry || "de");
  const [marketOpen, setMarketOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const marketRef = useRef<HTMLDivElement>(null);

  useClickOutside(
    marketRef,
    useCallback(() => setMarketOpen(false), []),
  );

  useEffect(() => {
    if (open) {
      setCountry(defaultCountry || "de");
      setText("");
    }
  }, [open, defaultCountry]);

  const parsed = useMemo(() => parsePastedKeywords(text), [text]);

  const submit = async () => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return;
    }

    if (parsed.length === 0) return;

    if (remaining !== null && remaining <= 0) {
      addToast(`Free plan is limited to ${limit} keywords per app. Upgrade to Pro to import more.`, "error");
      return;
    }
    const toImport = remaining !== null ? parsed.slice(0, remaining) : parsed;
    const skipped = parsed.length - toImport.length;

    setImporting(true);

    const c = COUNTRIES.find((x) => x.code === country) ?? COUNTRIES[0];
    const results = await Promise.allSettled(
      toImport.map((term) =>
        apiPost("/keywords", {
          term,
          country: c.code,
          language: c.lang,
          bundleId: getActiveBundleId(),
        }),
      ),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;

    setImporting(false);
    if (ok > 0) {
      const skipNote = skipped > 0 ? `, ${skipped} skipped (Free plan limit)` : "";
      addToast(
        failed === 0
          ? `${ok} keyword${ok === 1 ? "" : "s"} imported (${c.code.toUpperCase()})${skipNote}`
          : `${ok} imported, ${failed} failed (${c.code.toUpperCase()})${skipNote}`,
        failed === 0 && skipped === 0 ? "success" : "info",
      );
      onImported(ok);
      onClose();
    } else {
      addToast("Import failed. None of the keywords could be added.", "error");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]`}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className={`text-base font-semibold ${textPrimary}`}>Import keywords</h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              Paste keywords from AppFollow, Sensor Tower, AppRadar, or any CSV export. One per line or
              comma/tab-separated.
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {remaining !== null && (
          <div
            className={`mx-5 mb-2 px-3 py-2 rounded-lg text-[12px] ${remaining <= 0
                ? "bg-[#595DD2]/10 text-[#595DD2]"
                : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
          >
            Free plan: {remaining} of {limit} keyword slots left for this app. Extra keywords beyond the limit are
            skipped. Upgrade to Pro for unlimited tracking.
          </div>
        )}

        <div className="px-5 pb-3 flex-1 overflow-auto">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "fitness tracker\nhome workout\nweight lifting app\n\n# Or paste your CSV — first column is used"
            }
            className={`w-full h-48 px-3.5 py-2.5 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-[13px] ${textPrimary} outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:focus:border-blue-400 placeholder:text-[#9ca3af] dark:placeholder:text-[#5c6478] font-mono resize-none`}
          />
          <div className={`mt-2 text-[11px] ${textSecondary}`}>
            {parsed.length === 0 ? (
              <span className={textMuted}>No keywords detected yet</span>
            ) : (
              <>
                <span className="font-semibold">{parsed.length}</span> keyword{parsed.length === 1 ? "" : "s"} detected
                {parsed.length > 0 && (
                  <span className={textMuted}>
                    {" · "}
                    {parsed.slice(0, 4).join(", ")}
                    {parsed.length > 4 ? `, +${parsed.length - 4} more` : ""}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className={`flex items-center justify-between gap-3 px-5 py-3 border-t ${borderDefault}`}>
          <div ref={marketRef} className="relative">
            <button
              onClick={() => setMarketOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full border ${borderDefault} bg-white dark:bg-[#1c2028] text-[12px] font-medium ${textPrimary} hover:border-gray-300 dark:hover:border-[#3a4050] transition-colors`}
            >
              <img
                src={`/country-flags/${country.toLowerCase()}.svg`}
                alt={country}
                className="w-3.5 h-2.5 rounded-xs object-cover shrink-0"
              />
              <span>
                {countryName(country)} <span className={textMuted}>·</span> {langOf(country)}
              </span>
            </button>
            {marketOpen && (
              <div
                className={`absolute left-0 bottom-full mb-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[220px] max-h-[260px] overflow-auto`}
              >
                {COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => {
                      setCountry(c.code);
                      setMarketOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left ${country === c.code ? "font-semibold" : ""
                      }`}
                  >
                    <img
                      src={`/country-flags/${c.code.toLowerCase()}.svg`}
                      alt={c.code}
                      className="w-4 h-3 rounded-xs object-cover shrink-0"
                    />
                    <span className="truncate">
                      {countryName(c.code)} <span className={textMuted}>·</span> {langOf(c.code)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={importing || parsed.length === 0 || !canWrite}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium border-[#595DD2] bg-[#595DD2] text-white hover:border-[#484CBE] hover:bg-[#484CBE] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <div className="spinner !w-3.5 !h-3.5" /> Importing…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" /> Import {parsed.length > 0 ? `(${parsed.length})` : ""}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
