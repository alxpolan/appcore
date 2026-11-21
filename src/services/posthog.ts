import axios from "./utils/http";

export interface PostHogProjectOption {
  projectId: string;
  projectName: string;
  organizationName: string;
}

interface PostHogOrganization {
  id: string;
  name: string;
}

interface PostHogProject {
  id: number;
  name: string;
}

interface PostHogPaginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export function normalizePostHogHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, "");

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("PostHog host must start with http:// or https://");
  }

  return trimmed;
}

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function listPostHogProjects(host: string, apiKey: string): Promise<PostHogProjectOption[]> {
  const base = normalizePostHogHost(host);

  const orgsRes = await axios.get<PostHogPaginated<PostHogOrganization>>(`${base}/api/organizations/`, {
    headers: authHeaders(apiKey),
  });

  const options: PostHogProjectOption[] = [];

  for (const org of orgsRes.data.results) {
    const projectsRes = await axios.get<PostHogPaginated<PostHogProject>>(
      `${base}/api/organizations/${org.id}/projects/`,
      { headers: authHeaders(apiKey) },
    );

    for (const project of projectsRes.data.results) {
      options.push({
        projectId: String(project.id),
        projectName: project.name,
        organizationName: org.name,
      });
    }
  }

  if (options.length === 0) {
    throw new Error("No PostHog projects are visible to this API key");
  }

  return options;
}

export interface PostHogHogQLResult {
  columns: unknown[];
  results: unknown[][];
}

export async function queryPostHogHogQL(
  host: string,
  apiKey: string,
  projectId: string,
  hogql: string,
  values: Record<string, unknown>,
): Promise<PostHogHogQLResult> {
  const base = normalizePostHogHost(host);

  const res = await axios.post<{ columns: unknown[]; results: unknown[][] }>(
    `${base}/api/projects/${projectId}/query/`,
    { query: { kind: "HogQLQuery", query: hogql, values } },
    { headers: authHeaders(apiKey) },
  );

  return { columns: res.data.columns ?? [], results: res.data.results ?? [] };
}
