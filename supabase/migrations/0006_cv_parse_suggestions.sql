-- File 0006: CV parsing runs + per-field profile suggestions for the
-- candidate-profile autofill review workflow. Candidate-only visibility —
-- staff/recruiters/employers never see raw parse data or suggestions.

-- ---- Parse status on the CV document itself ---------------------------------
alter table public.candidate_documents
  add column if not exists parse_status text not null default 'none'
    check (parse_status in ('none','queued','processing','succeeded','failed'));

-- ---- One row per parse attempt of a given CV document -----------------------
create table if not exists public.resume_parse_runs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  document_id uuid not null references public.candidate_documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','succeeded','failed')),
  provider text not null default 'openai',
  model text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_resume_parse_runs_candidate on public.resume_parse_runs(candidate_id);
create index if not exists idx_resume_parse_runs_document on public.resume_parse_runs(document_id);

-- ---- One row per suggested field/value from a parse run ---------------------
create table if not exists public.resume_field_suggestions (
  id uuid primary key default gen_random_uuid(),
  parse_run_id uuid not null references public.resume_parse_runs(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  target_entity text not null check (target_entity in ('profile','experience','education','skill','certification','language')),
  target_entity_id uuid, -- null = suggests a NEW row; non-null = suggests updating an existing row
  field_path text not null, -- e.g. 'headline', or a key within the suggested_value JSON for collection rows
  suggested_value jsonb not null,
  current_value jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending','accepted','edited','rejected')),
  evidence_text text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_resume_suggestions_run on public.resume_field_suggestions(parse_run_id);
create index if not exists idx_resume_suggestions_candidate_status on public.resume_field_suggestions(candidate_id, status);

-- ---- RLS: candidate-only, no staff/recruiter/employer read ------------------
alter table public.resume_parse_runs enable row level security;
alter table public.resume_field_suggestions enable row level security;

create policy resume_parse_runs_self_all on public.resume_parse_runs for all to authenticated
  using (candidate_id = public.auth_candidate_id())
  with check (candidate_id = public.auth_candidate_id());

create policy resume_field_suggestions_self_all on public.resume_field_suggestions for all to authenticated
  using (candidate_id = public.auth_candidate_id())
  with check (candidate_id = public.auth_candidate_id());

notify pgrst, 'reload schema';
