import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeSubmissions,
  getLatestSubmission,
  initialPhases,
  setLatestJobId,
  type ActiveSubmission,
} from "../src/services/fastlane-types";

function seedSubmission(overrides: Partial<ActiveSubmission> = {}): ActiveSubmission {
  const submission: ActiveSubmission = {
    jobId: `job-${activeSubmissions.size + 1}`,
    bundleId: "com.example.app",
    logs: [],
    errors: [],
    status: "running",
    startedAt: new Date(),
    action: "screenshots",
    phases: initialPhases("screenshots"),
    ...overrides,
  };

  activeSubmissions.set(submission.jobId, submission);
  setLatestJobId(submission.jobId);

  return submission;
}

describe("submission status persistence", () => {
  it("keeps bundleId, action and phases on the latest submission", () => {
    const seeded = seedSubmission();

    const latest = getLatestSubmission();

    assert.equal(latest?.jobId, seeded.jobId);
    assert.equal(latest?.bundleId, "com.example.app");
    assert.equal(latest?.action, "screenshots");
    assert.deepEqual(latest?.phases, seeded.phases);
  });

  it("still exposes a finished submission so the progress bar survives navigation", () => {
    const seeded = seedSubmission({ status: "completed" });

    const latest = getLatestSubmission();

    assert.equal(latest?.jobId, seeded.jobId);
    assert.equal(latest?.status, "completed");
    assert.equal(latest?.bundleId, "com.example.app");
  });
});
