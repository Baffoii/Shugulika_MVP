-- Restore staff ability to insert application_status notifications for candidates.
-- Migration 0013 added this policy; it was missing on the remote DB, so recruiter
-- stage moves updated applications but notifyCandidateStatus failed RLS silently.

drop policy if exists notif_staff_insert on public.notifications;
create policy notif_staff_insert on public.notifications for insert to authenticated
  with check (
    public.auth_is_hq()
    or (
      subject_type = 'application'
      and subject_id is not null
      and exists (
        select 1
        from public.applications a
        join public.candidate_profiles cp on cp.id = a.candidate_id
        where a.id = notifications.subject_id
          and cp.user_id = notifications.user_id
          and a.owning_org_id in (select public.auth_scoped_org_ids())
      )
    )
  );

notify pgrst, 'reload schema';
