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
// Recruitment pipeline — simplified MVP candidate flow.
// Advertised, Invoiced, and Closed are NOT candidate-application stages.
// ---------------------------------------------------------------------------
export type StageClass = "job" | "candidate" | "accounts";

export interface PipelineStage {
  key: string;
  label: string;
  ordinal: number;
  stageClass: StageClass;
  phase: ApplicationPhase;
  gated?: "accepted_offer";
  /** Historical only — not shown in the move-stage dropdown. */
  legacy?: boolean;
  /** No further stage changes (except viewing). */
  terminal?: boolean;
}

export type ApplicationPhase =
  | "initial_review"
  | "screening"
  | "interviewing"
  | "pre_submission"
  | "submitted"
  | "offer"
  | "placement"
  | "closed";

export const APPLICATION_PHASES: { key: ApplicationPhase; label: string }[] = [
  { key: "initial_review", label: "CV review" },
  { key: "screening", label: "Testing" },
  { key: "interviewing", label: "Interview" },
  { key: "pre_submission", label: "Reference checks" },
  { key: "submitted", label: "Submitted to employer" },
  { key: "offer", label: "Offer" },
  { key: "placement", label: "Placement" },
  { key: "closed", label: "Rejected / closed" },
];

/**
 * Active pipeline. Apply → CV Review automatically.
 * Testing submitted → Test Review automatically.
 * Interview Screening completed → Interview Review automatically.
 * Reference Checks are optional after Interview Review only.
 * Mandatory gates (screening notes, test/interview rules, employer consent,
 * accepted offer) are enforced in advance_application / reject_application.
 * Rejection is permanent and records the stage where it happened.
 */
export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "advertised", label: "Advertised", ordinal: 1, stageClass: "job", phase: "closed" },
  {
    key: "cv_review",
    label: "CV Review",
    ordinal: 2,
    stageClass: "candidate",
    phase: "initial_review",
  },
  { key: "testing", label: "Testing", ordinal: 3, stageClass: "candidate", phase: "screening" },
  {
    key: "test_review",
    label: "Test Review / Grading",
    ordinal: 4,
    stageClass: "candidate",
    phase: "screening",
  },
  {
    key: "interview_screening",
    label: "Interview Screening",
    ordinal: 5,
    stageClass: "candidate",
    phase: "interviewing",
  },
  {
    key: "interview_review",
    label: "Interview Review",
    ordinal: 6,
    stageClass: "candidate",
    phase: "interviewing",
  },
  {
    key: "reference_checks",
    label: "Reference Checks",
    ordinal: 7,
    stageClass: "candidate",
    phase: "pre_submission",
  },
  {
    key: "client_submission",
    label: "Client Submission",
    ordinal: 8,
    stageClass: "candidate",
    phase: "submitted",
  },
  { key: "offer", label: "Offer", ordinal: 9, stageClass: "candidate", phase: "offer" },
  {
    key: "hired",
    label: "Hired",
    ordinal: 10,
    stageClass: "candidate",
    phase: "placement",
    gated: "accepted_offer",
    terminal: true,
  },
  {
    key: "rejected",
    label: "Rejected",
    ordinal: 11,
    stageClass: "candidate",
    phase: "closed",
    terminal: true,
  },
  { key: "invoiced", label: "Invoiced", ordinal: 12, stageClass: "accounts", phase: "placement" },
  { key: "closed", label: "Closed", ordinal: 13, stageClass: "job", phase: "closed" },

  // Legacy keys retained so historical stage history still resolves labels.
  {
    key: "applied_sourced",
    label: "Applied / Sourced",
    ordinal: 102,
    stageClass: "candidate",
    phase: "initial_review",
    legacy: true,
  },
  {
    key: "cv_screening",
    label: "CV Screening",
    ordinal: 103,
    stageClass: "candidate",
    phase: "initial_review",
    legacy: true,
  },
  {
    key: "longlisted",
    label: "Longlisted",
    ordinal: 104,
    stageClass: "candidate",
    phase: "initial_review",
    legacy: true,
  },
  {
    key: "ai_interview_screening",
    label: "AI Interview Screening",
    ordinal: 105,
    stageClass: "candidate",
    phase: "interviewing",
    legacy: true,
  },
  {
    key: "shortlisted",
    label: "Shortlisted",
    ordinal: 106,
    stageClass: "candidate",
    phase: "interviewing",
    legacy: true,
  },
  {
    key: "screening_interview",
    label: "Screening Interview",
    ordinal: 107,
    stageClass: "candidate",
    phase: "interviewing",
    legacy: true,
  },
  {
    key: "client_interview",
    label: "Client Interview",
    ordinal: 108,
    stageClass: "candidate",
    phase: "submitted",
    legacy: true,
  },
];

/** Active candidate stages shown in recruiter controls (excludes legacy + terminal rejected). */
export const CANDIDATE_STAGES = PIPELINE_STAGES.filter(
  (s) => s.stageClass === "candidate" && !s.legacy && s.key !== "rejected",
);

export function stageByKey(key: string): PipelineStage | undefined {
  return PIPELINE_STAGES.find((s) => s.key === key);
}

/** Stages a recruiter may move the candidate to from `current` (forward only). */
export function allowedNextStages(current: string): PipelineStage[] {
  const cur = stageByKey(current);
  if (!cur || cur.stageClass !== "candidate" || cur.terminal || cur.legacy) return [];

  const linear: Record<string, string[]> = {
    cv_review: ["testing"],
    // testing → test_review is automatic via "Mark testing submitted"
    testing: [],
    test_review: ["interview_screening"],
    // interview_screening → interview_review is automatic via "Mark interview complete"
    interview_screening: [],
    interview_review: ["reference_checks", "client_submission"],
    reference_checks: ["client_submission"],
    client_submission: ["offer"],
    offer: ["hired"],
  };

  const keys = new Set<string>(linear[current] ?? []);

  return [...keys]
    .map((k) => stageByKey(k))
    .filter((s): s is PipelineStage => !!s && !s.legacy)
    .sort((a, b) => a.ordinal - b.ordinal);
}

/** Default stage when a candidate applies. */
export const APPLICATION_ENTRY_STAGE = "cv_review";

/** Simplified, candidate-facing status mapping. */
export const CANDIDATE_FACING_STATUS: Record<string, string> = {
  cv_review: "Resume under review",
  testing: "Skills assessment",
  test_review: "Assessment under review",
  interview_screening: "Interview scheduled",
  interview_review: "Interview under review",
  reference_checks: "Reference checks",
  client_submission: "Submitted to employer",
  offer: "Offer stage",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
  closed: "Position closed",
  // legacy
  applied_sourced: "Application received",
  cv_screening: "Resume under review",
  longlisted: "Moved forward after resume review",
  ai_interview_screening: "Interview stage",
  shortlisted: "Shortlisted",
  screening_interview: "Interview stage",
  client_interview: "Employer interview",
};

// ---------------------------------------------------------------------------
// Employer onboarding applications (Workflow 1)
// ---------------------------------------------------------------------------
export const EMPLOYER_APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type EmployerApplicationStatus = (typeof EMPLOYER_APPLICATION_STATUSES)[number];

export const EMPLOYER_APPLICATION_STATUS_LABELS: Record<EmployerApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Structured rejection categories (mirrors the DB check constraint). */
export const EMPLOYER_REJECTION_CATEGORIES = [
  { key: "duplicate_company", label: "Duplicate company" },
  { key: "information_mismatch", label: "Information could not be verified" },
  { key: "ineligible_geography", label: "Geography not currently served" },
  { key: "not_a_genuine_employer", label: "Not a genuine employer" },
  { key: "policy_violation", label: "Policy violation" },
  { key: "other", label: "Other (reason required)" },
] as const;
export type EmployerRejectionCategory = (typeof EMPLOYER_REJECTION_CATEGORIES)[number]["key"];

export const ORGANIZATION_TYPES = [
  { key: "private_company", label: "Private company" },
  { key: "public_company", label: "Public / listed company" },
  { key: "ngo", label: "NGO / non-profit" },
  { key: "government", label: "Government / public sector" },
  { key: "partnership", label: "Partnership" },
  { key: "sole_proprietor", label: "Sole proprietor" },
  { key: "other", label: "Other" },
] as const;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;

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

/** Fields a candidate may approve for recruiter talent-pool discovery (R-012). */
export const SEARCH_APPROVED_FIELDS = [
  { key: "desired_roles", label: "Desired roles" },
  { key: "country_city", label: "Country & city" },
  { key: "skills", label: "Skills" },
  { key: "education_level", label: "Education level" },
  { key: "experience_summary", label: "Experience summary" },
  { key: "languages", label: "Languages" },
  { key: "availability", label: "Availability" },
] as const;

export type SearchApprovedFieldKey = (typeof SEARCH_APPROVED_FIELDS)[number]["key"];

/** Sourced-application contact disposition (R-064). */
export const SOURCED_CONTACT_STATUSES = [
  { key: "not_contacted", label: "Not contacted" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "declined", label: "Declined" },
] as const;

export type SourcedContactStatusKey = (typeof SOURCED_CONTACT_STATUSES)[number]["key"];

/** Common availability phrases used as filter presets. */
export const AVAILABILITY_PRESETS = [
  { key: "Immediately", label: "Immediately" },
  { key: "2 weeks", label: "Within 2 weeks" },
  { key: "1 month", label: "Within 1 month" },
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
/** Derived watermarked previews (optional cache); originals stay in source buckets. */
export const DOCUMENT_PREVIEWS_BUCKET = "document-previews";

// ---------------------------------------------------------------------------
// Language proficiency (Title Case — matches candidate_languages check constraint)
// ---------------------------------------------------------------------------
export const LANGUAGE_PROFICIENCIES = [
  "Basic",
  "Conversational",
  "Professional",
  "Fluent",
  "Native",
] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

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
    title: "Assessments (vendor integration)",
    description:
      "First-party Shugulika junior/senior banks, MCQ keys, free-response rubrics, and assignment delivery are live. Hosted TestGorilla/Central Test (or successor) vendor sync is not enabled.",
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
];

export function placeholdersForPortal(portal: Portal): PlaceholderFeature[] {
  return PLACEHOLDER_FEATURES.filter((f) => f.portals.includes(portal));
}
