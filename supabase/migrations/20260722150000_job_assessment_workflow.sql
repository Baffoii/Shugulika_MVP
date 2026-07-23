-- Employer assessment preference + recruiter-to-candidate assessment delivery.

alter table public.job_orders
  add column if not exists assessment_mode text not null default 'shugulika'
    check (assessment_mode in ('shugulika', 'employer', 'both')),
  add column if not exists assessment_seniority text not null default 'junior'
    check (assessment_seniority in ('junior', 'senior')),
  add column if not exists assessment_file_bucket text,
  add column if not exists assessment_file_path text,
  add column if not exists assessment_file_name text,
  add column if not exists assessment_file_mime text,
  add column if not exists assessment_file_size bigint;

create table if not exists public.assessment_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  assessment_mode text not null check (assessment_mode in ('shugulika', 'employer', 'both')),
  assessment_seniority text not null check (assessment_seniority in ('junior', 'senior')),
  status text not null default 'assigned'
    check (status in ('assigned', 'opened', 'in_progress', 'submitted', 'graded', 'cancelled', 'expired')),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  opened_at timestamptz,
  submitted_at timestamptz,
  score numeric,
  result_band text,
  grader_id uuid references public.profiles(id),
  graded_at timestamptz,
  grading_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assessment_assignments_candidate
  on public.assessment_assignments (candidate_id, status);
create index if not exists idx_assessment_assignments_job
  on public.assessment_assignments (job_order_id, status);

alter table public.assessment_assignments enable row level security;

create policy assessment_assignment_candidate_read on public.assessment_assignments
  for select to authenticated
  using (candidate_id = public.auth_candidate_id());

create policy assessment_assignment_staff_read on public.assessment_assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = assessment_assignments.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

create policy assessment_assignment_staff_insert on public.assessment_assignments
  for insert to authenticated
  with check (
    assigned_by = auth.uid()
    and (
      public.auth_is_hq()
      or public.auth_has_role('franchise_admin')
      or public.auth_has_role('recruiter')
    )
    and exists (
      select 1 from public.job_orders jo
      where jo.id = assessment_assignments.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

create policy assessment_assignment_staff_update on public.assessment_assignments
  for update to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = assessment_assignments.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  )
  with check (
    exists (
      select 1 from public.job_orders jo
      where jo.id = assessment_assignments.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

grant select, insert, update on public.assessment_assignments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employer-assessments',
  'employer-assessments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "employer uploads own assessments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employer-assessments'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from public.memberships
      where user_id = auth.uid()
        and role = 'employer_user'
        and status = 'active'
    )
  );

create policy "authorized users read employer assessments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employer-assessments'
    and exists (
      select 1
      from public.job_orders jo
      where jo.assessment_file_path = storage.objects.name
        and (
          public.auth_is_hq()
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
          or exists (
            select 1
            from public.assessment_assignments aa
            join public.candidate_profiles cp on cp.id = aa.candidate_id
            where aa.job_order_id = jo.id
              and cp.user_id = auth.uid()
              and aa.status not in ('cancelled', 'expired')
          )
        )
    )
  );

create policy "employer removes own assessment uploads" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employer-assessments'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from public.memberships
      where user_id = auth.uid()
        and role = 'employer_user'
        and status = 'active'
    )
  );

create or replace function public.audit_job_assessment_configuration()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.assessment_configured',
    'job_order',
    new.id,
    new.responsible_org_id,
    jsonb_build_object(
      'assessment_mode', new.assessment_mode,
      'assessment_seniority', new.assessment_seniority,
      'employer_file_name', new.assessment_file_name
    ),
    jsonb_build_object('employer_org_id', new.employer_org_id)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_job_assessment_configuration on public.job_orders;
create trigger trg_audit_job_assessment_configuration
after insert on public.job_orders
for each row execute function public.audit_job_assessment_configuration();
