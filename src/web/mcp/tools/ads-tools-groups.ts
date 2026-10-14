import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { prisma } from "../../../config";
import { appNotFoundWithListApps, jsonResult, mcpToolMessages, textResult, verifyMcpAppAccess } from "./shared";
import { adsError, registerAdsMutatingTool, registerAdsReadTool } from "./ads-tools-shared";
import {
  summarizeAssignGroup,
  summarizeCreateGroup,
  summarizeDeleteGroup,
  summarizeRenameGroup,
} from "./ads-tools-summaries";

async function resolveGroupApp(userId: string, bundleId: string | undefined) {
  if (!bundleId?.trim()) return { ok: false as const, error: mcpToolMessages.noBundleIdProvided };
  const app = await verifyMcpAppAccess(userId, bundleId);
  if (!app) return { ok: false as const, error: appNotFoundWithListApps(bundleId) };

  return { ok: true as const, app };
}

const groupBundleIdSchema = z
  .string()
  .describe("App bundle ID (e.g. 'com.example.app'). Call list_apps to see available apps.");

const groupScopeNote = "Campaign groups are internal Marteso organization (never synced to Apple).";

export function registerAppleAdsGroupTools(server: McpServer, userId: string) {
  registerAdsReadTool(
    server,
    userId,
    "list_ads_campaign_groups",
    {
      description:
        `List internal campaign groups for an app, each with its member campaign IDs. ${groupScopeNote} ` +
        "Use list_ads_campaigns to discover campaign IDs.",
      inputSchema: { bundleId: groupBundleIdSchema },
    },
    async ({ bundleId }) => {
      const resolved = await resolveGroupApp(userId, bundleId);
      if (!resolved.ok) return textResult(resolved.error);
      try {
        const groups = await prisma.appleAdsCampaignGroup.findMany({
          where: { appId: resolved.app.id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { members: { select: { externalCampaignId: true } } },
        });

        return jsonResult({
          bundleId,
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            sortOrder: g.sortOrder,
            campaignIds: g.members.map((m) => m.externalCampaignId),
          })),
        });
      } catch (err) {
        return adsError("list_ads_campaign_groups", err);
      }
    },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "create_ads_campaign_group",
    {
      description: `Create an internal campaign group for an app. ${groupScopeNote}`,
      inputSchema: {
        bundleId: groupBundleIdSchema,
        name: z.string().describe("Group name, e.g. 'Brand' or 'Competitors'."),
      },
    },
    async ({ bundleId, name }) => {
      const resolved = await resolveGroupApp(userId, bundleId);
      if (!resolved.ok) return textResult(resolved.error);
      const clean = String(name ?? "").trim();
      if (!clean) return textResult("Invalid group name: name is required.");
      try {
        const max = await prisma.appleAdsCampaignGroup.aggregate({
          where: { appId: resolved.app.id },
          _max: { sortOrder: true },
        });
        const group = await prisma.appleAdsCampaignGroup.create({
          data: { appId: resolved.app.id, name: clean, sortOrder: (max._max.sortOrder ?? -1) + 1 },
          select: { id: true, name: true, sortOrder: true },
        });

        return jsonResult({ bundleId, group });
      } catch (err) {
        return adsError("create_ads_campaign_group", err);
      }
    },
    { summarize: summarizeCreateGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "rename_ads_campaign_group",
    {
      description: `Rename an internal campaign group. ${groupScopeNote}`,
      inputSchema: {
        bundleId: groupBundleIdSchema,
        groupId: z.string().describe("Group ID from list_ads_campaign_groups."),
        name: z.string().describe("New group name."),
      },
    },
    async ({ bundleId, groupId, name }) => {
      const resolved = await resolveGroupApp(userId, bundleId);
      if (!resolved.ok) return textResult(resolved.error);
      const clean = String(name ?? "").trim();
      if (!clean) return textResult("Invalid group name: name cannot be empty.");
      try {
        const group = await prisma.appleAdsCampaignGroup.findFirst({
          where: { id: groupId, appId: resolved.app.id },
          select: { id: true, name: true },
        });
        if (!group) return textResult(`Group not found: ${groupId}.`);
        const updated = await prisma.appleAdsCampaignGroup.update({
          where: { id: group.id },
          data: { name: clean },
          select: { id: true, name: true, sortOrder: true },
        });

        return jsonResult({ bundleId, group: updated, previous: { name: group.name } });
      } catch (err) {
        return adsError("rename_ads_campaign_group", err);
      }
    },
    { summarize: summarizeRenameGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "delete_ads_campaign_group",
    {
      description:
        `Delete an internal campaign group; its campaigns become Ungrouped (nothing is deleted in Apple Search Ads). ${groupScopeNote}`,
      inputSchema: {
        bundleId: groupBundleIdSchema,
        groupId: z.string().describe("Group ID from list_ads_campaign_groups."),
      },
    },
    async ({ bundleId, groupId }) => {
      const resolved = await resolveGroupApp(userId, bundleId);
      if (!resolved.ok) return textResult(resolved.error);
      try {
        const group = await prisma.appleAdsCampaignGroup.findFirst({
          where: { id: groupId, appId: resolved.app.id },
          select: { id: true, name: true },
        });
        if (!group) return textResult(`Group not found: ${groupId}.`);
        await prisma.appleAdsCampaignGroup.delete({ where: { id: group.id } });

        return jsonResult({ bundleId, deleted: group.id, previous: { name: group.name } });
      } catch (err) {
        return adsError("delete_ads_campaign_group", err);
      }
    },
    { summarize: summarizeDeleteGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "assign_ads_campaign_group",
    {
      description:
        `Move an Apple Search Ads campaign into an internal group, or pass groupId null to remove it from its group. ${groupScopeNote} ` +
        "Use list_ads_campaigns to find campaign IDs and list_ads_campaign_groups for group IDs.",
      inputSchema: {
        bundleId: groupBundleIdSchema,
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        groupId: z
          .string()
          .nullable()
          .optional()
          .describe("Group ID to assign, or null to move the campaign to Ungrouped."),
      },
    },
    async ({ bundleId, campaignId, groupId }) => {
      const resolved = await resolveGroupApp(userId, bundleId);
      if (!resolved.ok) return textResult(resolved.error);
      if (groupId === undefined) return textResult("Nothing to do: pass groupId (or null to unassign).");
      try {
        const previous = await prisma.appleAdsCampaignGroupMember.findUnique({
          where: { appId_externalCampaignId: { appId: resolved.app.id, externalCampaignId: String(campaignId) } },
          include: { group: { select: { name: true } } },
        });

        if (groupId != null) {
          const group = await prisma.appleAdsCampaignGroup.findFirst({
            where: { id: groupId, appId: resolved.app.id },
            select: { id: true, name: true },
          });
          if (!group) return textResult(`Group not found: ${groupId}.`);
          await prisma.appleAdsCampaignGroupMember.upsert({
            where: { appId_externalCampaignId: { appId: resolved.app.id, externalCampaignId: String(campaignId) } },
            create: { appId: resolved.app.id, externalCampaignId: String(campaignId), groupId: group.id },
            update: { groupId: group.id },
          });

          return jsonResult({
            bundleId,
            campaignId: String(campaignId),
            groupId: group.id,
            groupName: group.name,
            previous: { groupName: previous?.group.name ?? null },
          });
        }

        await prisma.appleAdsCampaignGroupMember.deleteMany({
          where: { appId: resolved.app.id, externalCampaignId: String(campaignId) },
        });

        return jsonResult({
          bundleId,
          campaignId: String(campaignId),
          groupId: null,
          previous: { groupName: previous?.group.name ?? null },
        });
      } catch (err) {
        return adsError("assign_ads_campaign_group", err);
      }
    },
    { summarize: summarizeAssignGroup },
  );
}
