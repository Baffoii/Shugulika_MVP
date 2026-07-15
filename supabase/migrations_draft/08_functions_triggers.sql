-- =============================================================================
-- File 08: Finalized helper functions, audit trigger, transition functions,
--          search-document maintenance, invoice numbering, profile completion.
-- (Selected canonical implementations; wire remaining triggers per docs/database/06.)
-- =============================================================================

-- ---- Finalized RLS helpers (redefine skeletons from file 00) ---------------
create or replace function private.has_permission(p_key text, p_org uuid default null)
returns boolean language sql stable security definer set search_path = private, public as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    join public.permissions p on p.id = rp.permission_id
    where m.user_id = auth.uid() and m.status = 'active'
      and p.key = p_key
      and (p_org is null or m.organization_id = p_org)
  );
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = private, public as $$
  select private.has_permission('platform.super_admin');
$$;

create or replace function private.authorized_org_ids()
returns setof uuid language sql stable security definer set search_path = private, public as $$
  -- direct active memberships
  select m.organization_id
  from public.organization_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and (m.ends_on is null or m.ends_on >= current_date)
  union
  -- controlled HQ oversight / approved transfer grants (R-003/OD-10)
  select r.to_organization_id
  from public.organization_memberships m
  join public.organization_relationships r
       on r.from_organization_id = m.organization_id
      and r.relationship_type in ('oversight','transfer_grant')
      and r.status = 'active'
      and (r.valid_until is null or r.valid_until > now())
  where m.user_id = auth.uid() and m.status = 'active'
    and private.has_permission('hq.oversight.read');
$$;

-- ---- Generic audit trigger (writes to append-only audit.audit_log) ---------
create or replace function private.write_audit()
returns trigger language plpgsql security definer set search_path = private, public, audit as $$
declare v_before jsonb; v_after jsonb; v_id uuid;
begin
  if tg_op = 'DELETE' then v_before := to_jsonb(old); v_after := null; v_id := old.id;
  elsif tg_op = 'UPDATE' then v_before := to_jsonb(old); v_after := to_jsonb(new); v_id := new.id;
  else v_before := null; v_after := to_jsonb(new); v_id := new.id;
  end if;
  insert into audit.audit_log(actor_user_id, action, entity_type, entity_id, before_value, after_value)
  values (auth.uid(), tg_op || ':' || tg_table_name, tg_table_name, v_id, v_before, v_after);
  return coalesce(new, old);
end $$;
-- Attach to sensitive tables, e.g.:
--   create trigger trg_audit_submissions after insert or update or delete on public.candidate_submissions
--     for each row execute function private.write_audit();
-- (Attach for: candidate_submissions, consent_records, documents, application_rejections,
--  invoices, payments, membership_roles, safeguarding_cases, offers, placements.)

-- ---- Application stage transition (enforces mandatory gates, R-062) ---------
create or replace function public.advance_application(p_application uuid, p_to_stage uuid, p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path = private, public as $$
declare v_app public.applications; v_from uuid; v_stage public.pipeline_stages; v_prev_ts timestamptz;
begin
  select * into v_app from public.applications where id = p_application for update;
  if not found then raise exception 'application not found'; end if;
  if not (v_app.owning_organization_id in (select private.authorized_org_ids())) then
    raise exception 'not authorized for this application';
  end if;
  select * into v_stage from public.pipeline_stages where id = p_to_stage;
  if v_stage.stage_class <> 'candidate' then
     raise exception 'target stage % is not a candidate stage', v_stage.key;
  end if;

  -- Gate: cannot pass Shortlisted without a screening scorecard (R-062)
  if v_stage.ordinal > (select ordinal from public.pipeline_stages where key='shortlisted') then
    if not exists (select 1 from public.screening_scorecards s where s.application_id = p_application) then
      raise exception 'Complete required screening scorecard before advancing past Shortlisted';
    end if;
  end if;

  -- Gate: entering Client Submission requires a valid employer-specific consent (R-031)
  if v_stage.key = 'client_submission' then
    if not exists (
      select 1 from public.candidate_submissions cs
      join public.consent_records c on c.id = cs.consent_record_id
      where cs.application_id = p_application and c.withdrawn_at is null
        and (c.expires_at is null or c.expires_at > now())
    ) then
      raise exception 'Employer-specific consent required before Client Submission';
    end if;
  end if;

  v_from := v_app.current_stage_id;
  select max(occurred_at) into v_prev_ts from public.application_stage_events where application_id = p_application;

  insert into public.application_stage_events(application_id, from_stage_id, to_stage_id, actor_user_id, time_in_previous_stage, metadata)
  values (p_application, v_from, p_to_stage, auth.uid(), now() - coalesce(v_prev_ts, v_app.created_at), p_metadata);

  update public.applications set current_stage_id = p_to_stage, updated_at = now() where id = p_application;
end $$;

-- ---- Submit candidate to client (consent gate + immutable snapshot, R-070) --
create or replace function public.submit_candidate_to_client(p_submission uuid)
returns void language plpgsql security definer set search_path = private, public as $$
declare v_sub public.candidate_submissions; v_ok boolean;
begin
  select * into v_sub from public.candidate_submissions where id = p_submission for update;
  if not found then raise exception 'submission not found'; end if;
  if not (v_sub.submitting_organization_id in (select private.authorized_org_ids())) then
    raise exception 'not authorized'; end if;

  select exists (
    select 1 from public.consent_records c
    where c.id = v_sub.consent_record_id
      and c.covered_organization_id = v_sub.employer_organization_id
      and c.consent_purpose_id = (select id from public.consent_purposes where key='employer_submission')
      and c.withdrawn_at is null and (c.expires_at is null or c.expires_at > now())
  ) into v_ok;
  if not v_ok then raise exception 'valid employer-specific consent required (general consent is insufficient)'; end if;

  update public.candidate_submissions
     set status='submitted', submitted_at=now(), updated_at=now()
   where id = p_submission;

  insert into public.submission_events(candidate_submission_id, from_status, to_status, actor_user_id)
  values (p_submission, v_sub.status, 'submitted', auth.uid());
  -- NB: caller must have created the immutable submission_snapshot + submission_documents beforehand.
end $$;

-- ---- Consent withdrawal cascade (R-030 §5, scenario 5) ---------------------
create or replace function private.after_consent_withdrawn()
returns trigger language plpgsql security definer set search_path = private, public as $$
begin
  if new.withdrawn_at is not null and (old.withdrawn_at is null) then
    update public.candidate_submissions
       set status='access_revoked', access_revoked_at=now(), updated_at=now()
     where consent_record_id = new.id and status not in ('withdrawn','access_revoked','access_expired');
    update public.document_access_grants
       set revoked_at = now()
     where submission_id in (select id from public.candidate_submissions where consent_record_id = new.id)
       and revoked_at is null;
    insert into public.dashboard_exceptions(exception_type, severity, subject_type, subject_id)
    values ('consent_withdrawn_active_submission','info','consent_record', new.id);
  end if;
  return new;
end $$;
create trigger trg_consent_withdraw after update on public.consent_records
  for each row execute function private.after_consent_withdrawn();

-- ---- Create placement from accepted offer (R-091) --------------------------
create or replace function public.create_placement_from_offer(p_offer uuid)
returns uuid language plpgsql security definer set search_path = private, public as $$
declare v_offer public.offers; v_app public.applications; v_placement uuid;
begin
  select * into v_offer from public.offers where id = p_offer;
  if v_offer.status <> 'accepted' then raise exception 'offer not accepted'; end if;
  select * into v_app from public.applications where id = v_offer.application_id;

  insert into public.placements(offer_id, application_id, employer_organization_id, owning_organization_id, created_by)
  values (p_offer, v_app.id,
          (select employer_organization_id from public.job_orders where id = v_app.job_order_id),
          v_app.owning_organization_id, auth.uid())
  returning id into v_placement;

  -- emit invoicing task to accounts
  insert into public.tasks(owning_organization_id, title, subject_type, subject_id, task_type)
  values (v_app.owning_organization_id, 'Create placement invoice', 'placement', v_placement, 'invoicing');
  return v_placement;
end $$;

-- ---- Invoice number generator (advisory-locked) ----------------------------
create or replace function public.generate_invoice_number()
returns text language plpgsql security definer set search_path = public as $$
declare v_seq bigint;
begin
  perform pg_advisory_xact_lock(hashtext('invoice_number'));
  select coalesce(max(substring(invoice_number from '\d+$')::bigint),0)+1 into v_seq from public.invoices;
  return 'SHG-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 6, '0');
end $$;

-- ---- Candidate search-document maintenance (only approved fields, R-012) ----
create or replace function private.rebuild_candidate_search(p_candidate uuid)
returns void language plpgsql security definer set search_path = private, public as $$
declare v_vis public.candidate_visibility; v_cand public.candidates;
begin
  select * into v_vis from public.candidate_visibility where candidate_id = p_candidate;
  select * into v_cand from public.candidates where id = p_candidate;
  insert into public.candidate_search_documents as d
    (candidate_id, is_searchable, search_tsv, approved_skills, preferred_roles, country_id, city, languages, availability)
  values (
    p_candidate,
    coalesce(v_vis.searchable,false),
    to_tsvector('simple', unaccent(coalesce(v_cand.professional_summary,'') || ' ' ||
      coalesce((select string_agg(coalesce(s.name, cs.custom_label),' ')
        from public.candidate_skills cs left join public.skills s on s.id=cs.skill_id
        where cs.candidate_id=p_candidate and cs.is_searchable),''))),
    coalesce((select array_agg(coalesce(s.name, cs.custom_label))
        from public.candidate_skills cs left join public.skills s on s.id=cs.skill_id
        where cs.candidate_id=p_candidate and cs.is_searchable), '{}'),
    coalesce((select array_agg(role_title) from public.candidate_preferred_roles where candidate_id=p_candidate),'{}'),
    v_cand.country_id, v_cand.current_city,
    coalesce((select array_agg(l.code) from public.candidate_languages cl join public.languages l on l.id=cl.language_id where cl.candidate_id=p_candidate),'{}'),
    (select availability from public.candidate_preferences where candidate_id=p_candidate)
  )
  on conflict (candidate_id) do update set
    is_searchable=excluded.is_searchable, search_tsv=excluded.search_tsv,
    approved_skills=excluded.approved_skills, preferred_roles=excluded.preferred_roles,
    country_id=excluded.country_id, city=excluded.city, languages=excluded.languages,
    availability=excluded.availability;
  -- NOTE: references, contact, salary, rejection reasons, employer feedback are NEVER written here.
end $$;

-- ---- Profile completion (R-014) --------------------------------------------
create or replace function private.refresh_profile_completion(p_candidate uuid)
returns void language plpgsql security definer set search_path = private, public as $$
declare v int := 0;
begin
  if exists (select 1 from public.candidates c where c.id=p_candidate and c.phone is not null) then v:=v+20; end if;
  if exists (select 1 from public.candidate_educations where candidate_id=p_candidate) then v:=v+20; end if;
  if exists (select 1 from public.candidate_work_experiences where candidate_id=p_candidate) then v:=v+20; end if;
  if exists (select 1 from public.candidate_skills where candidate_id=p_candidate) then v:=v+20; end if;
  if exists (select 1 from public.documents where owner_candidate_id=p_candidate
             and document_type_id=(select id from public.document_types where key='cv')) then v:=v+20; end if;
  update public.candidates set profile_completion_pct=v where id=p_candidate;
end $$;

-- ---- Profile-on-signup: create user_profiles row from auth.users -----------
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = private, public as $$
begin
  insert into public.user_profiles(id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
-- create trigger on_auth_user_created after insert on auth.users
--   for each row execute function private.handle_new_auth_user();
