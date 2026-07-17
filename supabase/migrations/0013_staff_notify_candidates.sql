/* 0013 — allow staff to notify candidates about their applications.

   notif_self only permits inserts where user_id = auth.uid(), so recruiter
   stage-change notifications for candidates silently fail. This policy lets
   scoped staff insert an application_status notification for the candidate
   on an application they can already manage. */

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
