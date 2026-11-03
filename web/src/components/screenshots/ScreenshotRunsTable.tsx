import { useState } from "react";
import { ChevronUp, ChevronDown, Archive, ArchiveRestore, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { TD, TH, borderDefault, btnSecSm, textMuted, textPrimary, textSecondary } from "../../styles";
import { apiPatch } from "../../hooks/useApi";
import type { FramedJob } from "../../utils/screenshotUtils";

type SortKey = "date" | "screenshots" | "locales";

interface Props {
  jobs: FramedJob[];
  archived: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  onChanged: () => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`inline-flex flex-col ml-1 leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`w-4 h-4 -mb-1.5 ${active && dir === "asc" ? "text-[#595DD2]" : "text-current"}`} />
      <ChevronDown className={`w-4 h-4 -mt-1 ${active && dir === "desc" ? "text-[#595DD2]" : "text-current"}`} />
    </span>
  );
}

function screenshotCount(job: FramedJob): number {
  return Object.values(job.framedByLocale).reduce((sum, urls) => sum + urls.length, 0);
}

function firstThumb(job: FramedJob): string | null {
  for (const urls of Object.values(job.framedByLocale)) {
    if (urls.length > 0) return urls[0];
  }

  return null;
}

function RunRow({
  job,
  isLatest,
  archived,
  addToast,
  onChanged,
}: {
  job: FramedJob;
  isLatest: boolean;
  archived: boolean;
  addToast: Props["addToast"];
  onChanged: () => void;
}) {
  const [archiving, setArchiving] = useState(false);
  const thumb = firstThumb(job);
  const localeCount = Object.keys(job.framedByLocale).length;

  const handleToggleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setArchiving(true);

    try {
      await apiPatch(`/github/screenshots/framed/${job.id}/archive`, { archived: !archived });
      addToast(archived ? "Run unarchived" : "Run archived", "success");
      onChanged();
    } catch (err: any) {
      addToast(`Failed to update: ${err.message}`, "error");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <tr className="hover:bg-gray-50/60 dark:hover:bg-white/[0.03]">
      <td className={`${TD} !py-1.5`}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-16 w-auto max-w-[56px] rounded-lg border border-[#eef0f3] dark:border-[#2a2f3d] object-contain shrink-0"
          />
        ) : (
          <span className="h-16 w-10 rounded-lg bg-[#f3f4f6] dark:bg-[#252b38] block shrink-0" />
        )}
      </td>
      <td className={TD}>
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className={`block font-medium ${textPrimary} truncate`} title={job.commitMessage ?? job.commitSha}>
            {job.commitMessage || job.commitSha.slice(0, 7)}
          </span>
          {isLatest && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              Latest
            </span>
          )}
        </span>
        <span className={`block text-[11px] ${textMuted} font-mono truncate`}>
          {job.commitSha.slice(0, 7)}
          {job.branch ? ` · ${job.branch}` : ""}
        </span>
      </td>
      <td className={`${TD} ${textSecondary} tabular-nums`}>{localeCount}</td>
      <td className={`${TD} ${textSecondary} tabular-nums`}>{screenshotCount(job)}</td>
      <td className={`${TD} ${textSecondary}`}>{new Date(job.createdAt).toLocaleDateString()}</td>
      <td className={`${TD} text-right`}>
        <span className="inline-flex items-center gap-1.5 justify-end">
          <Link to={`/screenshots/studio/${job.id}`} className={btnSecSm} onClick={(e) => e.stopPropagation()}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Studio
          </Link>
          <button
            type="button"
            onClick={handleToggleArchive}
            disabled={archiving}
            title={archived ? "Unarchive" : "Archive"}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-300 dark:text-[#5c6478] hover:text-[#595DD2] hover:bg-[#595DD2]/10 transition-colors disabled:opacity-50"
          >
            {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
        </span>
      </td>
    </tr>
  );
}

export default function ScreenshotRunsTable({ jobs, archived, addToast, onChanged }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const sorted = [...jobs].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;

    if (sortBy === "date") return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    if (sortBy === "locales") return (Object.keys(a.framedByLocale).length - Object.keys(b.framedByLocale).length) * dir;

    return (screenshotCount(a) - screenshotCount(b)) * dir;
  });

  const col = (key: SortKey, label: string) => (
    <th
      className={`${TH} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={sortBy === key} dir={sortDir} />
      </span>
    </th>
  );

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}></th>
            <th className={TH}>Run</th>
            {col("locales", "Locales")}
            {col("screenshots", "Screenshots")}
            {col("date", "Date")}
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((job, index) => (
            <RunRow
              key={job.id}
              job={job}
              isLatest={index === 0 && !archived}
              archived={archived}
              addToast={addToast}
              onChanged={onChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
