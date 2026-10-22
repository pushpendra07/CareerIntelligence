/** Job statuses and the status tabs, shown as grouped tabs on the Jobs page. */

export const JOB_STATUSES = ["DISCOVERED", "NEW", "REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "APPLIED",
  "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "AWAITING_FEEDBACK", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "ON_HOLD",
  "CLOSED", "NOT_RELEVANT", "IGNORED", "DUPLICATE"];

/** Finished jobs: their own tabs, never in "All open". */
export const FINISHED_STATUSES = ["REJECTED", "WITHDRAWN", "NOT_RELEVANT", "IGNORED", "DUPLICATE", "CLOSED"];
/** Jobs still in play: what "All open" lists, the sum of the To review and In progress tabs. */
export const OPEN_STATUSES = JOB_STATUSES.filter((s) => !FINISHED_STATUSES.includes(s));
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
  { key: "not-pursuing", label: "Not pursuing", statuses: ["WITHDRAWN", "NOT_RELEVANT", "IGNORED", "DUPLICATE"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
];
/** Tabs for finished jobs, shown apart from the active ones. */
export const ARCHIVE_TABS = ["rejected", "not-pursuing", "closed"];

/** The status tabs grouped by stage, as the Jobs page shows them. */
export const JOB_TAB_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Everything", keys: ["all"] },
  { label: "To review", keys: ["new", "pending"] },
  { label: "In progress", keys: ["applied", "interview", "selected"] },
  { label: "Finished", keys: ARCHIVE_TABS },
];

/** The statuses a tab lists when no status is picked: all of its own. */
export const defaultStatuses = (tab: { key: string; statuses: string[] }) => tab.statuses;

/** Where a tab lives: plain /jobs opens New, so All open has its own address. */
export const tabHref = (key: string) => (key === "closed" ? "/jobs/closed" : `/jobs?tab=${key}`);
