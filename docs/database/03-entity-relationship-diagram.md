# 03 — Entity-Relationship Diagrams

Diagrams are split by domain for readability, preceded by a high-level map showing how the domains connect. Mermaid `erDiagram` notation. Relationship crow's-feet: `||--o{` = one-to-many, `||--||` = one-to-one, `}o--o{` = many-to-many (via a join table shown explicitly).

Full column lists are in `04-data-dictionary.md`; these diagrams show keys and principal relationships only.

---

## 0. High-level domain map

```mermaid
flowchart TB
  subgraph IDN[Identity & Access]
    UP[user_profiles]
  end
  subgraph ORG[Organizations & Membership]
    O[organizations]
    OM[organization_memberships]
  end
  subgraph REF[Reference & Config]
    RF[lookups / config]
  end
  subgraph CAND[Candidate Global Identity]
    C[candidates]
  end
  subgraph DOC[Documents & Media]
    D[documents]
  end
  subgraph VRF[Verification]
    V[verifications]
  end
  subgraph EMP[Employers]
    E[employer_organizations]
  end
  subgraph BILL[Packages & Billing]
    PK[packages]
    INV[invoices]
  end
  subgraph JOB[Jobs]
    JO[job_orders]
    JP[job_postings]
  end
  subgraph APP[Applications & Pipeline]
    A[applications]
  end
  subgraph SUB[Employer Submissions]
    S[candidate_submissions]
  end
  subgraph INT[Interviews]
    I[interviews]
  end
  subgraph AI[AI Video Interviews]
    AIS[ai_interview_sessions]
  end
  subgraph OFF[Offers & Placements]
    OF[offers]
    PL[placements]
  end
  subgraph COM[Communications]
    M[messages]
  end
  subgraph CON[Consent]
    CR[consent_records]
  end
  subgraph AUD[Audit / Privacy / Compliance]
    AL[audit_log]
  end

  UP --> OM --> O
  O --> E
  UP -.self-register.-> C
  C --> D
  C --> V
  E --> JO --> JP
  E --> PK
  C --> A --> JO
  A --> S --> E
  A --> I
  A --> AIS
  A --> OF --> PL --> INV
  C --> CR
  S --> CR
  A -.notifications.-> M
  C -.opt-in.-> M
  ALL_DOMAINS -.writes.-> AL
  REF -.configures.-> JOB
  REF -.configures.-> APP
```

*(`ALL_DOMAINS` is illustrative: audit is written from every domain.)*

**Reading the spine:** `candidates` → `applications` → `job_orders`; Path B adds `candidate_submissions` → `employer_organizations`; success flows `offers` → `placements` → `invoices`. Consent gates the `candidate_submissions` edge. Search (Ring 2) and dashboards are derived, not shown.

---

## 1. Identity, Organizations & Membership

```mermaid
erDiagram
  AUTH_USERS ||--|| USER_PROFILES : "id = id"
  USER_PROFILES ||--o{ ORGANIZATION_MEMBERSHIPS : has
  ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : has
  ORGANIZATION_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : assigns
  ROLES ||--o{ MEMBERSHIP_ROLES : used_in
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : in
  ORGANIZATIONS ||--o{ ORGANIZATIONS : parent_of
  ORGANIZATIONS ||--o{ ORGANIZATION_RELATIONSHIPS : from
  ORGANIZATIONS ||--o{ ORGANIZATION_ADDRESSES : has
  ORGANIZATIONS ||--o{ ORGANIZATION_CONTACTS : has
  ORGANIZATIONS ||--o| FRANCHISE_PROFILES : detail
  ORGANIZATIONS ||--o| EMPLOYER_ORGANIZATIONS : detail
  ORGANIZATIONS ||--o| HQ_PROFILES : detail
  COUNTRIES ||--o{ ORGANIZATIONS : located_in
  USER_PROFILES ||--o{ USER_INVITATIONS : invited_by
  ORGANIZATIONS ||--o{ USER_INVITATIONS : into
  SERVICE_ACTORS ||--o{ AUDIT_LOG : acts

  USER_PROFILES {
    uuid id PK "= auth.users.id"
    citext email
    text full_name
    text account_status
    text preferred_language
    text time_zone
    uuid country_id FK
    bool mfa_enabled
  }
  ORGANIZATIONS {
    uuid id PK
    text organization_type
    text legal_name
    text status
    uuid country_id FK
    uuid parent_organization_id FK
  }
  ORGANIZATION_MEMBERSHIPS {
    uuid id PK
    uuid user_id FK
    uuid organization_id FK
    date starts_on
    date ends_on
    text status
  }
```

---

## 2. Candidate Global Identity (Rings 1 & 2)

```mermaid
erDiagram
  CANDIDATES ||--o| USER_PROFILES : "user_id (nullable)"
  CANDIDATES ||--o{ CANDIDATE_WORK_EXPERIENCES : has
  CANDIDATES ||--o{ CANDIDATE_EDUCATIONS : has
  CANDIDATES ||--o{ CANDIDATE_SKILLS : has
  CANDIDATES ||--o{ CANDIDATE_LANGUAGES : has
  CANDIDATES ||--o{ CANDIDATE_CERTIFICATIONS : has
  CANDIDATES ||--o{ CANDIDATE_LICENCES : has
  CANDIDATES ||--o{ CANDIDATE_PROJECTS : has
  CANDIDATES ||--o{ CANDIDATE_MEMBERSHIPS : has
  CANDIDATES ||--o{ CANDIDATE_REFERENCES : has
  CANDIDATES ||--|| CANDIDATE_PREFERENCES : has
  CANDIDATES ||--o{ CANDIDATE_PREFERRED_ROLES : has
  CANDIDATES ||--o{ CANDIDATE_PREFERRED_INDUSTRIES : has
  CANDIDATES ||--o{ CANDIDATE_PREFERRED_LOCATIONS : has
  CANDIDATES ||--|| CANDIDATE_VISIBILITY : has
  CANDIDATES ||--o{ CANDIDATE_TAGS : has
  CANDIDATES ||--|| CANDIDATE_SEARCH_DOCUMENTS : indexed_as
  CANDIDATES ||--o{ CANDIDATE_DUPLICATE_LINKS : suspected
  SKILLS ||--o{ CANDIDATE_SKILLS : referenced
  INDUSTRIES ||--o{ CANDIDATE_PREFERRED_INDUSTRIES : referenced
  LANGUAGES ||--o{ CANDIDATE_LANGUAGES : referenced
  EDUCATION_LEVELS ||--o{ CANDIDATE_EDUCATIONS : referenced

  CANDIDATES {
    uuid id PK
    uuid user_id FK "nullable (recruiter-created)"
    text given_name
    text family_name
    date date_of_birth
    citext email
    text phone
    uuid country_id FK
    text profile_status
    text source_channel
    int profile_completion_pct
  }
  CANDIDATE_VISIBILITY {
    uuid candidate_id PK,FK
    bool searchable
    jsonb approved_search_fields
  }
  CANDIDATE_SEARCH_DOCUMENTS {
    uuid candidate_id PK,FK
    tsvector search_tsv
    text[] approved_skills
    text country_city
  }
```

---

## 3. Documents & Media, Verification

```mermaid
erDiagram
  DOCUMENTS ||--o{ DOCUMENT_VERSIONS : has
  DOCUMENTS ||--o{ DOCUMENT_ACCESS_GRANTS : shared_via
  DOCUMENTS ||--o{ DOCUMENT_PREVIEWS : rendered_as
  DOCUMENT_TYPES ||--o{ DOCUMENTS : classifies
  CANDIDATES ||--o{ DOCUMENTS : owns
  ORGANIZATIONS ||--o{ DOCUMENTS : owns
  USER_PROFILES ||--o{ DOCUMENTS : uploaded_by

  VERIFICATIONS ||--o{ VERIFICATION_EVIDENCE : supported_by
  VERIFICATIONS ||--o{ VERIFICATION_EVENTS : history
  VERIFICATION_TYPES ||--o{ VERIFICATIONS : classifies
  CANDIDATES ||--o{ VERIFICATIONS : subject
  ORGANIZATIONS ||--o{ VERIFICATIONS : subject
  DOCUMENTS ||--o{ VERIFICATION_EVIDENCE : evidence_doc

  DOCUMENTS {
    uuid id PK
    uuid document_type_id FK
    uuid owner_candidate_id FK
    uuid owning_organization_id FK
    text bucket_id
    text object_path
    text visibility
    text scan_status
    text retention_status
  }
  DOCUMENT_VERSIONS {
    uuid id PK
    uuid document_id FK
    int version_no
    bigint size_bytes
    text mime_type
    text checksum_sha256
    text object_path
  }
  VERIFICATIONS {
    uuid id PK
    uuid verification_type_id FK
    uuid subject_candidate_id FK
    text status
    text method
    uuid verified_by FK
    timestamptz expires_at
  }
```

---

## 4. Employers, Packages & Billing

```mermaid
erDiagram
  EMPLOYER_ORGANIZATIONS ||--o{ EMPLOYER_TEAM_MEMBERS : has
  EMPLOYER_ORGANIZATIONS ||--o{ EMPLOYER_NOTES : about
  EMPLOYER_ORGANIZATIONS ||--o{ BILLING_CONTACTS : has
  EMPLOYER_ORGANIZATIONS ||--o{ EMPLOYER_SUBSCRIPTIONS : subscribes
  PACKAGES ||--o{ PACKAGE_VERSIONS : has
  PACKAGE_VERSIONS ||--o{ PACKAGE_FEATURES : has
  PACKAGE_VERSIONS ||--o{ PACKAGE_ENTITLEMENTS : defines
  PACKAGE_VERSIONS ||--o{ PACKAGE_COUNTRY_PRICES : priced_in
  EMPLOYER_SUBSCRIPTIONS ||--o{ SUBSCRIPTION_ENTITLEMENT_USAGE : tracks
  EMPLOYER_SUBSCRIPTIONS ||--o{ CANDIDATE_ACCESS_EVENTS : meters
  EMPLOYER_SUBSCRIPTIONS ||--o{ INVOICES : billed_by
  INVOICES ||--o{ INVOICE_LINE_ITEMS : contains
  INVOICES ||--o{ INVOICE_EVENTS : history
  INVOICES ||--o{ PAYMENTS : settled_by
  PAYMENTS ||--o{ PAYMENT_EVENTS : history
  PAYMENTS ||--o{ PAYMENT_PROOFS : evidenced_by
  INVOICES ||--o{ CREDIT_ADJUSTMENTS : adjusted_by
  PLACEMENTS ||--o{ INVOICES : generates
  COUNTRIES ||--o{ PACKAGE_COUNTRY_PRICES : for
  CURRENCIES ||--o{ INVOICES : denominated

  EMPLOYER_SUBSCRIPTIONS {
    uuid id PK
    uuid employer_organization_id FK
    uuid package_version_id FK
    text status
    bool is_trial
    date trial_ends_on
    date starts_on
    date expires_on
  }
  INVOICES {
    uuid id PK
    text invoice_number UK
    uuid owning_organization_id FK
    uuid employer_organization_id FK
    uuid placement_id FK
    uuid currency_id FK
    text status
    text payment_status
  }
```

---

## 5. Jobs (order / publication / approval)

```mermaid
erDiagram
  EMPLOYER_ORGANIZATIONS ||--o{ JOB_ORDERS : requests
  ORGANIZATIONS ||--o{ JOB_ORDERS : responsible_franchise
  JOB_ORDERS ||--o{ JOB_ORDER_EVENTS : history
  JOB_ORDERS ||--o{ JOB_ASSIGNMENTS : assigned_to
  JOB_ORDERS ||--o{ JOB_HIRING_TEAM : staffed_by
  JOB_ORDERS ||--o{ JOB_SCREENING_QUESTIONS : asks
  JOB_ORDERS ||--o{ JOB_REQUIRED_DOCUMENTS : requires
  JOB_ORDERS ||--o{ JOB_POSTINGS : published_as
  JOB_POSTINGS ||--o{ JOB_POSTING_VERSIONS : versioned
  JOB_POSTINGS ||--o{ JOB_POSTING_CHANNELS : distributed_to
  JOB_POSTINGS ||--o{ JOB_POSTING_EVENTS : history
  JOB_TEMPLATES ||--o{ JOB_ORDERS : instantiated_from
  USER_PROFILES ||--o{ JOB_ASSIGNMENTS : recruiter
  COUNTRIES ||--o{ JOB_ORDERS : located_in
  INDUSTRIES ||--o{ JOB_ORDERS : in
  EMPLOYMENT_TYPES ||--o{ JOB_ORDERS : typed
  WORK_ARRANGEMENTS ||--o{ JOB_ORDERS : arranged

  JOB_ORDERS {
    uuid id PK
    uuid employer_organization_id FK
    uuid responsible_organization_id FK
    text title
    text recruitment_path
    text status
    bool is_confidential
    int vacancy_count
    date application_deadline
  }
  JOB_POSTINGS {
    uuid id PK
    uuid job_order_id FK
    text status
    uuid country_id FK
    timestamptz published_at
    text approval_status
  }
```

---

## 6. Applications & Recruiter Pipeline (Ring 3a)

```mermaid
erDiagram
  CANDIDATES ||--o{ APPLICATIONS : subject
  JOB_ORDERS ||--o{ APPLICATIONS : for
  ORGANIZATIONS ||--o{ APPLICATIONS : owning_franchise
  ORGANIZATIONS ||--o{ CANDIDATE_ENGAGEMENTS : owns
  CANDIDATES ||--o{ CANDIDATE_ENGAGEMENTS : about
  APPLICATIONS ||--o{ APPLICATION_STAGE_EVENTS : history
  APPLICATIONS ||--o| APPLICATION_SNAPSHOTS : frozen_as
  APPLICATIONS ||--o{ SCREENING_RECORDS : screened_by
  SCREENING_RECORDS ||--o{ SCREENING_CRITERIA_RESULTS : contains
  APPLICATIONS ||--o{ SCREENING_SCORECARDS : evaluated_by
  SCREENING_SCORECARDS ||--o{ SCORECARD_COMPETENCY_SCORES : scores
  APPLICATIONS ||--o{ ASSESSMENT_RECORDS : tested_by
  APPLICATIONS ||--o{ REFERENCE_CHECKS : checked_by
  APPLICATIONS ||--o{ APPLICATION_REJECTIONS : rejected_by
  APPLICATIONS ||--o{ APPLICATION_ANSWERS : answered
  PIPELINE_STAGES ||--o{ APPLICATIONS : current_stage
  PIPELINE_STAGES ||--o{ APPLICATION_STAGE_EVENTS : to_stage
  REJECTION_REASONS ||--o{ APPLICATION_REJECTIONS : reason
  DOCUMENT_VERSIONS ||--o{ APPLICATIONS : cv_version_used
  CANDIDATE_SOURCES ||--o{ APPLICATIONS : entered_via

  APPLICATIONS {
    uuid id PK
    uuid candidate_id FK
    uuid job_order_id FK
    uuid owning_organization_id FK
    text recruitment_path
    text entry_type
    uuid current_stage_id FK
    text consent_status
    uuid assigned_recruiter_id FK
    bool is_on_hold
  }
  CANDIDATE_ENGAGEMENTS {
    uuid id PK
    uuid candidate_id FK
    uuid owning_organization_id FK
    text internal_summary
    text engagement_status
  }
```

---

## 7. Employer Submissions (Ring 3b) & Consent

```mermaid
erDiagram
  APPLICATIONS ||--o{ CANDIDATE_SUBMISSIONS : submitted_as
  CANDIDATES ||--o{ CANDIDATE_SUBMISSIONS : about
  JOB_ORDERS ||--o{ CANDIDATE_SUBMISSIONS : for
  EMPLOYER_ORGANIZATIONS ||--o{ CANDIDATE_SUBMISSIONS : to
  ORGANIZATIONS ||--o{ CANDIDATE_SUBMISSIONS : submitting_franchise
  CANDIDATE_SUBMISSIONS ||--|| SUBMISSION_SNAPSHOTS : frozen_as
  CANDIDATE_SUBMISSIONS ||--o{ SUBMISSION_DOCUMENTS : discloses
  CANDIDATE_SUBMISSIONS ||--o{ SUBMISSION_EVENTS : history
  CANDIDATE_SUBMISSIONS ||--o{ SUBMISSION_VIEWS : viewed_in
  CANDIDATE_SUBMISSIONS ||--o{ SUBMISSION_COMMENTS : commented
  CANDIDATE_SUBMISSIONS ||--o{ SUBMISSION_RATINGS : rated
  CANDIDATE_SUBMISSIONS }o--|| CONSENT_RECORDS : authorized_by
  DOCUMENT_VERSIONS ||--o{ SUBMISSION_DOCUMENTS : shared_version

  CONSENT_RECORDS }o--|| CONSENT_PURPOSES : for
  CONSENT_RECORDS }o--|| LEGAL_DOCUMENT_VERSIONS : shown
  CANDIDATES ||--o{ CONSENT_RECORDS : subject
  ORGANIZATIONS ||--o{ CONSENT_RECORDS : covered_recipient
  EMPLOYER_ORGANIZATIONS ||--o{ CONSENT_RECORDS : covered_recipient

  CANDIDATE_SUBMISSIONS {
    uuid id PK
    uuid application_id FK
    uuid candidate_id FK
    uuid employer_organization_id FK
    uuid submitting_organization_id FK
    uuid consent_record_id FK
    text status
    bool is_masked
    timestamptz access_expires_at
    timestamptz access_revoked_at
  }
  CONSENT_RECORDS {
    uuid id PK
    uuid subject_candidate_id FK
    uuid consent_purpose_id FK
    uuid covered_organization_id FK
    uuid legal_document_version_id FK
    text method
    timestamptz granted_at
    timestamptz expires_at
    timestamptz withdrawn_at
  }
```

---

## 8. Interviews (human) & Offers/Placements

```mermaid
erDiagram
  APPLICATIONS ||--o{ INTERVIEWS : for
  CANDIDATE_SUBMISSIONS ||--o{ INTERVIEWS : arising_from
  INTERVIEW_TYPES ||--o{ INTERVIEWS : typed
  INTERVIEWS ||--o{ INTERVIEW_PANELISTS : staffed_by
  INTERVIEWS ||--o{ INTERVIEW_EVENTS : history
  INTERVIEWS ||--o{ INTERVIEW_SCORECARDS : scored_by
  INTERVIEW_SCORECARDS ||--o{ INTERVIEW_COMPETENCY_SCORES : scores
  INTERVIEWS ||--o{ INTERVIEW_QUESTION_SETS : uses
  INTERVIEW_QUESTION_SETS ||--o{ INTERVIEW_QUESTIONS : contains
  INTERVIEWS ||--o| DOCUMENTS : recording

  APPLICATIONS ||--o{ OFFERS : leads_to
  OFFERS ||--o{ OFFER_VERSIONS : versioned
  OFFERS ||--o{ OFFER_EVENTS : history
  OFFERS ||--o| PLACEMENTS : results_in
  PLACEMENTS ||--o{ PLACEMENT_EVENTS : history
  ORGANIZATIONS ||--o{ PLACEMENTS : attributed_to
  USER_PROFILES ||--o{ PLACEMENTS : responsible_recruiter

  OFFERS {
    uuid id PK
    uuid application_id FK
    text status
    numeric compensation_amount
    uuid currency_id FK
    date proposed_start_date
    timestamptz expires_at
  }
  PLACEMENTS {
    uuid id PK
    uuid offer_id FK
    uuid application_id FK
    uuid owning_organization_id FK
    date agreed_start_date
    numeric placement_fee
    int guarantee_period_days
  }
```

---

## 9. AI Video Interviews (six sub-graphs)

```mermaid
erDiagram
  AI_INTERVIEW_TEMPLATES ||--o{ AI_INTERVIEW_TEMPLATE_VERSIONS : versioned
  AI_INTERVIEW_TEMPLATE_VERSIONS ||--o{ AI_COMPETENCIES : defines
  AI_INTERVIEW_TEMPLATE_VERSIONS ||--o{ AI_QUESTION_BANKS : uses
  AI_QUESTION_BANKS ||--o{ AI_QUESTIONS : contains
  AI_QUESTIONS ||--o{ AI_QUESTION_VERSIONS : versioned
  JOB_ORDERS ||--o{ AI_INTERVIEW_CONFIGS : configured_for
  AI_INTERVIEW_TEMPLATE_VERSIONS ||--o{ AI_INTERVIEW_CONFIGS : based_on

  AI_INTERVIEW_CONFIGS ||--o{ AI_INTERVIEW_INVITATIONS : invites
  APPLICATIONS ||--o{ AI_INTERVIEW_INVITATIONS : for
  AI_INTERVIEW_INVITATIONS ||--o| AI_INTERVIEW_SESSIONS : starts
  AI_INTERVIEW_SESSIONS ||--o{ AI_INTERVIEW_RESPONSES : contains
  AI_QUESTION_VERSIONS ||--o{ AI_INTERVIEW_RESPONSES : answered
  AI_INTERVIEW_RESPONSES ||--o{ AI_MEDIA_ASSETS : captured_as
  AI_MEDIA_ASSETS ||--o| AI_TRANSCRIPTS : transcribed_as
  AI_TRANSCRIPTS ||--o{ AI_TRANSCRIPT_SEGMENTS : segmented

  AI_INTERVIEW_SESSIONS ||--o{ AI_MODEL_RUNS : evaluated_in
  AI_MODEL_RUNS ||--o{ AI_EVALUATIONS : produces
  AI_EVALUATIONS ||--o{ AI_EVALUATION_SCORES : scores
  AI_EVALUATIONS ||--o{ AI_INTEGRITY_FLAGS : flags
  AI_EVALUATIONS ||--o{ AI_HUMAN_REVIEWS : reviewed_by
  AI_EVALUATIONS ||--o{ AI_FAIRNESS_REVIEWS : audited_by
  AI_MODEL_RUNS ||--o{ AI_MODEL_RUNS : reprocessing_of

  AI_INTERVIEW_SESSIONS {
    uuid id PK
    uuid invitation_id FK
    uuid application_id FK
    uuid consent_record_id FK
    text status
    jsonb device_metadata
    timestamptz started_at
    timestamptz completed_at
  }
  AI_MODEL_RUNS {
    uuid id PK
    uuid session_id FK
    text provider
    text model_id
    text model_version
    text prompt_version
    text rubric_version
    uuid reprocessing_of_run_id FK
    int token_cost
  }
  AI_EVALUATIONS {
    uuid id PK
    uuid model_run_id FK
    numeric overall_score
    numeric confidence
    text audience
  }
  AI_HUMAN_REVIEWS {
    uuid id PK
    uuid ai_evaluation_id FK
    uuid reviewer_id FK
    bool overrides_ai
    text override_reason
    bool is_final
  }
```

---

## 10. Communications, Notes/Tasks, Whistleblowing

```mermaid
erDiagram
  MESSAGE_TEMPLATES ||--o{ MESSAGE_TEMPLATE_VERSIONS : versioned
  NOTIFICATION_CATEGORIES ||--o{ MESSAGE_TEMPLATES : categorizes
  MESSAGE_TEMPLATE_VERSIONS ||--o{ MESSAGES : rendered_from
  MESSAGES ||--o{ MESSAGE_RECIPIENTS : to
  MESSAGE_RECIPIENTS ||--o{ MESSAGE_DELIVERIES : delivered_via
  CHANNELS ||--o{ MESSAGE_DELIVERIES : over
  USER_PROFILES ||--o{ COMMUNICATION_PREFERENCES : sets
  CANDIDATES ||--o{ COMMUNICATION_PREFERENCES : sets
  NOTIFICATION_CATEGORIES ||--o{ COMMUNICATION_PREFERENCES : for
  USER_PROFILES ||--o{ IN_APP_NOTIFICATIONS : receives

  NOTES }o--|| NOTE_VISIBILITIES : scoped_by
  ORGANIZATIONS ||--o{ NOTES : owning_org
  USER_PROFILES ||--o{ NOTES : author
  TASKS }o--|| USER_PROFILES : assignee
  ACTIVITY_EVENTS }o--|| ORGANIZATIONS : owning_org

  SAFEGUARDING_CASES ||--o{ SAFEGUARDING_CASE_EVENTS : history
  SAFEGUARDING_CASES }o--o| CANDIDATES : reporter_optional

  MESSAGE_DELIVERIES {
    uuid id PK
    uuid message_recipient_id FK
    uuid channel_id FK
    text provider
    text provider_message_id
    text status
    text failure_reason
    timestamptz read_at
  }
  NOTES {
    uuid id PK
    uuid owning_organization_id FK
    uuid author_id FK
    text subject_type
    uuid subject_id
    text visibility
    text body
  }
```

---

## 11. Audit, Privacy & Compliance, Reference

```mermaid
erDiagram
  AUDIT_LOG }o--o| USER_PROFILES : actor
  AUDIT_LOG }o--o| SERVICE_ACTORS : system_actor
  AUDIT_LOG }o--o| ORGANIZATIONS : org_context
  DATA_SUBJECT_REQUESTS }o--|| CANDIDATES : about
  DATA_SUBJECT_REQUESTS ||--o{ DSR_EVENTS : history
  RETENTION_POLICIES ||--o{ LEGAL_HOLDS : overridden_by
  CROSS_BORDER_TRANSFERS }o--o| COUNTRIES : from_to
  LEGAL_DOCUMENT_VERSIONS ||--o{ CONSENT_RECORDS : referenced
  SECURITY_INCIDENTS ||--o{ INCIDENT_AFFECTED_SUBJECTS : affects

  COUNTRIES ||--o{ CURRENCIES : uses
  COUNTRIES ||--o{ COUNTRY_CONFIGURATIONS : configured_by
  ORGANIZATIONS ||--o{ FRANCHISE_CONFIGURATIONS : configured_by

  AUDIT_LOG {
    bigint id PK
    uuid actor_user_id FK
    uuid organization_context_id FK
    text action
    text entity_type
    uuid entity_id
    jsonb before_value
    jsonb after_value
    uuid correlation_id
    timestamptz occurred_at
  }
```

---

## 12. Relationship legend & conventions

- All PKs are `uuid` (except `audit.audit_log` and other high-volume append logs, which use `bigint identity` for insert throughput; see `08`).
- All timestamps are `timestamptz`.
- Every private table has `owning_organization_id` (FK → `organizations`) except candidate-global (Ring 1) tables, which are candidate-owned, and reference tables, which are global read-only.
- `*_events` tables are append-only history for their parent aggregate.
- Reference/lookup tables (`countries`, `skills`, `pipeline_stages`, etc.) are shown only where they participate in a principal relationship; all are catalogued in `04`.
