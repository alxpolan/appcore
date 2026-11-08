import { useState, useCallback, useEffect, useRef } from "react";
import { X, Check, Paperclip, Trash2, Upload } from "lucide-react";
import { authHeaders } from "../hooks/useApi";
import {
  TD,
  TH,
  borderDefault,
  btnSecSm,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
  textareaCls,
} from "../styles";
import type { ReviewAttachment } from "../types";

const MAX_INLINE_BYTES = 18 * 1024 * 1024;

interface ReviewAnswersPanelProps {
  versionId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

interface ReviewAnswerField {
  key: string;
  number: number;
  label: string;
  placeholder: string;
}

export default function ReviewAnswersPanel({ versionId, addToast }: ReviewAnswersPanelProps) {
  const [fields, setFields] = useState<ReviewAnswerField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ReviewAttachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [answersRes, attachmentsRes] = await Promise.all([
        fetch(`/api/asc/versions/review-answers?versionId=${encodeURIComponent(versionId)}`, {
          headers: authHeaders(),
        }),
        fetch(`/api/asc/versions/review-attachments?versionId=${encodeURIComponent(versionId)}`, {
          headers: authHeaders(),
        }),
      ]);

      if (!answersRes.ok) throw new Error((await answersRes.json()).error ?? `HTTP ${answersRes.status}`);
      const json = await answersRes.json();
      setFields(json.fields ?? []);
      setAnswers(json.answers ?? {});
      setAttachments(attachmentsRes.ok ? await attachmentsRes.json() : []);
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/asc/versions/review-answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ versionId, answers }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAnswers(json.answers ?? answers);
      addToast("Review answers saved", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const attach = async () => {
    setAttaching(true);
    try {
      const res = await fetch("/api/asc/versions/review-answers/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ versionId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(json.notes ?? "");
      addToast("Attached to App Review notes", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setAttaching(false);
    }
  };

  const uploadFile = async (fileDataUrl: string, fileName: string) => {
    setUploading(true);
    try {
      const res = await fetch("/api/asc/versions/review-attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ versionId, fileName, fileDataUrl }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFileUrl("");
      await load();
      addToast("Attachment uploaded — may take a moment to process", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_INLINE_BYTES) {
      addToast("File too large for direct upload — paste a file URL instead", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";

      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mime = file.type || "video/mp4";

    await uploadFile(`data:${mime};base64,${base64}`, file.name);
  };

  const uploadFromUrl = async () => {
    const url = fileUrl.trim();
    if (!url) return;

    setUploading(true);
    try {
      const res = await fetch("/api/asc/versions/review-attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ versionId, fileUrl: url }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFileUrl("");
      await load();
      addToast("Attachment uploaded — may take a moment to process", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (id: string) => {
    if (!confirm("Delete this attachment?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/versions/review-attachments/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setAttachments((list) => list?.filter((attachment) => attachment.id !== id) ?? null);
      addToast("Attachment deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden mt-3`}>
      <div className={`px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}>
        <span className={`text-[13px] font-semibold ${textPrimary}`}>App Review Answers</span>
      </div>
      <div className="p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]">
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <label className={`text-[11px] ${textSecondary} font-medium`}>
              {field.number}. {field.label}
            </label>
            <textarea
              className={textareaCls}
              rows={field.key === "purposeAudience" || field.key === "setup" ? 3 : 2}
              value={answers[field.key] ?? ""}
              onChange={(e) => setAnswers((current) => ({ ...current, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
            />
          </div>
        ))}
        {preview != null && (
          <pre
            className={`text-[11px] ${textSecondary} whitespace-pre-wrap rounded-lg border ${borderDefault} p-2 bg-white dark:bg-[#252b38]`}
          >
            {preview}
          </pre>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={load} disabled={saving || attaching} className={btnSecSm}>
            <X className="w-3 h-3" />
            Reset
          </button>
          <button onClick={save} disabled={saving || attaching} className={btnSecSm}>
            {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
            Save Answers
          </button>
          <button onClick={attach} disabled={saving || attaching} className={btnSecSm}>
            {attaching ? <div className="spinner !w-3 !h-3" /> : <Paperclip className="w-3 h-3" />}
            Attach to Review Notes
          </button>
        </div>
      </div>
      <div className={`px-4 py-3 border-t ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}>
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Attachments</span>
      </div>
      <div className="p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]">
        {attachments && attachments.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>File</th>
                <th className={TH}>State</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {attachments.map((attachment) => (
                <tr
                  key={attachment.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={`${TD} font-medium ${textPrimary}`}>
                    {attachment.fileName ?? attachment.id}
                  </td>
                  <td className={`${TD} ${textSecondary}`}>{attachment.assetDeliveryState ?? "—"}</td>
                  <td className={`${TD} text-right`}>
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      disabled={deletingId === attachment.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                    >
                      {deletingId === attachment.id ? (
                        <div className="spinner !w-3 !h-3" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={`text-[12px] ${textMuted}`}>No attachments yet. Upload the screen recording here.</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,image/png,image/jpeg,.mp4,.mov,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            placeholder="…or paste a file URL for large videos"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`${btnSecSm} shrink-0`}
          >
            {uploading ? <div className="spinner !w-3 !h-3" /> : <Upload className="w-3 h-3" />}
            File
          </button>
          <button onClick={uploadFromUrl} disabled={uploading || !fileUrl.trim()} className={`${btnSecSm} shrink-0`}>
            {uploading ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
            Upload URL
          </button>
        </div>
      </div>
    </div>
  );
}
