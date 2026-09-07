import { Fragment, useState, useEffect, useCallback } from "react";
import { textPrimary } from "../styles";
import { authHeaders } from "../hooks/useApi";
import { Pencil, Plus, X, LayoutGrid, Trash2 } from "lucide-react";
import { usePostHog } from "@posthog/react";

interface AppOption {
  id: string;
  name: string;
  bundleId: string;
  iconUrl: string | null;
}
type TeamRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

const ROLE_COLORS: Record<TeamRole, string> = {
  OWNER: "bg-[#eef0fd] text-[#595DD2] dark:bg-[#23253f] dark:text-[#9b9ee9]",
  ADMIN: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  MEMBER: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  VIEWER: "bg-gray-100 text-gray-500 dark:bg-[#252b38] dark:text-[#8b93a5]",
};

const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  OWNER: "Full access + manage team",
  ADMIN: "Invite & manage members",
  MEMBER: "Use & edit all features",
  VIEWER: "Read-only access",
};

interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: TeamRole;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: TeamRole;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

interface TeamData {
  team: { id: string; name: string };
  members: Member[];
  pendingInvites: PendingInvite[];
}

function AppIconStack({ apps, selectedIds, max = 4 }: { apps: AppOption[]; selectedIds: string[]; max?: number }) {
  if (selectedIds.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-[#5c6478] italic">All apps</span>;
  }
  const selected = apps.filter((a) => selectedIds.includes(a.id));
  const visible = selected.slice(0, max);
  const overflow = selected.length - visible.length;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        {visible.map((app, i) => (
          <div
            key={app.id}
            title={app.name}
            style={{ zIndex: visible.length - i, marginLeft: i === 0 ? 0 : -6 }}
            className="w-7 h-7 rounded-[7px] overflow-hidden border-2 border-white dark:border-[#1c2028] bg-gray-100 dark:bg-[#252b38] shrink-0"
          >
            {app.iconUrl ? (
              <img src={app.iconUrl} alt={app.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-gray-400">
                {app.name.charAt(0)}
              </div>
            )}
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <span className="text-[11px] font-medium text-gray-400 dark:text-[#5c6478]">+{overflow} more</span>
      )}
    </div>
  );
}

export default function Team({
  addToast,
  currentUserId,
}: {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  currentUserId: string;
}) {
  const posthog = usePostHog();
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<TeamRole | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<TeamRole>("MEMBER");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [appAccessMemberId, setAppAccessMemberId] = useState<string | null>(null);
  const [allApps, setAllApps] = useState<AppOption[]>([]);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [savingAppAccess, setSavingAppAccess] = useState(false);
  const [memberAppIds, setMemberAppIds] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/team", { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: TeamData = await res.json();
      setData(d);
      const me = d.members.find((m) => m.userId === currentUserId);
      setMyRole(me?.role ?? null);
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const membersNeedingAccess = data.members.filter((m) => m.role === "MEMBER" || m.role === "VIEWER");
    membersNeedingAccess.forEach(async (m) => {
      try {
        const [appsRes, accessRes] = await Promise.all([
          fetch("/api/apps?ownOnly=true", { headers: authHeaders() }),
          fetch(`/api/team/members/${m.id}/apps`, { headers: authHeaders() }),
        ]);
        const apps: AppOption[] = (await appsRes.json()).filter((a: any) => a.isOwnApp);
        const { appIds } = await accessRes.json();
        setAllApps(apps);
        setMemberAppIds((prev) => ({ ...prev, [m.id]: appIds }));
      } catch {
        // ignore
      }
    });
  }, [data]);

  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      posthog?.capture("team_member_invited", {
        role: inviteRole,
        email_domain: inviteEmail.trim().split("@")[1] ?? null,
      });

      addToast(`Invitation sent to ${inviteEmail}`, "success");
      setInviteEmail("");
      setInviteRole("MEMBER");
      setShowInvite(false);
      load();
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string, email: string) => {
    if (!confirm(`Revoke invitation for ${email}?`)) return;
    try {
      const res = await fetch(`/api/team/invites/${inviteId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      addToast("Invitation revoked", "info");
      load();
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
  };

  const handleUpdateRole = async (memberId: string) => {
    try {
      const res = await fetch(`/api/team/members/${memberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ role: editRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setEditingId(null);
      load();
      addToast("Role updated", "success");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
  };

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the team?`)) return;
    try {
      const res = await fetch(`/api/team/members/${memberId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      addToast(`${email} removed`, "info");
      load();
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
  };

  const handleOpenAppAccess = async (memberId: string) => {
    setAppAccessMemberId(memberId);
    try {
      const [appsRes, accessRes] = await Promise.all([
        fetch("/api/apps?ownOnly=true", { headers: authHeaders() }),
        fetch(`/api/team/members/${memberId}/apps`, { headers: authHeaders() }),
      ]);
      const apps: AppOption[] = (await appsRes.json()).filter((a: any) => a.isOwnApp);
      const { appIds } = await accessRes.json();
      setAllApps(apps);
      setSelectedAppIds(appIds);
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
  };

  const handleSaveAppAccess = async (memberId: string) => {
    setSavingAppAccess(true);
    try {
      const res = await fetch(`/api/team/members/${memberId}/apps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ appIds: selectedAppIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      addToast("App access saved", "success");
      setMemberAppIds((prev) => ({ ...prev, [memberId]: selectedAppIds }));
      setAppAccessMemberId(null);
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    } finally {
      setSavingAppAccess(false);
    }
  };

  const handleSaveName = async () => {
    if (!nameValue.trim()) return;
    setSavingName(true);
    try {
      const res = await fetch("/api/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setEditingName(false);
      load();
      addToast("Team name updated", "success");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    } finally {
      setSavingName(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-sm text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading…
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                autoFocus
                className="text-xl font-bold px-3 py-1 rounded-lg border border-[#595DD2] bg-white dark:bg-[#1c2028] text-[#1a1a2e] dark:text-[#e8eaf0] focus:outline-none"
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="px-3 py-1 rounded-lg bg-[#595DD2] text-white text-xs font-semibold hover:bg-[#484CBE] transition-all disabled:opacity-50"
              >
                {savingName ? "…" : "Save"}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-1 rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] text-xs text-gray-500 dark:text-[#8b93a5]"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#1a1a2e] dark:text-[#e8eaf0]">{data?.team.name ?? "Team"}</h1>
              {canManage && (
                <button
                  onClick={() => {
                    setNameValue(data?.team.name ?? "");
                    setEditingName(true);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 dark:text-[#5c6478] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] hover:bg-gray-100 dark:hover:bg-[#252b38] transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <span className="text-sm text-gray-400 dark:text-[#5c6478]">
            {data?.members.length ?? 0} member
            {data?.members.length !== 1 ? "s" : ""}
          </span>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setShowInvite(true);
              setInviteError(null);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#595DD2] text-white text-sm font-semibold hover:bg-[#484CBE] transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Invite Member
          </button>
        )}
      </div>

      {showInvite && (
        <form
          onSubmit={handleInvite}
          className="p-5 bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl flex flex-col gap-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1a1a2e] dark:text-[#e8eaf0]">Invite a new member</p>
              <p className="text-xs text-gray-400 dark:text-[#5c6478] mt-0.5">
                They'll receive an email with a link to join the team.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-[#e8eaf0] hover:bg-gray-100 dark:hover:bg-[#252b38] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <input
              type="email"
              placeholder="name@example.com"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteError(null);
              }}
              required
              className={`flex-1 px-3 py-2.5 text-sm rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] bg-[#f7f8fa] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2] transition-colors`}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              className={`px-3 py-2.5 text-sm rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] bg-[#f7f8fa] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2] transition-colors`}
            >
              <option value="VIEWER">Viewer</option>
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
            </select>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="px-5 py-2.5 rounded-xl bg-[#595DD2] text-white text-sm font-semibold hover:bg-[#484CBE] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {inviting ? "…" : "Send invite"}
            </button>
          </div>
          {inviteError && <p className="text-xs text-[#595DD2]">{inviteError}</p>}
        </form>
      )}

      <div className="bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#5c6478]">
            Members
          </p>
        </div>

        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-[#f7f8fa] dark:bg-[#161b24] border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
              <th className="w-[40%] text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                Member
              </th>
              <th className="w-[15%] text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                Role
              </th>
              <th className="w-[30%] text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                App Access
              </th>
              <th className="w-[15%] text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
            {(data?.members ?? []).map((m) => {
              const isMe = m.userId === currentUserId;
              const isEditing = editingId === m.id;
              const showAppAccess = m.role === "MEMBER" || m.role === "VIEWER";
              return (
                <Fragment key={m.id}>
                  <tr className="align-middle">
                    <td className="px-5 py-4 align-middle">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#6E72E4] to-[#595DD2] flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm">
                          {(m.name ?? m.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#1a1a2e] dark:text-[#e8eaf0] truncate flex items-center gap-1.5">
                            {m.name ?? m.email}
                            {isMe && (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#252b38] text-gray-400 dark:text-[#5c6478]">
                                you
                              </span>
                            )}
                          </div>
                          {m.name && (
                            <div className="text-[11px] text-gray-400 dark:text-[#5c6478] truncate">{m.email}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4 align-middle">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as TeamRole)}
                            className={`px-2 py-1.5 text-xs rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] bg-white dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2]`}
                          >
                            <option value="VIEWER">Viewer</option>
                            <option value="MEMBER">Member</option>
                            <option value="ADMIN">Admin</option>
                            <option value="OWNER">Owner</option>
                          </select>
                          <button
                            onClick={() => handleUpdateRole(m.id)}
                            className="px-2 py-1.5 rounded-lg bg-[#595DD2] text-white text-xs font-semibold hover:bg-[#484CBE] transition-all"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1.5 rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] text-xs text-gray-500 dark:text-[#8b93a5]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[m.role]}`}
                        >
                          {ROLE_LABELS[m.role]}
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 align-middle">
                      {showAppAccess ? (
                        <AppIconStack apps={allApps} selectedIds={memberAppIds[m.id] ?? []} />
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-[#5c6478] italic">Full access</span>
                      )}
                    </td>

                    <td className="px-5 py-4 align-middle">
                      <div className="flex items-center gap-1 justify-end">
                        {canManage && !isMe && (
                          <>
                            <button
                              onClick={() => {
                                setEditingId(m.id);
                                setEditRole(m.role);
                              }}
                              className="p-1.5 rounded-lg text-gray-400 dark:text-[#5c6478] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] hover:bg-gray-100 dark:hover:bg-[#252b38] transition-all"
                              title="Change role"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {showAppAccess && (
                              <button
                                onClick={() =>
                                  appAccessMemberId === m.id ? setAppAccessMemberId(null) : handleOpenAppAccess(m.id)
                                }
                                className={`p-1.5 rounded-lg transition-all ${appAccessMemberId === m.id ? "text-[#595DD2] bg-[#eef0fd] dark:bg-[#23253f]" : "text-gray-400 dark:text-[#5c6478] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] hover:bg-gray-100 dark:hover:bg-[#252b38]"}`}
                                title="Manage app access"
                              >
                                <LayoutGrid className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemove(m.id, m.email)}
                              className="p-1.5 rounded-lg text-gray-400 dark:text-[#5c6478] hover:text-red-500 hover:bg-red-50 dark:hover:bg-[#23253f] transition-all"
                              title="Remove member"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {appAccessMemberId === m.id && (
                    <tr key={`${m.id}-access`}>
                      <td colSpan={4} className="px-5 pb-4">
                        <div className="p-4 bg-[#f7f8fa] dark:bg-[#161b24] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-xl">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-sm font-semibold text-[#1a1a2e] dark:text-[#e8eaf0]">
                                App Access for {m.name ?? m.email}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-[#5c6478] mt-0.5">
                                {selectedAppIds.length === 0
                                  ? "All apps visible (no restriction)"
                                  : `${selectedAppIds.length} app${selectedAppIds.length !== 1 ? "s" : ""} selected`}
                              </p>
                            </div>
                          </div>
                          {allApps.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-[#5c6478]">No own apps available</p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-4 max-h-48 overflow-y-auto">
                              {allApps.map((app) => (
                                <label
                                  key={app.id}
                                  className="flex items-center gap-2.5 cursor-pointer group py-2 px-3 rounded-xl hover:bg-white dark:hover:bg-[#1c2028] border border-transparent hover:border-[#e5e7eb] dark:hover:border-[#2a2f3d] transition-all"
                                >
                                  <div className="w-8 h-8 rounded-[8px] overflow-hidden bg-gray-100 dark:bg-[#252b38] shrink-0">
                                    {app.iconUrl ? (
                                      <img src={app.iconUrl} alt={app.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-gray-400">
                                        {app.name.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[#1a1a2e] dark:text-[#e8eaf0] truncate">
                                      {app.name}
                                    </p>
                                    <p className="text-[10px] text-gray-400 dark:text-[#5c6478] truncate">
                                      {app.bundleId}
                                    </p>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={selectedAppIds.includes(app.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedAppIds((prev) => [...prev, app.id]);
                                      } else {
                                        setSelectedAppIds((prev) => prev.filter((id) => id !== app.id));
                                      }
                                    }}
                                    className="accent-[#595DD2] w-3.5 h-3.5 shrink-0"
                                  />
                                </label>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            {selectedAppIds.length > 0 && (
                              <button
                                onClick={() => setSelectedAppIds([])}
                                className="text-xs text-gray-400 dark:text-[#5c6478] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] transition-colors"
                              >
                                Clear all
                              </button>
                            )}
                            <div className="ml-auto flex gap-2">
                              <button
                                onClick={() => setAppAccessMemberId(null)}
                                className="px-3.5 py-1.5 rounded-lg border border-[#e5e7eb] dark:border-[#2a2f3d] text-xs font-medium text-gray-500 dark:text-[#8b93a5] hover:bg-gray-50 dark:hover:bg-[#252b38] transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveAppAccess(m.id)}
                                disabled={savingAppAccess}
                                className="px-3.5 py-1.5 rounded-lg bg-[#595DD2] text-white text-xs font-semibold hover:bg-[#484CBE] transition-all disabled:opacity-50"
                              >
                                {savingAppAccess ? "…" : "Save"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(data?.pendingInvites ?? []).length > 0 && (
        <div className="bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#5c6478]">
              Pending Invitations · {data!.pendingInvites.length}
            </p>
          </div>
          <div className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
            {data!.pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-[#252b38] flex items-center justify-center text-gray-400 dark:text-[#5c6478] text-sm font-bold shrink-0">
                  {inv.email.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1a1a2e] dark:text-[#e8eaf0] truncate">{inv.email}</div>
                  <div className="text-[11px] text-gray-400 dark:text-[#5c6478]">
                    Invited by {inv.invitedBy} · expires {new Date(inv.expiresAt).toLocaleDateString("en")}
                  </div>
                </div>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${ROLE_COLORS[inv.role]}`}
                >
                  {ROLE_LABELS[inv.role]}
                </span>
                {canManage && (
                  <button
                    onClick={() => handleRevokeInvite(inv.id, inv.email)}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-[#5c6478] hover:text-red-500 hover:bg-red-50 dark:hover:bg-[#23253f] transition-all shrink-0"
                    title="Revoke invitation"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#5c6478]">Roles</p>
        </div>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-[#f7f8fa] dark:bg-[#161b24] border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
              <th className="w-[25%] text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                Role
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#5c6478]">
                Description
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
            {(["OWNER", "ADMIN", "MEMBER", "VIEWER"] as TeamRole[]).map((r) => (
              <tr key={r} className="align-middle">
                <td className="px-5 py-3 align-middle">
                  <span className={`inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[r]}`}>
                    {ROLE_LABELS[r]}
                  </span>
                </td>
                <td className="px-5 py-3 align-middle text-[12px] text-gray-500 dark:text-[#8b93a5]">
                  {ROLE_DESCRIPTIONS[r]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
