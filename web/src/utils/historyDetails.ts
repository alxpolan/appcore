export interface HistoryDetailChange {
  label: string;
  from: string | null;
  to: string | null;
}

export type ParsedHistoryDetails =
  | { kind: "changes"; changes: HistoryDetailChange[] }
  | { kind: "addedRemoved"; scope: string | null; added: string[]; removed: string[] }
  | { kind: "raw" };

/** Normalize a history entry's details payload into something the UI can
 * render readably. Unknown and legacy shapes fall back to `{ kind: "raw" }`
 * (rendered as JSON). */
export function parseHistoryDetails(details: unknown): ParsedHistoryDetails {
  const value: unknown = typeof details === "string" ? tryParse(details) : details;
  if (value == null || typeof value !== "object" || Array.isArray(value)) return { kind: "raw" };
  const d = value as Record<string, unknown>;

  if (Array.isArray(d.changes)) {
    const changes = d.changes
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({
        label: typeof c.label === "string" ? c.label : "?",
        from: typeof c.from === "string" ? c.from : null,
        to: typeof c.to === "string" ? c.to : null,
      }));
    if (changes.length > 0) return { kind: "changes", changes };
  }

  if (Array.isArray(d.added) || Array.isArray(d.removed)) {
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return {
      kind: "addedRemoved",
      scope: typeof d.scope === "string" ? d.scope : null,
      added: strings(d.added),
      removed: strings(d.removed),
    };
  }

  return { kind: "raw" };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
