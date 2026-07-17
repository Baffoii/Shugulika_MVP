-- File 0011: candidates may replace their own screening answers when
-- resubmitting an application (unique constraint keeps one app per role).
create policy ans_candidate_update on public.application_answers for update to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_answers.application_id
        and a.candidate_id = public.auth_candidate_id()
    )
  )
  with check (
    exists (
      select 1 from public.applications a
      where a.id = application_answers.application_id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

create policy ans_candidate_delete on public.application_answers for delete to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_answers.application_id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

notify pgrst, 'reload schema';
