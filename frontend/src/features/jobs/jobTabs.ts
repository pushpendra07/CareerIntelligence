/** Job statuses and the status tabs, shared by the Jobs page and the sidebar menu. */

export const JOB_STATUSES = ["DISCOVERED", "NEW", "REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "APPLIED",
  "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "AWAITING_FEEDBACK", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "ON_HOLD",
  "CLOSED", "NOT_RELEVANT"];

export const OPEN_STATUSES = JOB_STATUSES.filter((s) => s !== "CLOSED");
export const NEW_STATUSES = ["NEW", "DISCOVERED"];
export const PENDING_STATUSES = ["REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "ON_HOLD"];
export const APPLIED_STATUSES = ["APPLIED", "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "AWAITING_FEEDBACK"];

/** Status tabs: every job is in exactly one tab (plus "All open"). */
export const JOB_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All open", statuses: OPEN_STATUSES },
  { key: "new", label: "New", statuses: NEW_STATUSES },
  { key: "pending", label: "Pending", statuses: PENDING_STATUSES },
  { key: "applied", label: "Applied", statuses: ["APPLIED", "RECRUITER_CONTACTED", "SCREENING"] },
  { key: "interview", label: "Interview", statuses: ["INTERVIEW", "AWAITING_FEEDBACK"] },
  { key: "selected", label: "Selected", statuses: ["OFFER", "ACCEPTED"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
  { key: "not-pursuing", label: "Not pursuing", statuses: ["WITHDRAWN", "NOT_RELEVANT"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
];
/** Tabs for finished jobs, shown apart from the active ones. */
export const ARCHIVE_TABS = ["rejected", "not-pursuing", "closed"];

/** Shown only when picked in the Status filter (or in their own tab), like Closed jobs. */
export const HIDDEN_BY_DEFAULT = ["APPLIED", "REJECTED", "NOT_RELEVANT"];

/** The statuses a tab lists when no status is picked. */
export const defaultStatuses = (tab: { key: string; statuses: string[] }) =>
  tab.key === "all" ? tab.statuses.filter((s) => !HIDDEN_BY_DEFAULT.includes(s)) : tab.statuses;

/** Where a tab lives: plain /jobs opens New, so All open has its own address. */
export const tabHref = (key: string) => (key === "closed" ? "/jobs/closed" : `/jobs?tab=${key}`);
