import { useState, useEffect, useRef } from "react";
import { authHeaders } from "../../hooks/useApi";
import SectionCard from "./SectionCard";
import { borderDefault, btnPrimary, btnSecondary, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import { CheckCircle, Paperclip, FileText, Plus, X } from "lucide-react";

interface TeamCertificate {
  id: string;
  name: string;
  appleTeamId: string | null;
  createdAt: string;
}

interface StoredProfileBundle {
  bundleId: string | null;
  expiresAt: string | null;
}

interface SigningStatus {
  hasCert: boolean;
  hasProfile: boolean;
  profileCount: number;
  teamId: string | null;
  appTeamId: string | null;
  certificateId: string | null;
  certificateName: string | null;
  certificates: TeamCertificate[];
  profileBundles: StoredProfileBundle[];
}

interface Props {
  appId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(b64);
    };
    reader.onerror = reject;
  });
}

function certLabel(cert: TeamCertificate): string {
  return cert.appleTeamId ? `${cert.name} · ${cert.appleTeamId}` : cert.name;
}

export default function SigningSection({ appId, addToast }: Props) {
  const [status, setStatus] = useState<SigningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showLegacyForm, setShowLegacyForm] = useState(false);
  const [p12File, setP12File] = useState<File | null>(null);
  const [profileFiles, setProfileFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [teamId, setTeamId] = useState("");
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [certName, setCertName] = useState("");
  const [certP12File, setCertP12File] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [certTeamId, setCertTeamId] = useState("");
  const [creatingCert, setCreatingCert] = useState(false);
  const p12Ref = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLInputElement>(null);
  const certP12Ref = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/apps/${appId}/signing`, {
        headers: authHeaders(),
      });
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [appId]);

  const handleLegacySave = async () => {
    if (!p12File || profileFiles.length === 0 || !password) {
      addToast("Certificate (.p12), at least one provisioning profile, and password are required", "error");
      return;
    }
    setSaving(true);
    try {
      const p12Base64 = await readFileAsBase64(p12File);
      const profilesBase64 = await Promise.all(profileFiles.map(readFileAsBase64));
      const res = await fetch(`/api/apps/${appId}/signing`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          p12Base64,
          p12Password: password,
          profilesBase64,
          teamId: teamId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      addToast(
        `Signing credentials saved (${profilesBase64.length} profile${profilesBase64.length === 1 ? "" : "s"})`,
        "success",
      );
      setShowLegacyForm(false);
      setP12File(null);
      setProfileFiles([]);
      setPassword("");
      setTeamId("");
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectCertificate = async (value: string) => {
    if (value === "__new__") {
      setCertName("");
      setCertP12File(null);
      setCertPassword("");
      setCertTeamId(status?.teamId ?? "");
      setShowCertModal(true);
      return;
    }
    setLinking(true);
    try {
      const res = await fetch(`/api/apps/${appId}/signing`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ signingCertificateId: value === "" ? null : value }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update certificate");
      addToast(value === "" ? "Certificate unlinked" : "Certificate linked", "success");
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setLinking(false);
    }
  };

  const handleCreateCertificate = async () => {
    if (!certP12File || !certPassword || !certName.trim()) {
      addToast("Certificate (.p12), password, and a name are required", "error");
      return;
    }
    setCreatingCert(true);
    try {
      const p12Base64 = await readFileAsBase64(certP12File);
      const res = await fetch(`/api/apps/${appId}/signing/certificates`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: certName.trim(),
          p12Base64,
          p12Password: certPassword,
          appleTeamId: certTeamId.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create certificate");
      const data = await res.json();
      addToast(`Certificate "${data.certificate.name}" created and linked`, "success");
      setShowCertModal(false);
      setCertName("");
      setCertP12File(null);
      setCertPassword("");
      setCertTeamId("");
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setCreatingCert(false);
    }
  };

  const handleGenerateProfile = async () => {
    setGeneratingProfile(true);
    try {
      const res = await fetch(`/api/apps/${appId}/signing/profiles`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate profiles");
      const created = (data.profiles ?? []).filter((p: { reused: boolean }) => !p.reused).length;
      const reused = (data.profiles ?? []).length - created;
      addToast(
        `${(data.profiles ?? []).length} bundle${(data.profiles ?? []).length === 1 ? "" : "s"}: ${created} created, ${reused} reused`,
        "success",
      );
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setGeneratingProfile(false);
    }
  };

  const handleSaveProfiles = async () => {
    if (profileFiles.length === 0) {
      addToast("Choose at least one provisioning profile", "error");
      return;
    }
    setSaving(true);
    try {
      const profilesBase64 = await Promise.all(profileFiles.map(readFileAsBase64));
      const res = await fetch(`/api/apps/${appId}/signing`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ profilesBase64 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save profiles");
      addToast(
        `Profiles saved (${profilesBase64.length} profile${profilesBase64.length === 1 ? "" : "s"})`,
        "success",
      );
      setProfileFiles([]);
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove signing credentials? Binary builds will fail until new credentials are added.")) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/apps/${appId}/signing`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to remove");
      addToast("Signing credentials removed", "success");
      fetchStatus();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return null;

  if (!status?.appTeamId) {
    const hasAll = status?.hasCert && status?.hasProfile;

    return (
      <SectionCard
        title="iOS Code Signing"
        desc="Upload your .p12 certificate and .mobileprovision profile so Marteso can build a signed IPA on each commit."
      >
        {hasAll && !showLegacyForm ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className={`text-sm font-medium ${textPrimary}`}>Credentials configured</div>
                <div className={`text-[11px] ${textMuted}`}>
                  {`${status?.profileCount ?? 1} profile${(status?.profileCount ?? 1) === 1 ? "" : "s"}`}
                  {status?.teamId ? ` · Team ID: ${status.teamId}` : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button className={btnSecondary} onClick={() => setShowLegacyForm(true)}>
                Update
              </button>
              <button className={btnSecondary} onClick={handleRemove} disabled={removing}>
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {!hasAll && !showLegacyForm && (
              <div className="flex items-center justify-between">
                <div className={`text-sm ${textSecondary}`}>
                  No signing credentials configured — binary builds will be skipped.
                </div>
                <button className={btnPrimary} onClick={() => setShowLegacyForm(true)}>
                  Add Credentials
                </button>
              </div>
            )}

            {showLegacyForm && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Certificate (.p12)</label>
                  <div
                    className={`flex items-center gap-3 px-3.5 py-[9px] rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] cursor-pointer hover:border-[#595DD2] transition-colors`}
                    onClick={() => p12Ref.current?.click()}
                  >
                    <Paperclip className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />
                    <span className={`text-[13px] ${textMuted}`}>{p12File ? p12File.name : "Choose .p12 file…"}</span>
                    <input
                      ref={p12Ref}
                      type="file"
                      accept=".p12,.pfx"
                      className="hidden"
                      onChange={(e) => setP12File(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Certificate Password</label>
                  <input
                    type="password"
                    className={inputCls}
                    placeholder="Password used to export the .p12"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>
                    Provisioning Profiles (.mobileprovision)
                  </label>
                  <div
                    className={`flex items-center gap-3 px-3.5 py-[9px] rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] cursor-pointer hover:border-[#595DD2] transition-colors`}
                    onClick={() => profileRef.current?.click()}
                  >
                    <FileText className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />
                    <span className={`text-[13px] ${textMuted}`}>
                      {profileFiles.length === 0
                        ? "Choose .mobileprovision file(s)…"
                        : profileFiles.map((f) => f.name).join(", ")}
                    </span>
                    <input
                      ref={profileRef}
                      type="file"
                      accept=".mobileprovision"
                      multiple
                      className="hidden"
                      onChange={(e) => setProfileFiles(Array.from(e.target.files ?? []))}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>
                    Apple Team ID <span className="font-normal text-[#9ca3af]">(optional)</span>
                  </label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="e.g. ABC123XYZ"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button className={btnPrimary} onClick={handleLegacySave} disabled={saving}>
                    {saving ? "Saving…" : "Save Credentials"}
                  </button>
                  <button
                    className={btnSecondary}
                    onClick={() => {
                      setShowLegacyForm(false);
                      setP12File(null);
                      setProfileFiles([]);
                      setPassword("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    );
  }

  const configured = status.hasCert && status.hasProfile;

  return (
    <SectionCard
      title="iOS Code Signing"
      desc="Pick a team certificate and upload this app's .mobileprovision profiles so Marteso can build a signed IPA on each commit."
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Team Certificate</label>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
              <CheckCircle
                className={`w-4 h-4 ${status.hasCert ? "text-emerald-600 dark:text-emerald-400" : "text-[#9ca3af]"}`}
              />
            </div>
            <select
              className={`${inputCls} flex-1`}
              value={status.certificateId ?? ""}
              disabled={linking}
              onChange={(e) => handleSelectCertificate(e.target.value)}
            >
              <option value="">No certificate selected…</option>
              {status.certificates.map((cert) => (
                <option key={cert.id} value={cert.id}>
                  {certLabel(cert)}
                </option>
              ))}
              <option value="__new__">＋ Neues Zertifikat erstellen…</option>
            </select>
          </div>
          <p className={`text-[11px] ${textMuted} mt-1.5`}>
            {status.certificateName
              ? `Using "${status.certificateName}"${status.teamId ? ` · Team ID: ${status.teamId}` : ""} — shared across this team's apps.`
              : "Certificates live on the team level and can be reused by every app."}
          </p>
        </div>

        <div>
          <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>
            Provisioning Profiles (.mobileprovision)
          </label>
          <div
            className={`flex items-center gap-3 px-3.5 py-[9px] rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] cursor-pointer hover:border-[#595DD2] transition-colors`}
            onClick={() => profileRef.current?.click()}
          >
            <FileText className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />
            <span className={`text-[13px] ${textMuted}`}>
              {profileFiles.length === 0
                ? status.hasProfile
                  ? `${status.profileCount} profile${status.profileCount === 1 ? "" : "s"} stored — choose file(s) to replace…`
                  : "Choose .mobileprovision file(s)…"
                : profileFiles.map((f) => f.name).join(", ")}
            </span>
            <input
              ref={profileRef}
              type="file"
              accept=".mobileprovision"
              multiple
              className="hidden"
              onChange={(e) => setProfileFiles(Array.from(e.target.files ?? []))}
            />
          </div>
          <p className={`text-[11px] ${textMuted} mt-1.5`}>
            One profile per bundle ID. App extensions (widgets, share sheets, app clips) each need their own.
          </p>
          {status.profileBundles.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              {status.profileBundles.map((bundle, i) => {
                const expired = bundle.expiresAt ? new Date(bundle.expiresAt).getTime() < Date.now() : false;

                return (
                  <div key={i} className={`flex items-center justify-between text-[12px] ${textSecondary}`}>
                    <span className="font-mono truncate">{bundle.bundleId ?? "Unknown bundle"}</span>
                    <span className={expired ? "text-red-500 font-medium" : textMuted}>
                      {bundle.expiresAt
                        ? `${expired ? "expired " : "valid until "}${new Date(bundle.expiresAt).toLocaleDateString()}`
                        : "expiry unknown"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {profileFiles.length > 0 && (
            <div className="flex gap-2 mt-2">
              <button className={btnPrimary} onClick={handleSaveProfiles} disabled={saving}>
                {saving ? "Saving…" : "Save Profiles"}
              </button>
              <button className={btnSecondary} onClick={() => setProfileFiles([])}>
                Cancel
              </button>
            </div>
          )}
          {status.certificateId && (
            <div className="mt-2">
              <button className={btnSecondary} onClick={handleGenerateProfile} disabled={generatingProfile}>
                {generatingProfile ? "Generating…" : "Generate via App Store Connect"}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className={`text-[12px] ${configured ? "text-emerald-600 dark:text-emerald-400" : textSecondary}`}>
            {configured ? "Ready — certificate and profiles configured." : "Not ready — link a certificate and upload profiles."}
          </div>
          {(status.hasCert || status.hasProfile) && (
            <button className={btnSecondary} onClick={handleRemove} disabled={removing}>
              {removing ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>

      {showCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !creatingCert && setShowCertModal(false)} />
          <div className="relative bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className={`text-[16px] font-semibold ${textPrimary}`}>Neues Team-Zertifikat</h3>
              <button
                className={`${textMuted} hover:text-[#595DD2] transition-colors`}
                onClick={() => setShowCertModal(false)}
                disabled={creatingCert}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className={`text-[12px] ${textSecondary} mb-4`}>
              Saved on the team level — every app of this team can reuse it.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Name</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. App Store 2026"
                  value={certName}
                  onChange={(e) => setCertName(e.target.value)}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Certificate (.p12)</label>
                <div
                  className={`flex items-center gap-3 px-3.5 py-[9px] rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] cursor-pointer hover:border-[#595DD2] transition-colors`}
                  onClick={() => certP12Ref.current?.click()}
                >
                  <Paperclip className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />
                  <span className={`text-[13px] ${textMuted}`}>
                    {certP12File ? certP12File.name : "Choose .p12 file…"}
                  </span>
                  <input
                    ref={certP12Ref}
                    type="file"
                    accept=".p12,.pfx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setCertP12File(file);
                      if (file && !certName) setCertName(file.name.replace(/\.p12$/i, "").replace(/\.pfx$/i, ""));
                    }}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>Certificate Password</label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder="Password used to export the .p12"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${textSecondary} mb-1.5`}>
                  Apple Team ID <span className="font-normal text-[#9ca3af]">(optional)</span>
                </label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. ABC123XYZ"
                  value={certTeamId}
                  onChange={(e) => setCertTeamId(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  className={`${btnPrimary} inline-flex items-center gap-1.5`}
                  onClick={handleCreateCertificate}
                  disabled={creatingCert}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {creatingCert ? "Creating…" : "Create & Link"}
                </button>
                <button className={btnSecondary} onClick={() => setShowCertModal(false)} disabled={creatingCert}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
