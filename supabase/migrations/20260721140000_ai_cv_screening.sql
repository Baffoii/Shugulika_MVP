-- =============================================================================
-- AI CV Screening (VeraHire-style role-fit reviewer)
--   (a) Structured job requirements per job_order (must-have / nice-to-have).
--   (b) On-demand AI reviews of an application's CV against those requirements,
--       with DIRECT, evidence-cited reasoning: per-requirement match, strengths,
--       gaps (incl. career gaps), and concerns about vagueness/red flags.
--
-- Cost controls baked in:
--   1. On-demand only — a review row is created when a recruiter clicks
--      "Screen with AI". Nothing here auto-runs on application insert.
--   2. Cache + meter — the app reuses the latest succeeded review whose
--      (cv_document_id, requirements_fingerprint) still match, and meters
--      succeeded runs against the `ai_cv_screens_per_period` entitlement.
--
-- MVP assumption: candidate consent is treated as already covered (no live
-- users). Reviews are staff/employer-visible only — never candidate-visible.
-- =============================================================================

-- ---- Helper: can the current user act on this application (staff/employer)? --
-- Mirrors the staff/employer branch of app_read (0014) — excludes candidates.
create or replace function public.auth_can_staff_read_application(p_app uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_is_hq() or exists (
    select 1 from public.applications a
    where a.id = p_app
      and (
        a.owning_org_id in (select public.auth_scoped_org_ids())
        or public.auth_job_order_employer_org_id(a.job_order_id) in (select public.auth_scoped_org_ids())
      )
  );
$$;

-- ---- Helper: can the current user manage requirements on this job order? -----
create or replace function public.auth_can_staff_manage_job_order(p_jo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_is_hq() or exists (
    select 1 from public.job_orders jo
    where jo.id = p_jo
      and (
        jo.responsible_org_id in (select public.auth_scoped_org_ids())
        or jo.employer_org_id in (select public.auth_scoped_org_ids())
      )
  );
$$;

grant execute on function public.auth_can_staff_read_application(uuid) to authenticated;
grant execute on function public.auth_can_staff_manage_job_order(uuid) to authenticated;

-- ============================================================================
-- (a) Structured job requirements
-- ============================================================================
create table if not exists public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  category text not null default 'other'
    check (category in ('skill','experience','education','language','certification','responsibility','other')),
  label text not null,                 -- e.g. "3+ years React", "Fluent English"
  detail text,                         -- optional elaboration / acceptance notes
  importance text not null default 'must_have'
    check (importance in ('must_have','nice_to_have')),
  min_years numeric,                   -- optional, for experience-type criteria
  ordinal int not null default 0,
  source text not null default 'manual'
    check (source in ('manual','ai_parsed')),  -- manual entry vs AI-parsed from free-text requirements
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_requirements_job_order
  on public.job_requirements(job_order_id, ordinal);

alter table public.job_requirements enable row level security;

drop policy if exists job_requirements_staff_read on public.job_requirements;
create policy job_requirements_staff_read on public.job_requirements
  for select to authenticated
  using (public.auth_can_staff_manage_job_order(job_order_id));
drop policy if exists job_requirements_staff_write on public.job_requirements;
create policy job_requirements_staff_write on public.job_requirements
  for all to authenticated
  using (public.auth_can_staff_manage_job_order(job_order_id))
  with check (public.auth_can_staff_manage_job_order(job_order_id));

-- ============================================================================
-- (b) AI review runs (one row per screen) — the cache unit + metering unit
-- ============================================================================
create table if not exists public.application_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  job_order_id uuid not null references public.job_orders(id),  -- denormalized snapshot
  status text not null default 'queued'
    check (status in ('queued','processing','succeeded','failed')),
  provider text not null default 'openai',
  model text,
  overall_score int check (overall_score between 0 and 100),
  fit_verdict text
    check (fit_verdict in ('strong_fit','possible_fit','weak_fit','insufficient_evidence')),
  summary text,                -- direct top-line: why this candidate is/ isn't a fit
  strengths text,              -- narrative of what looks strong
  concerns text,               -- narrative of gaps, vagueness, red flags — stated directly
  recommended_questions jsonb, -- array of interview questions probing the gaps
  model_reasoning text,        -- fuller reasoning trace
  -- Cache keys: reuse a succeeded review only if BOTH still match the live app.
  cv_document_id uuid references public.candidate_documents(id),
  requirements_fingerprint text,  -- app-computed hash of the requirement set at scoring time
  error_message text,
  created_by uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_reviews_application
  on public.application_ai_reviews(application_id, created_at desc);
create index if not exists idx_ai_reviews_status
  on public.application_ai_reviews(status);

alter table public.application_ai_reviews enable row level security;

drop policy if exists ai_reviews_staff_read on public.application_ai_reviews;
create policy ai_reviews_staff_read on public.application_ai_reviews
  for select to authenticated
  using (public.auth_can_staff_read_application(application_id));
drop policy if exists ai_reviews_staff_write on public.application_ai_reviews;
create policy ai_reviews_staff_write on public.application_ai_reviews
  for all to authenticated
  using (public.auth_can_staff_read_application(application_id))
  with check (public.auth_can_staff_read_application(application_id));

-- ============================================================================
-- (b) Per-item breakdown — the "explain everything, cite evidence" layer
-- ============================================================================
create table if not exists public.application_ai_review_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.application_ai_reviews(id) on delete cascade,
  requirement_id uuid references public.job_requirements(id) on delete set null,  -- null for free-form strengths/concerns
  item_type text not null
    check (item_type in ('requirement_match','strength','gap','concern','question')),
  label text not null,          -- snapshot of the requirement / title of the strength|concern
  assessment text
    check (assessment in ('met','partial','missing','unclear')),  -- for requirement_match items
  explanation text not null,    -- DIRECT reasoning: why strong / weak / concerning
  evidence_text text,           -- verbatim CV excerpt supporting it (null when the point is an absence)
  confidence numeric check (confidence >= 0 and confidence <= 1),
  ordinal int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_review_items_review
  on public.application_ai_review_items(review_id, ordinal);

alter table public.application_ai_review_items enable row level security;

drop policy if exists ai_review_items_staff_read on public.application_ai_review_items;
create policy ai_review_items_staff_read on public.application_ai_review_items
  for select to authenticated
  using (exists (
    select 1 from public.application_ai_reviews r
    where r.id = review_id and public.auth_can_staff_read_application(r.application_id)
  ));
drop policy if exists ai_review_items_staff_write on public.application_ai_review_items;
create policy ai_review_items_staff_write on public.application_ai_review_items
  for all to authenticated
  using (exists (
    select 1 from public.application_ai_reviews r
    where r.id = review_id and public.auth_can_staff_read_application(r.application_id)
  ))
  with check (exists (
    select 1 from public.application_ai_reviews r
    where r.id = review_id and public.auth_can_staff_read_application(r.application_id)
  ));

-- ---- updated_at triggers (reuse existing convention) ------------------------
do $$
declare t text;
begin
  foreach t in array array['job_requirements','application_ai_reviews'] loop
    execute format('drop trigger if exists trg_updated on public.%I;', t);
    execute format('create trigger trg_updated before update on public.%I for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;

-- ============================================================================
-- Cost control #2 — meter against package_entitlements
-- ============================================================================
-- New entitlement key: how many AI CV screens an employer gets per billing cycle.
-- (Same shape/naming as existing *_per_period entitlements from 0004 seed.)
insert into public.package_entitlements (package_id, key, limit_value)
select p.id, e.key, e.lim from public.packages p
join (values
  ('tier_1','ai_cv_screens_per_period',20),
  ('tier_2','ai_cv_screens_per_period',40),
  ('tier_3','ai_cv_screens_per_period',60)
) as e(pkey,key,lim) on e.pkey = p.key
where not exists (
  select 1 from public.package_entitlements pe
  where pe.package_id = p.id and pe.key = e.key
);

-- Usage counter: succeeded screens for an employer org since a cutoff (cycle start).
-- The server action compares this against the employer's `ai_cv_screens_per_period`
-- limit_value BEFORE creating a new review, and blocks/soft-warns when exhausted.
create or replace function public.ai_cv_screens_used(p_employer_org uuid, p_since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.application_ai_reviews r
  join public.applications a on a.id = r.application_id
  join public.job_orders jo on jo.id = a.job_order_id
  where jo.employer_org_id = p_employer_org
    and r.status = 'succeeded'
    and r.created_at >= p_since;
$$;
grant execute on function public.ai_cv_screens_used(uuid, timestamptz) to authenticated;

-- ---- Table grants (RLS still governs row visibility) ------------------------
grant select, insert, update, delete on
  public.job_requirements,
  public.application_ai_reviews,
  public.application_ai_review_items
to authenticated;
