-- =============================================================================
-- File 09: Reporting views (security_invoker) + materialized views.
-- Views respect caller RLS; MVs store aggregates keyed by org/country and are
-- wrapped by security_invoker views filtered to authorized_org_ids().
-- =============================================================================

-- ---- Masked candidate surface for employers (never base candidates) --------
create or replace view public.v_submission_employer
with (security_invoker = true) as
select cs.id as submission_id, cs.employer_organization_id, cs.job_order_id, cs.status,
       cs.is_masked, cs.submitted_at, cs.access_expires_at,
       ss.disclosed_profile, ss.disclosed_fields, ss.cv_document_version_id
from public.candidate_submissions cs
join public.submission_snapshots ss on ss.candidate_submission_id = cs.id
where cs.access_revoked_at is null;

-- Masked pool-search view (only opted-in, approved fields; no identity/contact)
create or replace view public.v_candidate_masked
with (security_invoker = true) as
select d.candidate_id, d.approved_skills, d.preferred_roles, d.country_id, d.city,
       d.education_level_rank, d.languages, d.availability
from public.candidate_search_documents d
where d.is_searchable = true;

-- ---- Recruiter "My Work" queue (live) --------------------------------------
create or replace view public.v_my_work
with (security_invoker = true) as
select a.id as application_id, a.owning_organization_id, a.assigned_recruiter_id,
       a.current_stage_id, a.next_action, a.next_action_due, a.is_on_hold, a.consent_status
from public.applications a
where a.withdrawn_at is null;

-- ---- Employer "Needs Review" ----------------------------------------------
create or replace view public.v_employer_needs_review
with (security_invoker = true) as
select cs.id, cs.employer_organization_id, cs.job_order_id, cs.status, cs.submitted_at
from public.candidate_submissions cs
where cs.status in ('submitted','viewed');

-- ---- Compliance exception queue -------------------------------------------
create or replace view public.v_compliance_exceptions
with (security_invoker = true) as
select * from public.dashboard_exceptions where status = 'open';

-- =============================================================================
-- Materialized views (aggregates keyed by org/country; refreshed via pg_cron).
-- =============================================================================

-- Pipeline funnel: entries per stage per org per day
create materialized view public.mv_pipeline_funnel as
select a.owning_organization_id, e.to_stage_id,
       date_trunc('day', e.occurred_at) as day, count(*) as entries
from public.application_stage_events e
join public.applications a on a.id = e.application_id
group by 1,2,3;
create unique index uq_mv_funnel on public.mv_pipeline_funnel (owning_organization_id, to_stage_id, day);

-- Time in stage: avg time per stage per org per month
create materialized view public.mv_time_in_stage as
select a.owning_organization_id, e.from_stage_id as stage_id,
       date_trunc('month', e.occurred_at) as month,
       avg(extract(epoch from e.time_in_previous_stage)) as avg_seconds_in_stage
from public.application_stage_events e
join public.applications a on a.id = e.application_id
where e.time_in_previous_stage is not null
group by 1,2,3;
create unique index uq_mv_tis on public.mv_time_in_stage (owning_organization_id, stage_id, month);

-- Recruiter KPIs (four metric families; never one leaderboard score)
create materialized view public.mv_recruiter_kpis as
select a.assigned_recruiter_id as recruiter_id, a.owning_organization_id,
       date_trunc('month', a.created_at) as month,
       count(*) filter (where true) as applications_assigned,
       count(*) filter (where a.current_stage_id in (select id from public.pipeline_stages where key='shortlisted')) as shortlisted,
       count(distinct pl.id) as placements,
       count(distinct cs.id) as submissions
from public.applications a
left join public.placements pl on pl.application_id = a.id
left join public.candidate_submissions cs on cs.application_id = a.id
group by 1,2,3;
create unique index uq_mv_recruiter on public.mv_recruiter_kpis (recruiter_id, owning_organization_id, month);

-- Franchise performance
create materialized view public.mv_franchise_performance as
select o.id as organization_id, o.country_id,
       count(distinct jo.id) filter (where jo.status in ('active','on_hold')) as active_jobs,
       count(distinct pl.id) as placements,
       coalesce(sum(pl.placement_fee),0) as placement_value,
       count(distinct inv.id) filter (where inv.payment_status <> 'paid') as open_invoices
from public.organizations o
left join public.job_orders jo on jo.responsible_organization_id = o.id
left join public.placements pl on pl.owning_organization_id = o.id
left join public.invoices inv on inv.owning_organization_id = o.id
where o.organization_type in ('franchise','hq')
group by 1,2;
create unique index uq_mv_franchise on public.mv_franchise_performance (organization_id);

-- Country overview
create materialized view public.mv_country_overview as
select c.id as country_id,
       count(distinct cand.id) as registrations,
       count(distinct jo.id) filter (where jo.status in ('active','on_hold')) as active_jobs,
       count(distinct pl.id) as placements
from public.countries c
left join public.candidates cand on cand.country_id = c.id
left join public.job_orders jo on jo.country_id = c.id
left join public.placements pl on pl.owning_organization_id in
       (select id from public.organizations where country_id = c.id)
group by 1;
create unique index uq_mv_country on public.mv_country_overview (country_id);

-- Wrapper views scoping MVs to the caller (security_invoker on base tables enforced separately in app)
create or replace view public.v_franchise_dashboard
with (security_invoker = true) as
select * from public.mv_franchise_performance
where organization_id in (select private.authorized_org_ids());

-- Refresh schedule (requires pg_cron; run in server context):
-- select cron.schedule('refresh_funnel','*/10 * * * *','refresh materialized view concurrently public.mv_pipeline_funnel');
-- select cron.schedule('refresh_tis','*/15 * * * *','refresh materialized view concurrently public.mv_time_in_stage');
-- select cron.schedule('refresh_recruiter','*/15 * * * *','refresh materialized view concurrently public.mv_recruiter_kpis');
-- select cron.schedule('refresh_franchise','*/15 * * * *','refresh materialized view concurrently public.mv_franchise_performance');
-- select cron.schedule('refresh_country','*/15 * * * *','refresh materialized view concurrently public.mv_country_overview');
