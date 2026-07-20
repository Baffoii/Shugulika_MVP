-- =============================================================================
-- Allow an intentional replacement assignment after a prior interview has
-- been submitted/reviewed, while still preventing duplicate active invitations.
-- =============================================================================

drop index if exists public.uq_iva_active;
create unique index uq_iva_active
  on public.interview_assignments(application_id, template_id)
  where status in ('draft','invited','in_progress');
