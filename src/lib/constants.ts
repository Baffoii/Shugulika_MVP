/**
 * Centralized platform constants. Nothing about pipeline stages, statuses,
 * roles, rejection reasons, document types, or placeholder-feature status is
 * hardcoded in components — everything reads from here so it stays consistent
 * with the Shugulika workflow documents and the database seed.
 */

// ---------------------------------------------------------------------------
// Roles & portals
// ---------------------------------------------------------------------------
export const ROLES = [
  "candidate",
  "recruiter",
  "employer_user",
  "franchise_admin",
  "hq_admin",
  "operations",
  "accounts",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles a member of the public may self-register as. Everything else is invite-only. */
export const PUBLIC_SIGNUP_ROLES: Role[] = ["candidate", "employer_user"];

/** Privileged roles that must be provisioned by an authorized administrator. */
export const PRIVILEGED_ROLES: Role[] = [
  "recruiter",
  "franchise_admin",
  "hq_admin",
  "operations",
  "accounts",
];

export const ROLE_LABELS: Record<Role, string> = {
  candidate: "Candidate",
  recruiter: "Recruiter",
  employer_user: "Employer",
  franchise_admin: "Franchise Admin",
  hq_admin: "HQ Admin",
  operations: "Operations",
  accounts: "Accounts",
};

export type Portal = "candidate" | "recruiter" | "employer" | "franchise" | "hq";

/** Default landing portal per role. */
export const ROLE_HOME: Record<Role, string> = {
  candidate: "/candidate/dashboard",
  recruiter: "/recruiter/dashboard",
  employer_user: "/employer/dashboard",
  franchise_admin: "/franchise/dashboard",
  hq_admin: "/hq/dashboard",
  operations: "/franchise/dashboard",
  accounts: "/franchise/billing",
};

/** Which roles may enter which portal. Enforced in guards AND (via memberships) in RLS. */
export const PORTAL_ROLES: Record<Portal, Role[]> = {
  candidate: ["candidate"],
  recruiter: ["recruiter", "hq_admin", "franchise_admin", "operations"],
  employer: ["employer_user"],
  franchise: ["franchise_admin", "hq_admin", "operations", "accounts"],
  hq: ["hq_admin"],
};

// ---------------------------------------------------------------------------
// Recruitment pipeline — the 15-stage "Spine" (job/candidate/accounts classes).
// Advertised, Invoiced, and Closed are NOT candidate-application stages.
// ---------------------------------------------------------------------------
export type StageClass = "job" | "candidate" | "accounts";

export interface PipelineStage {
  key: string;
  label: string;
  ordinal: number;
  stageClass: StageClass;
  phase: ApplicationPhase; // grouping for the UI
  gated?: "screening_scorecard" | "employer_consent" | "accepted_offer";
}

export type ApplicationPhase =
  | "new"
  | "initial_review"
  | "screening"
  | "shortlisting"
  | "consent_pending"
  | "ready_for_submission"
  | "submitted"
  | "employer_review"
  | "interviewing"
  | "offer"
  | "placement"
  | "closed";

export const APPLICATION_PHASES: { key: ApplicationPhase; label: string }[] = [
  { key: "new", label: "New & unreviewed" },
  { key: "initial_review", label: "Initial review" },
  { key: "screening", label: "Screening" },
  { key: "shortlisting", label: "Shortlisting" },
  { key: "consent_pending", label: "Consent pending" },
  { key: "ready_for_submission", label: "Ready for submission" },
  { key: "submitted", label: "Submitted to employer" },
  { key: "employer_review", label: "Employer review" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "placement", label: "Placement" },
  { key: "closed", label: "Rejected / withdrawn / closed" },
];

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "advertised", label: "Advertised", ordinal: 1, stageClass: "job", phase: "new" },
  {
    key: "applied_sourced",
    label: "Applied / Sourced",
    ordinal: 2,
    stageClass: "candidate",
    phase: "new",
  },
  {
    key: "cv_screening",
    label: "CV Screening",
    ordinal: 3,
    stageClass: "candidate",
    phase: "initial_review",
  },
  {
    key: "longlisted",
    label: "Longlisted",
    ordinal: 4,
    stageClass: "candidate",
    phase: "initial_review",
  },
  {
    key: "ai_interview_screening",
    label: "AI Interview Screening",
    ordinal: 5,
    stageClass: "candidate",
    phase: "screening",
  },
  {
    key: "shortlisted",
    label: "Shortlisted",
    ordinal: 6,
    stageClass: "candidate",
    phase: "shortlisting",
    gated: "screening_scorecard",
  },
  {
    key: "screening_interview",
    label: "Screening Interview",
    ordinal: 7,
    stageClass: "candidate",
    phase: "screening",
  },
  { key: "testing", label: "Testing", ordinal: 8, stageClass: "candidate", phase: "screening" },
  {
    key: "reference_checks",
    label: "Reference Checks",
    ordinal: 9,
    stageClass: "candidate",
    phase: "shortlisting",
  },
  {
    key: "client_submission",
    label: "Client Submission",
    ordinal: 10,
    stageClass: "candidate",
    phase: "submitted",
    gated: "employer_consent",
  },
  {
    key: "client_interview",
    label: "Client Interview",
    ordinal: 11,
    stageClass: "candidate",
    phase: "interviewing",
  },
  { key: "offer", label: "Offer", ordinal: 12, stageClass: "candidate", phase: "offer" },
  {
    key: "hired",
    label: "Hired",
    ordinal: 13,
    stageClass: "candidate",
    phase: "placement",
    gated: "accepted_offer",
  },
  { key: "invoiced", label: "Invoiced", ordinal: 14, stageClass: "accounts", phase: "placement" },
  { key: "closed", label: "Closed", ordinal: 15, stageClass: "job", phase: "closed" },
];

export const CANDIDATE_STAGES = PIPELINE_STAGES.filter((s) => s.stageClass === "candidate");

export function stageByKey(key: string): PipelineStage | undefined {
  return PIPELINE_STAGES.find((s) => s.key === key);
}

/** Simplified, candidate-facing status mapping (less internally technical). */
export const CANDIDATE_FACING_STATUS: Record<string, string> = {
  applied_sourced: "Application received",
  cv_screening: "Resume under review",
  longlisted: "Moved forward after resume review",
  ai_interview_screening: "Video interview stage",
  shortlisted: "Shortlisted",
  screening_interview: "Live screening interview",
  testing: "Skills assessment",
  reference_checks: "Reference checks",
  client_submission: "Submitted to employer",
  client_interview: "Employer interview",
  offer: "Offer stage",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
  closed: "Position closed",
};

// ---------------------------------------------------------------------------
// Job order / posting statuses
// ---------------------------------------------------------------------------
export const JOB_ORDER_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "active",
  "on_hold",
  "filled",
  "partially_filled",
  "cancelled",
  "closed",
] as const;
export type JobOrderStatus = (typeof JOB_ORDER_STATUSES)[number];

export const JOB_POSTING_STATUSES = [
  "draft",
  "pending_approval",
  "advertised",
  "paused",
  "expired",
  "unpublished",
] as const;
export type JobPostingStatus = (typeof JOB_POSTING_STATUSES)[number];

export const RECRUITMENT_PATHS = [
  {
    key: "A",
    label: "Direct employer",
    description: "Applications go straight to the employer's hiring team.",
  },
  {
    key: "B",
    label: "Shugulika-managed",
    description: "A recruiter screens candidates and submits a shortlist.",
  },
] as const;
export type RecruitmentPath = (typeof RECRUITMENT_PATHS)[number]["key"];

export const EMPLOYMENT_TYPES = [
  { key: "full_time", label: "Full-time" },
  { key: "part_time", label: "Part-time" },
  { key: "contract", label: "Contract" },
  { key: "internship", label: "Internship" },
] as const;

export const WORK_ARRANGEMENTS = [
  { key: "on_site", label: "On-site" },
  { key: "hybrid", label: "Hybrid" },
  { key: "remote", label: "Remote" },
] as const;

export const EXPERIENCE_LEVELS = [
  { key: "entry", label: "Entry level" },
  { key: "mid", label: "Mid level" },
  { key: "senior", label: "Senior" },
  { key: "lead", label: "Lead / Manager" },
  { key: "exec", label: "Executive" },
] as const;

// ---------------------------------------------------------------------------
// Submission / offer / interview / invoice statuses
// ---------------------------------------------------------------------------
export const SUBMISSION_STATUSES = [
  "consent_pending",
  "submitted",
  "viewed",
  "shortlisted",
  "interview_requested",
  "offered",
  "rejected",
  "withdrawn",
  "access_revoked",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const OFFER_STATUSES = [
  "preparing",
  "sent",
  "negotiating",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const INTERVIEW_STATUSES = [
  "requested",
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_TYPES = [
  { key: "phone_screen", label: "Phone screening" },
  { key: "recruiter", label: "Recruiter interview" },
  { key: "employer", label: "Employer interview" },
  { key: "live_video", label: "Live video" },
  { key: "in_person", label: "In person" },
  // Legacy database key retained for compatibility; the first-party MVP does
  // not perform AI analysis or automated judgment.
  { key: "ai_async", label: "Asynchronous video" },
] as const;

// ---------------------------------------------------------------------------
// Asynchronous video interviews (migrations 0016–0019)
// ---------------------------------------------------------------------------
export const INTERVIEW_ASSIGNMENT_STATUSES = [
  { key: "draft", label: "Draft" },
  { key: "invited", label: "Invited" },
  { key: "in_progress", label: "In progress" },
  { key: "submitted", label: "Submitted" },
  { key: "reviewed", label: "Reviewed" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type InterviewAssignmentStatusKey = (typeof INTERVIEW_ASSIGNMENT_STATUSES)[number]["key"];

export function interviewStatusLabel(key: string): string {
  return INTERVIEW_ASSIGNMENT_STATUSES.find((s) => s.key === key)?.label ?? key;
}

/** Recruiter-facing review badge for submitted vs reviewed interviews. */
export function interviewReviewBadge(status: string): {
  label: string;
  tone: "danger" | "success" | "brand" | "neutral" | "warn" | "info";
} {
  if (status === "submitted") return { label: "Not reviewed", tone: "danger" };
  if (status === "reviewed") return { label: "Reviewed", tone: "success" };
  if (status === "in_progress") return { label: "In progress", tone: "warn" };
  if (status === "invited") return { label: "Invited", tone: "info" };
  if (status === "expired" || status === "cancelled") {
    return { label: interviewStatusLabel(status), tone: "neutral" };
  }
  return { label: interviewStatusLabel(status), tone: "neutral" };
}

/** Submitted/reviewed interviews should lead the application workspace main column. */
export function hasInterviewSpotlight(assignments: ReadonlyArray<{ status: string }>): boolean {
  return assignments.some((a) => a.status === "submitted" || a.status === "reviewed");
}

/** MVP cost controls — mirrored by database CHECK constraints and triggers. */
export const INTERVIEW_LIMITS = {
  /** Hard cap on questions per template (DB trigger enforces too). */
  maxQuestions: 15,
  /** Max preparation countdown per question (seconds). */
  maxPreparationSeconds: 600,
  /** Min/max recording length per response (seconds). */
  minResponseSeconds: 10,
  maxResponseSeconds: 300,
  /** Attempt cap per question (1 = no retries). */
  maxAttempts: 5,
  /** Suggested assignment deadline window (days). */
  minDeadlineDays: 1,
  maxDeadlineDays: 90,
  /** Extra hours after deadline for an already-started session to finish. */
  maxExpirationGraceHours: 72,
  /** Max upload size per recording (bytes) — also enforced by the bucket. */
  maxUploadBytes: 104_857_600,
  /** Recording target: 720p, modest bitrate to control storage cost. */
  videoWidth: 1280,
  videoHeight: 720,
  videoBitsPerSecond: 1_200_000,
  audioBitsPerSecond: 96_000,
} as const;

/** localStorage key prefix for continuous interview session tokens. */
export const INTERVIEW_SESSION_TOKEN_KEY = "shugulika.interview.session";

/** Version stamps stored with each consent record. */
export const INTERVIEW_PRIVACY_NOTICE_VERSION = "2026-07-v1";
export const INTERVIEW_INSTRUCTIONS_VERSION = "2026-07-v1";

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "voided",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Rejection reasons (from the recruiter & employer workflow docs)
// ---------------------------------------------------------------------------
export const REJECTION_REASONS = [
  { key: "min_experience", label: "Does not meet minimum experience" },
  { key: "missing_skill", label: "Missing required skill" },
  { key: "education_mismatch", label: "Education / certification mismatch" },
  { key: "location_mobility", label: "Location or mobility mismatch" },
  { key: "work_authorization", label: "Work authorization issue" },
  { key: "salary_misaligned", label: "Salary expectations misaligned" },
  { key: "assessment_result", label: "Assessment result" },
  { key: "interview_outcome", label: "Interview outcome" },
  { key: "reference_concern", label: "Reference concern" },
  { key: "client_decision", label: "Client decision" },
  { key: "candidate_withdrew", label: "Candidate withdrew" },
  { key: "candidate_unreachable", label: "Candidate unreachable" },
  { key: "duplicate", label: "Duplicate application" },
  { key: "role_filled", label: "Role filled or cancelled" },
  { key: "other", label: "Other (note required)" },
] as const;

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------
export const DOCUMENT_TYPES = [
  { key: "cv", label: "CV / Resume", accept: ".pdf,.doc,.docx", maxMb: 15 },
  { key: "cover_letter", label: "Cover letter", accept: ".pdf,.doc,.docx", maxMb: 10 },
  { key: "certificate", label: "Certificate", accept: ".pdf,.jpg,.png", maxMb: 15 },
  { key: "id_document", label: "Identity document", accept: ".pdf,.jpg,.png", maxMb: 15 },
  { key: "transcript", label: "Academic transcript", accept: ".pdf", maxMb: 15 },
  { key: "portfolio", label: "Portfolio / work sample", accept: ".pdf,.jpg,.png", maxMb: 25 },
] as const;
export type DocumentTypeKey = (typeof DOCUMENT_TYPES)[number]["key"];
export const CANDIDATE_DOC_BUCKET = "candidate-documents";

// ---------------------------------------------------------------------------
// Consent purposes (granular, timestamped — never one vague checkbox)
// ---------------------------------------------------------------------------
export const CONSENT_PURPOSES = [
  { key: "profile_processing", label: "Allow Shugulika to process my profile", special: false },
  {
    key: "searchable_fields",
    label: "Allow authorized recruiters to discover my approved profile fields",
    special: false,
  },
  {
    key: "employer_submission",
    label: "Allow submission of my profile to a specific employer",
    special: false,
    requiresRecipient: true,
  },
  {
    key: "share_document",
    label: "Share my selected CV / documents for this application",
    special: false,
  },
  {
    key: "whatsapp",
    label: "Send me WhatsApp recruitment updates (not enabled yet)",
    special: false,
  },
] as const;

// ---------------------------------------------------------------------------
// Countries (Tanzania active for the pilot; others reserved / illustrative)
// ---------------------------------------------------------------------------
export const COUNTRIES = [
  { code: "TZ", name: "Tanzania", active: true, currency: "TZS" },
  { code: "KE", name: "Kenya", active: false, currency: "KES" },
  { code: "GH", name: "Ghana", active: false, currency: "GHS" },
] as const;

// ---------------------------------------------------------------------------
// Placeholder / later-phase integrations. Rendered as consistent "coming soon"
// cards; actions are disabled and never fake a completed result.
// ---------------------------------------------------------------------------
export type PlaceholderStatus = "coming_soon" | "integration_pending" | "not_enabled";

export const PLACEHOLDER_STATUS_LABELS: Record<PlaceholderStatus, string> = {
  coming_soon: "Coming soon",
  integration_pending: "Integration pending",
  not_enabled: "Not enabled in this MVP",
};

export interface PlaceholderFeature {
  key: string;
  title: string;
  description: string;
  status: PlaceholderStatus;
  portals: Portal[];
}

export const PLACEHOLDER_FEATURES: PlaceholderFeature[] = [
  {
    key: "ai_video_interview",
    title: "AI interview analysis",
    description:
      "Automated analysis of recorded video interviews. First-party async recording is live under Interviews; AI scoring is not enabled.",
    status: "not_enabled",
    portals: ["recruiter", "employer", "hq"],
  },
  {
    key: "ai_questions",
    title: "AI-generated interview questions",
    description: "Job-specific question sets generated from the role and competencies.",
    status: "coming_soon",
    portals: ["recruiter"],
  },
  {
    key: "ai_analysis",
    title: "Automated interview analysis",
    description: "Machine analysis of interview responses, always reviewed by a human before use.",
    status: "not_enabled",
    portals: ["recruiter"],
  },
  {
    key: "assessments",
    title: "Assessments (TestGorilla / Central Test)",
    description: "Skills and psychometric assessments via an integrated provider.",
    status: "integration_pending",
    portals: ["recruiter", "candidate", "employer"],
  },
  {
    key: "ai_matching",
    title: "AI candidate matching",
    description:
      "Assistive ranking of candidates against a role. Never replaces recruiter judgement.",
    status: "coming_soon",
    portals: ["recruiter", "employer"],
  },
  {
    key: "candidate_video",
    title: "Candidate introduction videos",
    description: "Short candidate intro clips attached to the profile.",
    status: "not_enabled",
    portals: ["candidate", "recruiter"],
  },
  {
    key: "whatsapp",
    title: "WhatsApp channel",
    description: "WhatsApp applications, notifications, and recruiter conversations.",
    status: "integration_pending",
    portals: ["candidate", "recruiter", "employer"],
  },
  {
    key: "sms_otp",
    title: "SMS OTP verification",
    description: "Phone verification by one-time SMS code. Email verification is used meanwhile.",
    status: "integration_pending",
    portals: ["candidate"],
  },
  {
    key: "payments",
    title: "Live payment processing",
    description: "Card and mobile-money processing for package purchases and invoices.",
    status: "not_enabled",
    portals: ["employer", "franchise", "hq"],
  },
  {
    key: "recurring_billing",
    title: "Recurring subscription billing",
    description: "Automatic renewal and trial-to-paid conversion.",
    status: "not_enabled",
    portals: ["employer", "franchise", "hq"],
  },
  {
    key: "accounting_sync",
    title: "Accounting synchronization",
    description: "Sync invoices and payments to an external accounting system.",
    status: "not_enabled",
    portals: ["franchise", "hq"],
  },
  {
    key: "social_publishing",
    title: "Social & external job publishing",
    description: "Automated posting to LinkedIn, Facebook, Instagram, X and external boards.",
    status: "coming_soon",
    portals: ["recruiter", "employer", "hq"],
  },
  {
    key: "advanced_analytics",
    title: "Advanced analytics",
    description: "Cohort analysis, KPI targets, and placement-quality scoring.",
    status: "coming_soon",
    portals: ["franchise", "hq"],
  },
  {
    key: "whistleblowing",
    title: "Whistleblowing case management",
    description: "Confidential, restricted-access case intake and management.",
    status: "coming_soon",
    portals: ["hq"],
  },
  {
    key: "watermarking",
    title: "Automated document watermarking",
    description: "Server-side watermarked, view-only CV previews for employers.",
    status: "integration_pending",
    portals: ["recruiter", "employer"],
  },
];

export function placeholdersForPortal(portal: Portal): PlaceholderFeature[] {
  return PLACEHOLDER_FEATURES.filter((f) => f.portals.includes(portal));
}
