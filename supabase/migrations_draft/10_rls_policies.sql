-- =============================================================================
-- File 10: Row-Level Security. Enable RLS on all sensitive tables; policies use
-- private.* helpers (non-recursive). See docs/database/07 for the full table-by-
-- table stance. This file gives canonical policies for the core tables; apply the
-- same patterns to the remaining Ring-3a / billing / interview tables.
-- =============================================================================

-- Convenience: enable RLS broadly (deny-by-default until a policy grants access).
do $$
declare t text;
begin
  foreach t in array array[
    'user_profiles','organizations','organization_memberships','membership_roles',
    'candidates','candidate_visibility','candidate_search_documents','candidate_engagements',
    'documents','document_versions','document_access_grants','verifications',
    'employer_organizations','employer_notes','employer_subscriptions','invoices','payments',
    'candidate_access_events','job_orders','job_postings','applications','application_stage_events',
    'screening_records','screening_scorecards','assessment_records','reference_checks',
    'application_rejections','candidate_submissions','submission_snapshots','submission_documents',
    'submission_comments','interviews','offers','placements','consent_records',
    'notes','tasks','messages','message_deliveries','communication_preferences',
    'safeguarding_cases','ai_interview_sessions','ai_media_assets','ai_evaluations','ai_human_reviews'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Reference tables: read-all, config.manage write (example)
alter table public.pipeline_stages enable row level security;
create policy ref_read on public.pipeline_stages for select using (true);
create policy ref_write on public.pipeline_stages for all
  using (private.has_permission('config.manage')) with check (private.has_permission('config.manage'));

-- ---- Identity / membership (SIMPLE policies — no helper calls, avoids recursion)
create policy up_self_read on public.user_profiles for select
  using (id = auth.uid() or private.is_super_admin());
create policy up_self_update on public.user_profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- NOTE: this policy must NOT sub-query organization_memberships (that would make
-- the table's own RLS policy recurse). Own rows via user_id; admin/oversight via
-- SECURITY DEFINER helpers (which bypass RLS as the function owner).
create policy mem_self_read on public.organization_memberships for select
  using (
    user_id = auth.uid()
    or private.has_permission('team.manage', organization_id)
    or private.is_super_admin()
  );
create policy mem_admin_write on public.organization_memberships for all
  using (private.has_permission('team.manage', organization_id))
  with check (private.has_permission('team.manage', organization_id));

create policy mr_read on public.membership_roles for select
  using (
    private.is_super_admin()
    or exists (select 1 from public.organization_memberships m
               where m.id = membership_roles.membership_id and m.user_id = auth.uid())
  );

-- ---- Candidate global (Ring 1) --------------------------------------------
create policy cand_self on public.candidates for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy cand_engaged_read on public.candidates for select
  using (
    private.is_super_admin()
    or exists (select 1 from public.candidate_engagements e
               where e.candidate_id = candidates.id
                 and e.owning_organization_id in (select private.authorized_org_ids()))
  );
create policy cand_visibility_self on public.candidate_visibility for all
  using (candidate_id = private.current_candidate_id())
  with check (candidate_id = private.current_candidate_id());

-- Search projection: readable by orgs with search permission / engagement; service maintains it
create policy csd_read on public.candidate_search_documents for select
  using (is_searchable = true and (
     private.has_permission('candidate.search')
     or exists (select 1 from public.candidate_engagements e
                where e.candidate_id = candidate_search_documents.candidate_id
                  and e.owning_organization_id in (select private.authorized_org_ids()))));

-- ---- Ring-3a franchise-private isolation (the core guarantee) --------------
create policy eng_select on public.candidate_engagements for select
  using (owning_organization_id in (select private.authorized_org_ids()));
create policy eng_write on public.candidate_engagements for all
  using (owning_organization_id in (select private.authorized_org_ids())
         and private.has_permission('engagement.create', owning_organization_id))
  with check (owning_organization_id in (select private.authorized_org_ids()));

create policy app_franchise on public.applications for all
  using (owning_organization_id in (select private.authorized_org_ids()))
  with check (owning_organization_id in (select private.authorized_org_ids()));
create policy app_candidate_read on public.applications for select
  using (candidate_id = private.current_candidate_id());
create policy app_employer_pathA_read on public.applications for select
  using (recruitment_path = 'A' and exists (
    select 1 from public.job_orders jo
    where jo.id = applications.job_order_id
      and jo.employer_organization_id in (select private.authorized_org_ids())));

create policy ase_read on public.application_stage_events for select
  using (exists (select 1 from public.applications a where a.id = application_stage_events.application_id
                 and a.owning_organization_id in (select private.authorized_org_ids())));
-- inserts only via advance_application() (SECURITY DEFINER); no direct insert policy.

-- same owning-org pattern for screening/scorecards/assessments/rejections
create policy sr_owner on public.screening_records for all
  using (owning_organization_id in (select private.authorized_org_ids()))
  with check (owning_organization_id in (select private.authorized_org_ids()));
create policy sc_owner on public.screening_scorecards for all
  using (owning_organization_id in (select private.authorized_org_ids()))
  with check (owning_organization_id in (select private.authorized_org_ids()));
create policy as_owner on public.assessment_records for all
  using (owning_organization_id in (select private.authorized_org_ids()))
  with check (owning_organization_id in (select private.authorized_org_ids()));
create policy rej_owner on public.application_rejections for all
  using (owning_organization_id in (select private.authorized_org_ids()))
  with check (owning_organization_id in (select private.authorized_org_ids()));

-- references: extra-restricted (reference.read)
create policy ref_owner_read on public.reference_checks for select
  using (owning_organization_id in (select private.authorized_org_ids())
         and private.has_permission('reference.read', owning_organization_id));
create policy ref_owner_write on public.reference_checks for all
  using (owning_organization_id in (select private.authorized_org_ids())
         and private.has_permission('reference.write', owning_organization_id))
  with check (owning_organization_id in (select private.authorized_org_ids()));

-- ---- Employer submissions (Ring 3b) ---------------------------------------
create policy sub_employer_read on public.candidate_submissions for select
  using (
    ( employer_organization_id in (select private.authorized_org_ids())
      and status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
      and access_revoked_at is null
      and (access_expires_at is null or access_expires_at > now()) )
    or submitting_organization_id in (select private.authorized_org_ids())
    or private.is_super_admin()
  );
create policy sub_franchise_write on public.candidate_submissions for all
  using (submitting_organization_id in (select private.authorized_org_ids()))
  with check (submitting_organization_id in (select private.authorized_org_ids()));
create policy sub_employer_decide on public.candidate_submissions for update
  using (employer_organization_id in (select private.authorized_org_ids())
         and private.has_permission('submission.decide', employer_organization_id));

create policy subsnap_read on public.submission_snapshots for select
  using (exists (select 1 from public.candidate_submissions cs
                 where cs.id = submission_snapshots.candidate_submission_id
                 and (cs.employer_organization_id in (select private.authorized_org_ids())
                      or cs.submitting_organization_id in (select private.authorized_org_ids()))));

-- ---- Documents -------------------------------------------------------------
create policy doc_candidate on public.documents for all
  using (owner_candidate_id = private.current_candidate_id())
  with check (owner_candidate_id = private.current_candidate_id());
create policy doc_org on public.documents for select
  using (owning_organization_id in (select private.authorized_org_ids())
         or exists (select 1 from public.document_access_grants g
                    where g.document_id = documents.id and g.revoked_at is null
                      and (g.expires_at is null or g.expires_at > now())
                      and g.granted_to_organization_id in (select private.authorized_org_ids())));

-- ---- Consent ---------------------------------------------------------------
create policy consent_self on public.consent_records for all
  using (subject_candidate_id = private.current_candidate_id() or subject_user_id = auth.uid())
  with check (subject_candidate_id = private.current_candidate_id() or subject_user_id = auth.uid());
create policy consent_org_read on public.consent_records for select
  using (covered_organization_id in (select private.authorized_org_ids()) or private.is_super_admin());

-- ---- Billing ---------------------------------------------------------------
create policy inv_owner on public.invoices for select
  using (owning_organization_id in (select private.authorized_org_ids())
         or employer_organization_id in (select private.authorized_org_ids()));
create policy inv_edit on public.invoices for update
  using (owning_organization_id in (select private.authorized_org_ids())
         and private.has_permission('invoice.edit', owning_organization_id));
create policy inv_issue on public.invoices for insert
  with check (owning_organization_id in (select private.authorized_org_ids())
              and private.has_permission('invoice.issue', owning_organization_id));

-- ---- Jobs: public read of advertised postings ------------------------------
create policy posting_public_read on public.job_postings for select using (status = 'advertised');
create policy posting_manage on public.job_postings for all
  using (exists (select 1 from public.job_orders jo where jo.id = job_postings.job_order_id
                 and (jo.responsible_organization_id in (select private.authorized_org_ids())
                      or jo.employer_organization_id in (select private.authorized_org_ids()))))
  with check (true);
create policy job_orders_scope on public.job_orders for all
  using (responsible_organization_id in (select private.authorized_org_ids())
         or employer_organization_id in (select private.authorized_org_ids()))
  with check (responsible_organization_id in (select private.authorized_org_ids())
              or employer_organization_id in (select private.authorized_org_ids()));

-- ---- Notes (audience-scoped) ----------------------------------------------
create policy notes_scope on public.notes for all
  using (
    owning_organization_id in (select private.authorized_org_ids())
    and (visibility <> 'recruiter_private' or author_id = auth.uid())
  )
  with check (owning_organization_id in (select private.authorized_org_ids()));

-- ---- Whistleblowing: restricted to safeguarding.read -----------------------
create policy sg_restricted on public.safeguarding_cases for select
  using (private.has_permission('safeguarding.read') or assigned_to = auth.uid());
-- intake insert handled via a SECURITY DEFINER RPC allowing anonymous submission.

-- ---- AI: consent-gated; AI evaluator uses service role (bypasses RLS) ------
create policy ai_session_owner on public.ai_interview_sessions for select
  using (exists (select 1 from public.applications a where a.id = ai_interview_sessions.application_id
                 and a.owning_organization_id in (select private.authorized_org_ids()))
         or exists (select 1 from public.applications a join public.candidates c on c.id=a.candidate_id
                    where a.id = ai_interview_sessions.application_id and c.user_id = auth.uid()));

-- Candidate reads only candidate-audience AI evaluations
create policy ai_eval_read on public.ai_evaluations for select
  using (
    exists (select 1 from public.ai_model_runs r
            join public.ai_interview_sessions s on s.id = r.session_id
            join public.applications a on a.id = s.application_id
            where r.id = ai_evaluations.model_run_id
              and a.owning_organization_id in (select private.authorized_org_ids()))
    or (audience='candidate' and exists (
            select 1 from public.ai_model_runs r
            join public.ai_interview_sessions s on s.id = r.session_id
            join public.applications a on a.id = s.application_id
            join public.candidates c on c.id = a.candidate_id
            where r.id = ai_evaluations.model_run_id and c.user_id = auth.uid()))
  );

-- ---- Audit log: append-only; no update/delete; read for audit.read ---------
revoke insert, update, delete on audit.audit_log from authenticated, anon;
-- SELECT via a security-definer reporting function or granted to an audit role only.

comment on schema public is 'Shugulika application schema. RLS deny-by-default; see docs/database/07.';
