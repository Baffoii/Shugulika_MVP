-- =============================================================================
-- Shugulika MVP — RLS, helper functions, public jobs view, signup trigger.
-- Deny-by-default: RLS is enabled on every table and access is granted only by
-- the policies below. Helpers are SECURITY DEFINER so they can read membership
-- tables without recursing into those tables' own policies.
-- =============================================================================

-- ---- Helper functions (SECURITY DEFINER, fixed search_path) -----------------
create or replace function public.auth_has_role(p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.role = p_role and m.status = 'active'
  );
$$;

create or replace function public.auth_is_hq()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_has_role('hq_admin');
$$;

create or replace function public.auth_candidate_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.candidate_profiles where user_id = auth.uid();
$$;

-- Member orgs + child employer orgs of member orgs + all orgs for HQ.
create or replace function public.auth_scoped_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.organization_id from public.memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.organization_id is not null
  union
  select o.id from public.organizations o
    where o.parent_id in (
      select m2.organization_id from public.memberships m2
      where m2.user_id = auth.uid() and m2.status = 'active' and m2.organization_id is not null
    )
  union
  select o.id from public.organizations o where public.auth_is_hq();
$$;

-- Can the current user read this candidate's structured profile?
-- (Employers are deliberately EXCLUDED here — they see only the disclosed
--  snapshot on employer_submissions, never the candidate's live tables.)
create or replace function public.auth_can_read_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_candidate = public.auth_candidate_id()
    or exists (
      select 1 from public.applications a
      where a.candidate_id = p_candidate and a.owning_org_id in (select public.auth_scoped_org_ids())
    )
    or exists (
      select 1 from public.candidate_search_visibility v
      where v.candidate_id = p_candidate and v.is_searchable
        and (public.auth_has_role('recruiter') or public.auth_has_role('franchise_admin') or public.auth_is_hq())
    );
$$;

-- ---- Signup trigger: create profile + membership + candidate row ------------
-- Runs as definer. Intended role comes from signup metadata but is CLAMPED to
-- the public roles; privileged roles can never be self-assigned this way.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text; v_cand uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'candidate');
  if v_role not in ('candidate','employer_user') then v_role := 'candidate'; end if;
  v_name := new.raw_user_meta_data->>'full_name';

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, v_name)
  on conflict (id) do nothing;

  insert into public.memberships (user_id, role, status)
  values (new.id, v_role, 'active')
  on conflict do nothing;

  if v_role = 'candidate' then
    insert into public.candidate_profiles (user_id, given_name)
    values (new.id, split_part(coalesce(v_name,''),' ',1))
    on conflict (user_id) do nothing
    returning id into v_cand;
    if v_cand is not null then
      insert into public.candidate_preferences (candidate_id) values (v_cand) on conflict do nothing;
      insert into public.candidate_search_visibility (candidate_id) values (v_cand) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---- Public jobs view (safe columns only; masks salary + confidential) ------
-- A plain (non-invoker) view: runs with the owner's rights and bypasses RLS, so
-- anonymous visitors can read ONLY advertised jobs and ONLY these safe fields.
create or replace view public.public_jobs as
select
  j.id as job_id, j.public_slug, j.published_at, j.status,
  jo.id as job_order_id, jo.title, jo.department, jo.description, jo.responsibilities, jo.requirements,
  jo.country_code, jo.city, jo.employment_type, jo.work_arrangement, jo.experience_level,
  case when jo.salary_public then jo.salary_min end as salary_min,
  case when jo.salary_public then jo.salary_max end as salary_max,
  case when jo.salary_public then jo.salary_currency end as salary_currency,
  jo.vacancy_count, jo.application_deadline, jo.recruitment_path, jo.is_confidential,
  case when jo.is_confidential then 'Confidential Employer' else o.name end as employer_name
from public.jobs j
join public.job_orders jo on jo.id = j.job_order_id
join public.organizations o on o.id = jo.employer_org_id
where j.status = 'advertised';

grant select on public.public_jobs to anon, authenticated;

-- Apply targets: lets a signed-in candidate resolve the owning franchise + path
-- for an advertised job so they can create an application (they cannot read the
-- internal job_orders table directly). Exposed to authenticated users only.
create or replace view public.apply_targets as
select jo.id as job_order_id, jo.responsible_org_id, jo.recruitment_path, j.status as job_status
from public.job_orders jo
join public.jobs j on j.job_order_id = jo.id
where j.status = 'advertised';

grant select on public.apply_targets to authenticated;

-- =============================================================================
-- Enable RLS everywhere, then grant access explicitly.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'countries','pipeline_stages','rejection_reasons','profiles','organizations','memberships',
    'candidate_profiles','candidate_experiences','candidate_education','candidate_skills',
    'candidate_languages','candidate_certifications','candidate_preferences',
    'candidate_search_visibility','candidate_documents','candidate_consents',
    'job_orders','jobs','job_screening_questions','job_assignments','saved_jobs','applications',
    'application_answers','application_stage_history','recruiter_notes','candidate_tags',
    'employer_submissions','employer_comments','interviews','offers','placements',
    'packages','package_entitlements','employer_subscriptions','invoices','invoice_items',
    'payment_records','notifications','activity_events','audit_logs','integration_connections','feature_flags'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---- Reference: public read, HQ write --------------------------------------
create policy ref_read_countries on public.countries for select using (true);
create policy ref_read_stages on public.pipeline_stages for select using (true);
create policy ref_read_reasons on public.rejection_reasons for select using (true);
create policy ref_read_packages on public.packages for select to authenticated using (true);
create policy ref_read_entitlements on public.package_entitlements for select to authenticated using (true);
create policy ref_read_flags on public.feature_flags for select to authenticated using (true);
create policy ref_read_integrations on public.integration_connections for select to authenticated using (true);
create policy ref_write_integrations on public.integration_connections for all to authenticated
  using (public.auth_is_hq()) with check (public.auth_is_hq());

-- ---- profiles ---------------------------------------------------------------
create policy profiles_self_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.auth_is_hq()
  or exists (select 1 from public.memberships m1 join public.memberships m2 on m1.organization_id = m2.organization_id
             where m1.user_id = auth.uid() and m2.user_id = profiles.id and m1.status='active' and m2.status='active' and m1.organization_id is not null)
);
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---- organizations ----------------------------------------------------------
create policy org_scoped_read on public.organizations for select to authenticated
  using (id in (select public.auth_scoped_org_ids()));
create policy org_staff_write on public.organizations for all to authenticated
  using (id in (select public.auth_scoped_org_ids()) and (public.auth_is_hq() or public.auth_has_role('franchise_admin') or public.auth_has_role('employer_user')))
  with check (true);

-- ---- memberships (simple, non-recursive) ------------------------------------
create policy mem_self_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.auth_is_hq());
create policy mem_admin_write on public.memberships for all to authenticated
  using (public.auth_is_hq()) with check (public.auth_is_hq());

-- ---- candidate_profiles + sub-tables ---------------------------------------
create policy cand_self_all on public.candidate_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cand_staff_read on public.candidate_profiles for select to authenticated
  using (public.auth_can_read_candidate(id));

do $$
declare t text;
begin
  foreach t in array array['candidate_experiences','candidate_education','candidate_skills',
    'candidate_languages','candidate_certifications','candidate_documents'] loop
    execute format($f$
      create policy %1$s_self_all on public.%1$s for all to authenticated
        using (candidate_id = public.auth_candidate_id())
        with check (candidate_id = public.auth_candidate_id());
      create policy %1$s_staff_read on public.%1$s for select to authenticated
        using (public.auth_can_read_candidate(candidate_id));
    $f$, t);
  end loop;
end $$;

create policy pref_self_all on public.candidate_preferences for all to authenticated
  using (candidate_id = public.auth_candidate_id()) with check (candidate_id = public.auth_candidate_id());
create policy pref_staff_read on public.candidate_preferences for select to authenticated
  using (public.auth_can_read_candidate(candidate_id));

create policy vis_self_all on public.candidate_search_visibility for all to authenticated
  using (candidate_id = public.auth_candidate_id()) with check (candidate_id = public.auth_candidate_id());
create policy vis_staff_read on public.candidate_search_visibility for select to authenticated
  using (public.auth_has_role('recruiter') or public.auth_has_role('franchise_admin') or public.auth_is_hq());

-- ---- consent ---------------------------------------------------------------
create policy consent_self_all on public.candidate_consents for all to authenticated
  using (candidate_id = public.auth_candidate_id()) with check (candidate_id = public.auth_candidate_id());
create policy consent_staff_read on public.candidate_consents for select to authenticated
  using (covered_org_id in (select public.auth_scoped_org_ids()) or public.auth_can_read_candidate(candidate_id));
create policy consent_staff_request on public.candidate_consents for insert to authenticated
  with check (covered_org_id in (select public.auth_scoped_org_ids()));

-- ---- job orders / jobs / questions -----------------------------------------
create policy jo_scoped_read on public.job_orders for select to authenticated
  using (responsible_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()));
create policy jo_staff_write on public.job_orders for all to authenticated
  using (responsible_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()))
  with check (responsible_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()));

create policy jobs_scoped_read on public.jobs for select to authenticated
  using (exists (select 1 from public.job_orders jo where jo.id = jobs.job_order_id
                 and (jo.responsible_org_id in (select public.auth_scoped_org_ids()) or jo.employer_org_id in (select public.auth_scoped_org_ids()))));
create policy jobs_staff_write on public.jobs for all to authenticated
  using (exists (select 1 from public.job_orders jo where jo.id = jobs.job_order_id and jo.responsible_org_id in (select public.auth_scoped_org_ids())))
  with check (true);

create policy jsq_read on public.job_screening_questions for select to authenticated using (true);
create policy jsq_write on public.job_screening_questions for all to authenticated
  using (exists (select 1 from public.job_orders jo where jo.id = job_screening_questions.job_order_id and jo.responsible_org_id in (select public.auth_scoped_org_ids())))
  with check (true);

create policy ja_read on public.job_assignments for select to authenticated
  using (exists (select 1 from public.job_orders jo where jo.id = job_assignments.job_order_id and jo.responsible_org_id in (select public.auth_scoped_org_ids())));
create policy ja_write on public.job_assignments for all to authenticated
  using (exists (select 1 from public.job_orders jo where jo.id = job_assignments.job_order_id and jo.responsible_org_id in (select public.auth_scoped_org_ids())))
  with check (true);

-- ---- saved jobs -------------------------------------------------------------
create policy saved_self on public.saved_jobs for all to authenticated
  using (candidate_id = public.auth_candidate_id()) with check (candidate_id = public.auth_candidate_id());

-- ---- applications -----------------------------------------------------------
create policy app_read on public.applications for select to authenticated using (
  candidate_id = public.auth_candidate_id()
  or owning_org_id in (select public.auth_scoped_org_ids())
  or (recruitment_path = 'A' and exists (select 1 from public.job_orders jo where jo.id = applications.job_order_id and jo.employer_org_id in (select public.auth_scoped_org_ids())))
);
create policy app_candidate_insert on public.applications for insert to authenticated
  with check (candidate_id = public.auth_candidate_id());
create policy app_staff_insert on public.applications for insert to authenticated
  with check (owning_org_id in (select public.auth_scoped_org_ids()));
create policy app_candidate_update on public.applications for update to authenticated
  using (candidate_id = public.auth_candidate_id()) with check (candidate_id = public.auth_candidate_id());
create policy app_staff_update on public.applications for update to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids())) with check (owning_org_id in (select public.auth_scoped_org_ids()));

create policy ans_read on public.application_answers for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_answers.application_id
                 and (a.candidate_id = public.auth_candidate_id() or a.owning_org_id in (select public.auth_scoped_org_ids()))));
create policy ans_write on public.application_answers for insert to authenticated
  with check (exists (select 1 from public.applications a where a.id = application_answers.application_id and a.candidate_id = public.auth_candidate_id()));

create policy hist_read on public.application_stage_history for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_stage_history.application_id
                 and (a.candidate_id = public.auth_candidate_id() or a.owning_org_id in (select public.auth_scoped_org_ids()))));
create policy hist_insert on public.application_stage_history for insert to authenticated
  with check (exists (select 1 from public.applications a where a.id = application_stage_history.application_id
    and (a.owning_org_id in (select public.auth_scoped_org_ids()) or a.candidate_id = public.auth_candidate_id())));

-- ---- recruiter notes (never candidate/employer visible) --------------------
create policy notes_read on public.recruiter_notes for select to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) and (visibility <> 'recruiter_private' or author_id = auth.uid()));
create policy notes_write on public.recruiter_notes for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids())) with check (owning_org_id in (select public.auth_scoped_org_ids()));

create policy tags_all on public.candidate_tags for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids())) with check (owning_org_id in (select public.auth_scoped_org_ids()));

-- ---- employer submissions (Ring 3b) ----------------------------------------
create policy sub_read on public.employer_submissions for select to authenticated using (
  submitting_org_id in (select public.auth_scoped_org_ids())
  or (employer_org_id in (select public.auth_scoped_org_ids())
      and status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
      and access_revoked_at is null)
);
create policy sub_staff_write on public.employer_submissions for all to authenticated
  using (submitting_org_id in (select public.auth_scoped_org_ids()))
  with check (submitting_org_id in (select public.auth_scoped_org_ids()));
create policy sub_employer_decide on public.employer_submissions for update to authenticated
  using (employer_org_id in (select public.auth_scoped_org_ids()))
  with check (employer_org_id in (select public.auth_scoped_org_ids()));

create policy scomment_read on public.employer_comments for select to authenticated
  using (exists (select 1 from public.employer_submissions s where s.id = employer_comments.submission_id
                 and (s.submitting_org_id in (select public.auth_scoped_org_ids()) or s.employer_org_id in (select public.auth_scoped_org_ids()))));
create policy scomment_write on public.employer_comments for insert to authenticated
  with check (exists (select 1 from public.employer_submissions s where s.id = employer_comments.submission_id
                 and (s.submitting_org_id in (select public.auth_scoped_org_ids()) or s.employer_org_id in (select public.auth_scoped_org_ids()))));

-- ---- interviews / offers / placements --------------------------------------
create policy interview_read on public.interviews for select to authenticated using (
  owning_org_id in (select public.auth_scoped_org_ids())
  or exists (select 1 from public.applications a where a.id = interviews.application_id and a.candidate_id = public.auth_candidate_id())
  or exists (select 1 from public.employer_submissions s where s.id = interviews.submission_id and s.employer_org_id in (select public.auth_scoped_org_ids()))
);
create policy interview_write on public.interviews for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids())) with check (owning_org_id in (select public.auth_scoped_org_ids()));

create policy offer_read on public.offers for select to authenticated using (
  owning_org_id in (select public.auth_scoped_org_ids())
  or employer_org_id in (select public.auth_scoped_org_ids())
  or exists (select 1 from public.applications a where a.id = offers.application_id and a.candidate_id = public.auth_candidate_id())
);
create policy offer_write on public.offers for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()))
  with check (owning_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()));

create policy placement_read on public.placements for select to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()));
create policy placement_write on public.placements for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids())) with check (owning_org_id in (select public.auth_scoped_org_ids()));

-- ---- billing ----------------------------------------------------------------
create policy sub_pkg_read on public.employer_subscriptions for select to authenticated
  using (employer_org_id in (select public.auth_scoped_org_ids()));
create policy sub_pkg_write on public.employer_subscriptions for all to authenticated
  using (employer_org_id in (select public.auth_scoped_org_ids()) and (public.auth_has_role('accounts') or public.auth_has_role('franchise_admin') or public.auth_is_hq()))
  with check (true);

create policy inv_read on public.invoices for select to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) or employer_org_id in (select public.auth_scoped_org_ids()));
create policy inv_write on public.invoices for all to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) and (public.auth_has_role('accounts') or public.auth_has_role('franchise_admin') or public.auth_is_hq()))
  with check (owning_org_id in (select public.auth_scoped_org_ids()));
create policy invitem_read on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and (i.owning_org_id in (select public.auth_scoped_org_ids()) or i.employer_org_id in (select public.auth_scoped_org_ids()))));
create policy invitem_write on public.invoice_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.owning_org_id in (select public.auth_scoped_org_ids())))
  with check (true);
create policy pay_read on public.payment_records for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = payment_records.invoice_id and (i.owning_org_id in (select public.auth_scoped_org_ids()) or i.employer_org_id in (select public.auth_scoped_org_ids()))));
create policy pay_write on public.payment_records for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = payment_records.invoice_id and i.owning_org_id in (select public.auth_scoped_org_ids())))
  with check (true);

-- ---- notifications / activity / audit --------------------------------------
create policy notif_self on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy activity_read on public.activity_events for select to authenticated
  using (owning_org_id in (select public.auth_scoped_org_ids()) or actor_id = auth.uid());
create policy activity_insert on public.activity_events for insert to authenticated
  with check (actor_id = auth.uid());

-- audit_logs: append-only via app; readable by HQ (and accounts for billing).
create policy audit_read on public.audit_logs for select to authenticated
  using (public.auth_is_hq());
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());
-- No UPDATE/DELETE policy => not editable through the ordinary interface.

create policy flags_write on public.feature_flags for all to authenticated
  using (public.auth_is_hq()) with check (public.auth_is_hq());
create policy pkg_write on public.packages for all to authenticated
  using (public.auth_is_hq()) with check (public.auth_is_hq());
create policy ent_write on public.package_entitlements for all to authenticated
  using (public.auth_is_hq()) with check (public.auth_is_hq());

-- ---- Table privileges -------------------------------------------------------
-- RLS (above) is the row-level gate. These GRANTs give the API roles table-level
-- access; without them PostgREST returns "permission denied". Supabase usually
-- configures these by default, but we set them explicitly so the schema is
-- self-contained and portable. Row visibility is still governed entirely by RLS.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated;
