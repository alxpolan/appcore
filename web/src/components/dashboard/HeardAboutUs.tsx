import { useState } from "react";
import { Check } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { cardCls, borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import type { AuthUser } from "../../types";

const OPTIONS = [
  "Reddit",
  "X (Twitter)",
  "Google search",
  "ChatGPT / AI assistant",
  "An email from us",
  "Friend or colleague",
  "Other",
];

const DEMO_EMAILS = ["demo@marteso.com", "demo2@marteso.com"];

interface Props {
  user: AuthUser;
  onUserUpdate?: (u: AuthUser) => void;
}

export default function HeardAboutUs({ user, onUserUpdate }: Props) {
  const [answered, setAnswered] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  if (user.isDemo || DEMO_EMAILS.includes(user.email)) return null;
  if (user.heardAboutUs && !answered) return null;

  const pick = async (source: string) => {
    if (saving) return;
    setSaving(source);
    try {
      await apiPost("/auth/heard-about-us", { source });
      setAnswered(source);
      onUserUpdate?.({ ...user, heardAboutUs: source });
    } catch {
      setSaving(null);
    }
  };

  return (
    <div className={`${cardCls} mb-5`}>
      {answered ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#595DD2] text-white shrink-0">
            <Check className="w-3 h-3" strokeWidth={3} />
          </span>
          <span className={`text-[13px] ${textSecondary}`}>
            Thanks! Noted <span className={`font-medium ${textPrimary}`}>{answered}</span>.
          </span>
        </div>
      ) : (
        <>
          <div className={`text-[14px] font-semibold ${textPrimary}`}>How did you hear about us?</div>
          <div className={`text-[12.5px] ${textMuted} mt-0.5`}>One click, it helps us a lot.</div>
          <div className="flex flex-wrap gap-2 mt-3.5">
            {OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => pick(opt)}
                disabled={saving !== null}
                className={`inline-flex items-center px-3 py-1.5 rounded-full border ${borderDefault} bg-white dark:bg-[#252b38] text-[12.5px] font-medium ${textSecondary} hover:border-[#595DD2] hover:text-[#595DD2] dark:hover:border-[#595DD2] dark:hover:text-[#8b8ee6] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
