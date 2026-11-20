export interface SnapshotJobResult {
  ok: boolean;
  logs: string[];
  errors: string[];
  screenshots: Record<string, Array<{ filename: string; data: string }>>;
  descriptions: Record<string, string>;
  config: Record<string, string>;
  xcresultLogs?: Array<{ filename: string; sizeBytes: number }>;
}
