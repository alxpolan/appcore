import { useState } from "react";
import { useApi, apiPut, apiDelete } from "../hooks/useApi";
import SectionCard from "./settings/SectionCard";
import type { McpConfig, OAuthClient } from "../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary } from "../styles";

interface Props {
  addToast: (msg: string, type?: "success" | "error") => void;
}

const MCP_TOOLS = [
  {
    name: "list_apps",
    desc: "Discover all managed apps with bundle IDs and live stats - start here for multi-app workflows",
  },
  {
    name: "get_app_info",
    desc: "Current title, subtitle, keywords and description for an app",
  },
  {
    name: "get_keywords",
    desc: "Tracked keywords with popularity scores and current rankings",
  },
  {
    name: "get_competitors",
    desc: "Competitor apps with relevance scores and latest ratings",
  },
  {
    name: "get_suggestions",
    desc: "AI-generated ASO suggestions, filterable by status (PENDING, APPROVED, etc.)",
  },
  {
    name: "get_analytics",
    desc: "Downloads, revenue, impressions and page views for a configurable date range",
  },
  {
    name: "get_reviews",
    desc: "App Store reviews with optional rating and territory filters",
  },
  {
    name: "update_suggestion",
    desc: "Approve, reject, or mark an ASO suggestion as applied",
  },
  {
    name: "trigger_job",
    desc: "Trigger a background job: scrape, analyze, sync, track-keywords, discover-keywords",
  },
  {
    name: "list_asc_leaderboards",
    desc: "List all Game Center leaderboards for an app with IDs, vendor identifiers, score format, and archived status",
  },
  {
    name: "create_asc_leaderboard",
    desc: "Create a new Game Center leaderboard with score format, sort order, and submission type",
  },
  {
    name: "update_asc_leaderboard",
    desc: "Update a leaderboard's reference name or archive/unarchive it",
  },
  {
    name: "delete_asc_leaderboard",
    desc: "Delete a Game Center leaderboard (only if it has never been live)",
  },
  {
    name: "list_asc_leaderboard_localizations",
    desc: "List all locale translations for a leaderboard including display names and score suffixes",
  },
  {
    name: "create_asc_leaderboard_localization",
    desc: "Add a new locale translation to a leaderboard",
  },
  {
    name: "update_asc_leaderboard_localization",
    desc: "Update the display name or score suffixes for a leaderboard localization",
  },
  {
    name: "delete_asc_leaderboard_localization",
    desc: "Delete a localization from a leaderboard",
  },
];

export default function Agents({ addToast }: Props) {
  const { data: config, refetch } = useApi<McpConfig>("/mcp/config", [], true);
  const { data: oauthClients, refetch: refetchClients } = useApi<OAuthClient[]>("/mcp/oauth-clients", [], true);

  const [toggling, setToggling] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const mcpUrl = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";

  const handleToggle = async () => {
    if (!config) return;
    setToggling(true);
    try {
      await apiPut("/mcp/config", { mcpEnabled: !config.mcpEnabled });
      await refetch();
      addToast(config.mcpEnabled ? "MCP server disabled" : "MCP server enabled", "success");
    } catch {
      addToast("Failed to update MCP status", "error");
    } finally {
      setToggling(false);
    }
  };

  const handleDeleteClient = async (id: string) => {
    setDeletingId(id);
    try {
      await apiDelete(`/mcp/oauth-clients/${id}`);
      await refetchClients();
      addToast("OAuth client deleted", "success");
    } catch {
      addToast("Failed to delete OAuth client", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = async (text: string | null) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    addToast("Copied to clipboard", "success");
  };

  return (
    <div className="max-w-3xl">
      <h1 className={`${pageTitle} mb-1`}>Agents</h1>
      <p className={`text-sm ${textMuted} mb-8`}>Connect AI agents like Claude Desktop via MCP</p>

      <SectionCard
        title="MCP Server"
        desc="Expose Marteso as an MCP server so Claude Desktop and other MCP clients can read your ASO data and trigger jobs."
      >
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-sm font-medium ${textPrimary}`}>MCP Server Status</div>
            <div className={`text-xs ${textMuted} mt-0.5`}>
              {config?.mcpEnabled
                ? `Active - endpoint available at ${mcpUrl}`
                : "Disabled - no MCP connections are accepted"}
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling || !config}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
              config?.mcpEnabled ? "bg-[#595DD2]" : "bg-gray-200 dark:bg-[#2a2f3d]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                config?.mcpEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </SectionCard>

      <SectionCard title="OAuth Clients">
        <div className={`mb-5 p-3.5 rounded-xl bg-[#f8f9fb] dark:bg-[#252b38] border ${borderDefault}`}>
          <p className={`text-[12px] font-medium ${textPrimary} mb-1.5`}>How to connect Claude Desktop</p>
          <ol className={`text-[12px] ${textMuted} space-y-1 list-decimal list-inside`}>
            <li>In Claude Desktop → Settings → Connectors → Add custom connector.</li>
            <li>
              Enter the MCP Server URL:{" "}
              <code
                className={`font-mono ${textPrimary} cursor-pointer hover:text-[#595DD2]`}
                onClick={() => copyToClipboard(mcpUrl)}
                title="Click to copy"
              >
                {mcpUrl}
              </code>
            </li>
            <li>
              Leave OAuth Client ID and Secret <strong className={`${textPrimary}`}>empty</strong>
            </li>
            <li>Claude.ai opens an Marteso login page - sign in to authorize.</li>
            <li>Done. The client appears in the table below.</li>
          </ol>
        </div>

        {oauthClients && oauthClients.length > 0 ? (
          <div className={`rounded-xl border ${borderDefault} overflow-hidden`}>
            <table className="w-full">
              <thead>
                <tr className="bg-[#f8f9fb] dark:bg-[#252b38]">
                  <th className={TH}>Name</th>
                  <th className={TH}>Client ID</th>
                  <th className={TH}>Registered</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {oauthClients.map((client) => (
                  <tr key={client.id}>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${textPrimary}`}>{client.name}</span>
                        {client.userId === null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium">
                            auto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex items-center gap-1.5">
                        <code className={`text-[11px] font-mono ${textMuted}`}>{client.clientId}</code>
                        <button
                          onClick={() => copyToClipboard(client.clientId)}
                          className={`text-[10px] ${textMuted} hover:text-[#595DD2] transition-colors`}
                          title="Copy Client ID"
                        >
                          ⎘
                        </button>
                      </div>
                    </td>
                    <td className={`${TD} ${textMuted}`}>{new Date(client.createdAt).toLocaleDateString()}</td>
                    <td className={TD}>
                      <button
                        onClick={() => handleDeleteClient(client.id)}
                        disabled={deletingId === client.id}
                        className={`${btnSecSm} !text-red-500 hover:!border-red-300 hover:!text-red-600`}
                      >
                        {deletingId === client.id ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`text-[13px] ${textMuted}`}>No clients connected yet.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Available MCP Tools"
        desc="These tools are exposed to your MCP client and can be called by Claude."
      >
        <div className="flex flex-col gap-2">
          {MCP_TOOLS.map((tool) => (
            <div
              key={tool.name}
              className={`flex items-start gap-3 p-3 bg-[#f8f9fb] dark:bg-[#252b38] rounded-xl border ${borderDefault}`}
            >
              <code className="text-[12px] font-mono font-semibold text-[#595DD2] shrink-0 mt-0.5">{tool.name}</code>
              <span className="text-xs text-gray-500 dark:text-[#8b93a5] mt-0.5">{tool.desc}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
