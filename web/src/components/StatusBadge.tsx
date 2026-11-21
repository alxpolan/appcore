import { badgeOutline } from "../styles";

const STATE_SHORT: Record<string, string> = {
  APPROVED: "Approved",
  READY_TO_SUBMIT: "Ready",
  MISSING_METADATA: "Missing Metadata",
  WAITING_FOR_REVIEW: "In Review Queue",
  IN_REVIEW: "In Review",
  REJECTED: "Rejected",
  DEVELOPER_ACTION_NEEDED: "Action Needed",
  DEVELOPER_REMOVED_FROM_SALE: "Removed",
  REMOVED_FROM_SALE: "Removed",
  PENDING_BINARY_APPROVAL: "Pending",
};

export function StatusBadge({ state }: { state: string }) {
  const label = STATE_SHORT[state] ?? state;
  const isApproved = state === "APPROVED" || state === "READY_TO_SUBMIT";
  const isError = state === "REJECTED" || state === "DEVELOPER_ACTION_NEEDED";
  const isWarning = state === "MISSING_METADATA";
  const variant = isApproved ? "success_tonal" : isError ? "danger_tonal" : isWarning ? "warning_tonal" : "info_tonal";

  return <span className={badgeOutline(variant)}>{label}</span>;
}
