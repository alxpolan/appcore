import { useState, useEffect } from "react";
import { authHeaders } from "../../hooks/useApi";
import { btnPrimary, cardCls, inputCls, pageTitle, textMuted, textPrimary } from "../../styles";
import type { AuthUser } from "../../types";

interface Props {
  user: AuthUser;
  onUserUpdate: (u: AuthUser) => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function ProfileSettings({ user, onUserUpdate, addToast }: Props) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user.name ?? "");
    setEmail(user.email ?? "");
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onUserUpdate({ ...user, name: data.name, email: data.email });
      addToast("Profile updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className={`${pageTitle} mb-1`}>Profile</h1>
      <p className="text-sm text-[#6b7280] dark:text-[#5c6478] mb-8">Manage your personal account details.</p>

      <div className={`${cardCls} mb-6`}>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-[#595DD2] flex items-center justify-center text-white text-xl font-bold shrink-0">
            {(user.name || user.email || "U")
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <div className={`text-[15px] font-semibold ${textPrimary}`}>{user.name || user.email}</div>
            <div className={`text-xs ${textMuted} mt-0.5`}>{user.role === "ADMIN" ? "Admin" : "Member"}</div>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[#374151] dark:text-[#c4cad8] mb-1.5">Full Name</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] dark:text-[#c4cad8] mb-1.5">Email</label>
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
