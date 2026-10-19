import { History, Save, Trash2, X } from "lucide-react";
import { borderDefault, btnPrimary, cardCls, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import { getLocaleName } from "../../utils/localeUtils";
import { revisionLabel, type StudioProgressEvent, type StudioRevisionInfo } from "./studioApi";

interface Props {
  disabled: boolean;
  revisions: StudioRevisionInfo[];
  activeRevisionId: string | null;
  activatingId: string | null;
  onActivate: (revisionId: string) => void;
  deletingId: string | null;
  onDelete: (revision: StudioRevisionInfo) => void;
  dirty: boolean;
  scope: "one" | "all";
  onScopeChange: (scope: "one" | "all") => void;
  activeLocaleName: string;
  localeCount: number;
  revName: string;
  onRevNameChange: (name: string) => void;
  onSave: () => void;
  saving: boolean;
  progress: StudioProgressEvent | null;
}

export default function StudioRevisions({
  disabled,
  revisions,
  activeRevisionId,
  activatingId,
  onActivate,
  deletingId,
  onDelete,
  dirty,
  scope,
  onScopeChange,
  activeLocaleName,
  localeCount,
  revName,
  onRevNameChange,
  onSave,
  saving,
  progress,
}: Props) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const current =
    progress && progress.basenames.length > 0
      ? ` · ${progress.basenames[0].replace(/\.png$/i, "")}${progress.basenames.length > 1 ? ` +${progress.basenames.length - 1}` : ""}`
      : "";

  return (
    <div className={`${cardCls} !p-4 flex flex-col gap-3`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${textSecondary} mr-1`}>
          <History className="w-3.5 h-3.5" />
          Revisions
        </span>
        {revisions.length === 0 && (
          <span className={`text-[12px] ${textMuted}`}>No edits yet, the originals are active.</span>
        )}
        {revisions.map((rev) => {
          const active = rev.id === activeRevisionId;

          return (
            <span
              key={rev.id}
              className={`inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border text-[12px] font-medium transition-all ${
                active
                  ? "border-[#595DD2] bg-[#595DD2]/5 text-[#595DD2]"
                  : `${borderDefault} ${textSecondary}`
              }`}
            >
              <button
                type="button"
                disabled={disabled || active || activatingId !== null}
                onClick={() => onActivate(rev.id)}
                title={active ? "Active revision" : `Switch to ${revisionLabel(rev)}`}
                className="hover:text-[#595DD2] transition-colors disabled:opacity-70 disabled:cursor-default"
              >
                {activatingId === rev.id ? "Switching…" : revisionLabel(rev)}
              </button>
              {!disabled && (
                <button
                  type="button"
                  disabled={deletingId !== null}
                  onClick={() => onDelete(rev)}
                  title={active ? "Delete the active revision" : `Delete ${revisionLabel(rev)}`}
                  className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  {deletingId === rev.id ? (
                    <div className="spinner !w-3 !h-3" />
                  ) : active ? (
                    <X className="w-3 h-3" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {!disabled && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`inline-flex rounded-xl border ${borderDefault} p-0.5 gap-0.5 bg-[#fafbfc] dark:bg-[#252b38]`}>
            <button
              type="button"
              onClick={() => onScopeChange("one")}
              className={`px-3 py-[5px] rounded-lg text-[12px] font-medium transition-all ${
                scope === "one" ? "bg-white dark:bg-[#1c2028] shadow-sm text-[#595DD2]" : textSecondary
              }`}
            >
              {activeLocaleName} only
            </button>
            <button
              type="button"
              onClick={() => onScopeChange("all")}
              disabled={localeCount < 2}
              title={localeCount < 2 ? "This run has a single locale" : `Save all ${localeCount} locales`}
              className={`px-3 py-[5px] rounded-lg text-[12px] font-medium transition-all disabled:opacity-50 ${
                scope === "all" ? "bg-white dark:bg-[#1c2028] shadow-sm text-[#595DD2]" : textSecondary
              }`}
            >
              All locales
            </button>
          </div>
          <input
            type="text"
            value={revName}
            maxLength={40}
            placeholder="Revision name (optional)"
            onChange={(e) => onRevNameChange(e.target.value)}
            className={`${inputCls} !w-52 !py-[6px]`}
          />
          <button type="button" onClick={onSave} disabled={saving || !dirty} className={btnPrimary}>
            {saving ? <div className="spinner !w-3.5 !h-3.5" /> : <Save className="w-4 h-4" />}
            {saving ? "Rendering…" : dirty ? "Save revision" : "No changes"}
          </button>
          {dirty && !saving && <span className={`text-[12px] ${textMuted}`}>Unsaved edits</span>}
          {saving && progress && progress.total > 0 && (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="h-1.5 rounded-full bg-gray-200 dark:bg-[#2a3040] overflow-hidden">
                <div className="h-full bg-[#595DD2] transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <span className={`text-[12px] ${textPrimary}`}>
                Rendering {progress.locale ? getLocaleName(progress.locale) : "…"}
                {current} · {progress.done}/{progress.total}
              </span>
            </div>
          )}
          {saving && (!progress || progress.total === 0) && (
            <span className={`text-[12px] ${textPrimary}`}>Starting render…</span>
          )}
        </div>
      )}
    </div>
  );
}
