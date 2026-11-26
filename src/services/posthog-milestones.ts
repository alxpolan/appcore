import { queryPostHogHogQL } from "./posthog";

export interface MilestoneDefinition {
  eventName: string;
  minCount: number;
  label: string;
  splitByVariant?: boolean;
}

export interface MilestoneCompletion extends MilestoneDefinition {
  completed: number;
}

export interface MilestoneVariant {
  key: string;
  label: string;
  flagKey: string;
  flagValue: string;
}

export interface VariantBreakdown {
  key: string;
  label: string;
  totalInstalls: number;
  completed: number[];
  funnel: (number | null)[];
}

export function normalizeFlagValue(value: unknown): string {
  return String(value ?? "").trim();
}

export function pickVariantUsers(
  rows: Array<{ distinctId: string; response: unknown }>,
  flagValue: string,
): string[] {
  const votes = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!row.distinctId) continue;

    const response = normalizeFlagValue(row.response);

    if (!response) continue;

    const userVotes = votes.get(row.distinctId) ?? new Map<string, number>();

    userVotes.set(response, (userVotes.get(response) ?? 0) + 1);
    votes.set(row.distinctId, userVotes);
  }

  const target = normalizeFlagValue(flagValue);
  const matched: string[] = [];

  for (const [distinctId, userVotes] of votes) {
    let best = "";
    let bestCount = -1;

    for (const [response, count] of userVotes) {
      if (count > bestCount) {
        best = response;
        bestCount = count;
      }
    }

    if (best === target) matched.push(distinctId);
  }

  return matched;
}

export function funnelRates(completed: number[]): (number | null)[] {
  return completed.map((count, i) => {
    if (i === 0) return null;

    const previous = completed[i - 1];

    if (previous <= 0) return null;

    return count / previous;
  });
}

export interface VariantAssignment {
  byVariant: Map<string, string[]>;
  exposed: string[];
}

export function splitUnassigned(
  distinctIds: string[],
  exposed: string[],
  assigned: Set<string>,
): { other: string[]; none: string[] } {
  const exposedSet = new Set(exposed);
  const other: string[] = [];
  const none: string[] = [];

  for (const id of distinctIds) {
    if (assigned.has(id)) continue;

    if (exposedSet.has(id)) other.push(id);
    else none.push(id);
  }

  return { other, none };
}

export async function resolveVariantUsers(
  host: string,
  apiKey: string,
  projectId: string,
  distinctIds: string[],
  variants: MilestoneVariant[],
): Promise<VariantAssignment> {
  const byFlagKey = new Map<string, MilestoneVariant[]>();

  for (const variant of variants) {
    const group = byFlagKey.get(variant.flagKey) ?? [];

    group.push(variant);
    byFlagKey.set(variant.flagKey, group);
  }

  const resolved = new Map<string, string[]>();
  const exposed = new Set<string>();

  for (const [flagKey, group] of byFlagKey) {
    const { results } = await queryPostHogHogQL(
      host,
      apiKey,
      projectId,
      "SELECT distinct_id, properties.$feature_flag_response AS resp FROM events WHERE event = '$feature_flag_called' AND properties.$feature_flag = {flagKey} AND distinct_id IN {distinctIds} LIMIT 100000",
      { flagKey, distinctIds },
    );

    const rows = results.map((row) => {
      const [distinctId, response] = row as [string, unknown];

      if (typeof distinctId === "string" && distinctId) exposed.add(distinctId);

      return { distinctId, response };
    });

    for (const variant of group) {
      resolved.set(variant.key, pickVariantUsers(rows, variant.flagValue));
    }
  }

  return { byVariant: resolved, exposed: [...exposed] };
}

export function buildBreakdowns(
  milestones: MilestoneDefinition[],
  countsByEvent: Map<string, Map<string, number>>,
  groups: Array<{ key: string; label: string; distinctIds: string[] }>,
): VariantBreakdown[] {
  return groups.map((group) => {
    const completed = milestones.map((milestone) => {
      const byDistinctId = countsByEvent.get(milestone.eventName);

      return group.distinctIds.filter((id) => (byDistinctId?.get(id) ?? 0) >= milestone.minCount).length;
    });

    return {
      key: group.key,
      label: group.label,
      totalInstalls: group.distinctIds.length,
      completed,
      funnel: funnelRates(completed),
    };
  });
}

export async function computeMilestoneCompletions(
  host: string,
  apiKey: string,
  projectId: string,
  distinctIds: string[],
  milestones: MilestoneDefinition[],
  variants: MilestoneVariant[] = [],
): Promise<{ milestones: MilestoneCompletion[]; variants: VariantBreakdown[] }> {
  const eventNames = [...new Set(milestones.map((m) => m.eventName))];

  const { results } = await queryPostHogHogQL(
    host,
    apiKey,
    projectId,
    "SELECT distinct_id, event, count() AS cnt FROM events WHERE event IN {eventNames} AND distinct_id IN {distinctIds} GROUP BY distinct_id, event LIMIT 100000",
    { eventNames, distinctIds },
  );

  const countsByEvent = new Map<string, Map<string, number>>();

  for (const row of results) {
    const [distinctId, event, cnt] = row as [string, string, number];
    const byDistinctId = countsByEvent.get(event) ?? new Map<string, number>();

    byDistinctId.set(distinctId, cnt);
    countsByEvent.set(event, byDistinctId);
  }

  const completed = milestones.map((milestone) => {
    const byDistinctId = countsByEvent.get(milestone.eventName);

    return {
      ...milestone,
      completed: distinctIds.filter((id) => (byDistinctId?.get(id) ?? 0) >= milestone.minCount).length,
    };
  });

  if (variants.length === 0) return { milestones: completed, variants: [] };

  const assignment = await resolveVariantUsers(host, apiKey, projectId, distinctIds, variants);
  const assigned = new Set<string>();

  for (const ids of assignment.byVariant.values()) {
    for (const id of ids) assigned.add(id);
  }

  const { other, none } = splitUnassigned(distinctIds, assignment.exposed, assigned);
  const breakdowns = buildBreakdowns(milestones, countsByEvent, [
    ...variants.map((variant) => ({
      key: variant.key,
      label: variant.label,
      distinctIds: assignment.byVariant.get(variant.key) ?? [],
    })),
    { key: "__other", label: "Andere Variante", distinctIds: other },
    { key: "__none", label: "Ohne Flag-Event", distinctIds: none },
  ]);

  return { milestones: completed, variants: breakdowns };
}
