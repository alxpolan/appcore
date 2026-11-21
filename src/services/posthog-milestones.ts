import { queryPostHogHogQL } from "./posthog";

export interface MilestoneDefinition {
  eventName: string;
  minCount: number;
  label: string;
}

export interface MilestoneCompletion extends MilestoneDefinition {
  completed: number;
}

export async function computeMilestoneCompletions(
  host: string,
  apiKey: string,
  projectId: string,
  distinctIds: string[],
  milestones: MilestoneDefinition[],
): Promise<MilestoneCompletion[]> {
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

  return milestones.map((milestone) => {
    const byDistinctId = countsByEvent.get(milestone.eventName);
    const completed = distinctIds.filter((id) => (byDistinctId?.get(id) ?? 0) >= milestone.minCount).length;

    return { ...milestone, completed };
  });
}
