import { EventEmitter } from "events";

export interface SnapshotJobState {
  logs: string[];
  result: SnapshotJobResult | null;
  emitter: EventEmitter;
}

export interface SnapshotJobResult {
  ok: boolean;
  logs: string[];
  errors: string[];
  screenshots: Record<string, Array<{ filename: string; data: string }>>;
  descriptions: Record<string, string>;
  config: Record<string, string>;
  xcresultLogs?: Array<{ filename: string; sizeBytes: number }>;
}

const activeJobs = new Map<string, SnapshotJobState>();

export function createSnapshotJob(runId: string): {
  emit: (line: string) => void;
  finish: (result: SnapshotJobResult) => void;
} {
  const state: SnapshotJobState = { logs: [], result: null, emitter: new EventEmitter() };

  state.emitter.setMaxListeners(50);
  activeJobs.set(runId, state);

  const cleanup = setTimeout(() => activeJobs.delete(runId), 10 * 60 * 1000);

  cleanup.unref?.();

  return {
    emit(line: string) {
      state.logs.push(line);
      state.emitter.emit("line", line);
    },
    finish(result: SnapshotJobResult) {
      state.result = result;
      state.emitter.emit("result", result);
    },
  };
}

export function getSnapshotJob(runId: string): SnapshotJobState | undefined {
  return activeJobs.get(runId);
}
