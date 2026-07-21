-- =============================================================================
-- Shugulika MVP — asynchronous video interviews: demo seed.
-- One reusable template (3 questions) for the Dar es Salaam franchise, one
-- fresh 'invited' assignment for the demo candidate, and one 'submitted'
-- assignment with mock attempt METADATA ONLY — no real person's recording is
-- included and no storage object exists (the recruiter results page must
-- handle a missing file gracefully, which this doubles as a demo of).
-- Idempotent; depends on demo rows from 0004/0005/0015 and skips cleanly when
-- they are absent.
-- =============================================================================

do $$
declare
  v_franchise uuid := '22222222-2222-2222-2222-222222222222';
  v_recruiter uuid := '10000000-0000-0000-0000-000000000004';
  v_job_order uuid := 'a0000001-0000-0000-0000-000000000001';
  v_demo_cand uuid;   -- candidate@shugulika.test
  v_john_cand uuid := 'c0000001-0000-0000-0000-000000000001'; -- John Smith (0015)
  v_app_demo uuid;
  v_app_john uuid;
  v_template uuid := 'd0000001-0000-0000-0000-000000000001';
  v_assign_invited uuid := 'e0000001-0000-0000-0000-000000000001';
  v_assign_submitted uuid := 'e0000002-0000-0000-0000-000000000002';
begin
  if not exists (select 1 from public.organizations where id = v_franchise)
     or not exists (select 1 from public.job_orders where id = v_job_order) then
    raise notice 'demo prerequisites missing; skipping interview seed';
    return;
  end if;

  select id into v_demo_cand from public.candidate_profiles
  where user_id = '10000000-0000-0000-0000-000000000006';

  -- The demo recruiter comes from 0005; tolerate environments without it.
  if not exists (select 1 from public.profiles where id = v_recruiter) then
    v_recruiter := null;
  end if;

  -- ---- Template + questions --------------------------------------------------
  insert into public.interview_templates
    (id, organization_id, name, description, instructions,
     default_preparation_seconds, default_response_seconds, default_max_attempts,
     retention_days, is_active, created_by)
  values
    (v_template, v_franchise, 'General Screening Interview',
     'A short first-round asynchronous video screen used across roles.',
     'Answer each question as if you were speaking with the hiring team. Find a quiet, well-lit spot and speak clearly. You can retry each answer once.',
     30, 120, 2, 180, true, v_recruiter)
  on conflict (id) do nothing;

  insert into public.interview_template_questions
    (id, template_id, question_text, guidance, display_order, is_required)
  values
    ('d1000001-0000-0000-0000-000000000001', v_template,
     'Tell us about yourself and your professional background.',
     'Aim for a concise summary of your experience and what you are looking for.', 1, true),
    ('d1000002-0000-0000-0000-000000000002', v_template,
     'Describe a challenge you faced at work and how you handled it.',
     'Pick one concrete situation and walk through what you did.', 2, true),
    ('d1000003-0000-0000-0000-000000000003', v_template,
     'Why are you interested in this role?',
     null, 3, true)
  on conflict (id) do nothing;

  -- ---- Invited assignment for the demo candidate ------------------------------
  if v_demo_cand is not null then
    insert into public.applications
      (candidate_id, job_order_id, owning_org_id, recruitment_path, current_stage)
    values (v_demo_cand, v_job_order, v_franchise, 'B', 'interview_screening')
    on conflict (candidate_id, job_order_id) do nothing;
    select id into v_app_demo from public.applications
    where candidate_id = v_demo_cand and job_order_id = v_job_order;

    insert into public.interview_assignments
      (id, template_id, candidate_id, application_id, job_order_id, organization_id,
       assigned_by, status, invited_at, expires_at, candidate_instructions,
       template_name_snapshot, template_instructions_snapshot, retention_days)
    values
      (v_assign_invited, v_template, v_demo_cand, v_app_demo, v_job_order, v_franchise,
       v_recruiter, 'invited', now(), now() + interval '14 days',
       'Please complete this short video interview within two weeks. Good luck!',
       'General Screening Interview',
       'Answer each question as if you were speaking with the hiring team. Find a quiet, well-lit spot and speak clearly. You can retry each answer once.',
       180)
    on conflict (id) do nothing;

    insert into public.interview_assignment_questions
      (id, assignment_id, source_template_question_id, question_text_snapshot,
       question_description_snapshot, display_order, preparation_seconds,
       response_seconds, max_attempts, is_required)
    values
      ('f0000001-0000-0000-0000-000000000001', v_assign_invited, 'd1000001-0000-0000-0000-000000000001',
       'Tell us about yourself and your professional background.',
       'Aim for a concise summary of your experience and what you are looking for.', 1, 30, 120, 2, true),
      ('f0000002-0000-0000-0000-000000000002', v_assign_invited, 'd1000002-0000-0000-0000-000000000002',
       'Describe a challenge you faced at work and how you handled it.',
       'Pick one concrete situation and walk through what you did.', 2, 30, 120, 2, true),
      ('f0000003-0000-0000-0000-000000000003', v_assign_invited, 'd1000003-0000-0000-0000-000000000003',
       'Why are you interested in this role?', null, 3, 30, 120, 2, true)
    on conflict (id) do nothing;

    if not exists (select 1 from public.notifications
                   where subject_type = 'interview_assignment' and subject_id = v_assign_invited) then
      insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
      values ('10000000-0000-0000-0000-000000000006', 'interview',
              'Video interview invitation',
              'You have been invited to complete a video interview for Financial Analyst. Open your Interviews page to begin.',
              'interview_assignment', v_assign_invited);
    end if;
  end if;

  -- ---- Submitted assignment with mock metadata (John Smith, 0015) -------------
  if exists (select 1 from public.candidate_profiles where id = v_john_cand) then
    insert into public.applications
      (candidate_id, job_order_id, owning_org_id, recruitment_path, current_stage)
    values (v_john_cand, v_job_order, v_franchise, 'B', 'interview_screening')
    on conflict (candidate_id, job_order_id) do nothing;
    select id into v_app_john from public.applications
    where candidate_id = v_john_cand and job_order_id = v_job_order;

    insert into public.interview_assignments
      (id, template_id, candidate_id, application_id, job_order_id, organization_id,
       assigned_by, status, invited_at, started_at, submitted_at, expires_at,
       consented_at, privacy_notice_version, instructions_version,
       template_name_snapshot, template_instructions_snapshot, retention_days)
    values
      (v_assign_submitted, v_template, v_john_cand, v_app_john, v_job_order, v_franchise,
       v_recruiter, 'submitted',
       now() - interval '3 days', now() - interval '2 days',
       now() - interval '2 days' + interval '22 minutes', now() + interval '11 days',
       now() - interval '2 days', '2026-07-v1', '2026-07-v1',
       'General Screening Interview',
       'Answer each question as if you were speaking with the hiring team. Find a quiet, well-lit spot and speak clearly. You can retry each answer once.',
       180)
    on conflict (id) do nothing;

    insert into public.interview_assignment_questions
      (id, assignment_id, source_template_question_id, question_text_snapshot,
       question_description_snapshot, display_order, preparation_seconds,
       response_seconds, max_attempts, is_required, status, started_at, completed_at)
    values
      ('f1000001-0000-0000-0000-000000000001', v_assign_submitted, 'd1000001-0000-0000-0000-000000000001',
       'Tell us about yourself and your professional background.',
       'Aim for a concise summary of your experience and what you are looking for.',
       1, 30, 120, 2, true, 'completed',
       now() - interval '2 days', now() - interval '2 days' + interval '9 minutes'),
      ('f1000002-0000-0000-0000-000000000002', v_assign_submitted, 'd1000002-0000-0000-0000-000000000002',
       'Describe a challenge you faced at work and how you handled it.',
       'Pick one concrete situation and walk through what you did.',
       2, 30, 120, 2, true, 'completed',
       now() - interval '2 days' + interval '9 minutes', now() - interval '2 days' + interval '16 minutes'),
      ('f1000003-0000-0000-0000-000000000003', v_assign_submitted, 'd1000003-0000-0000-0000-000000000003',
       'Why are you interested in this role?', null,
       3, 30, 120, 2, true, 'completed',
       now() - interval '2 days' + interval '16 minutes', now() - interval '2 days' + interval '21 minutes')
    on conflict (id) do nothing;

    -- Mock attempt metadata (no storage objects — safe, no real recordings).
    insert into public.interview_response_attempts
      (id, assignment_question_id, assignment_id, candidate_id, attempt_number,
       storage_bucket, storage_path, mime_type, file_size_bytes, duration_seconds,
       preparation_time_used_seconds, recording_started_at, recording_ended_at,
       uploaded_at, upload_status, is_selected_submission, client_metadata)
    values
      -- Q1: two attempts, second selected.
      ('a1000001-0000-0000-0000-000000000001','f1000001-0000-0000-0000-000000000001',
       v_assign_submitted, v_john_cand, 1, 'interview-recordings',
       'organization/22222222-2222-2222-2222-222222222222/interviews/e0000002-0000-0000-0000-000000000002/questions/f1000001-0000-0000-0000-000000000001/attempts/a1000001-0000-0000-0000-000000000001.webm',
       'video/webm', 6291456, 92.4, 21.0,
       now() - interval '2 days' + interval '1 minute', now() - interval '2 days' + interval '3 minutes',
       now() - interval '2 days' + interval '4 minutes', 'uploaded', false, '{"seed":true}'),
      ('a1000002-0000-0000-0000-000000000002','f1000001-0000-0000-0000-000000000001',
       v_assign_submitted, v_john_cand, 2, 'interview-recordings',
       'organization/22222222-2222-2222-2222-222222222222/interviews/e0000002-0000-0000-0000-000000000002/questions/f1000001-0000-0000-0000-000000000001/attempts/a1000002-0000-0000-0000-000000000002.webm',
       'video/webm', 7340032, 104.8, 12.5,
       now() - interval '2 days' + interval '5 minutes', now() - interval '2 days' + interval '7 minutes',
       now() - interval '2 days' + interval '8 minutes', 'uploaded', true, '{"seed":true}'),
      -- Q2: one attempt, selected.
      ('a1000003-0000-0000-0000-000000000003','f1000002-0000-0000-0000-000000000002',
       v_assign_submitted, v_john_cand, 1, 'interview-recordings',
       'organization/22222222-2222-2222-2222-222222222222/interviews/e0000002-0000-0000-0000-000000000002/questions/f1000002-0000-0000-0000-000000000002/attempts/a1000003-0000-0000-0000-000000000003.webm',
       'video/webm', 8388608, 117.2, 28.0,
       now() - interval '2 days' + interval '10 minutes', now() - interval '2 days' + interval '12 minutes',
       now() - interval '2 days' + interval '13 minutes', 'uploaded', true, '{"seed":true}'),
      -- Q3: one attempt, selected (had one failed upload retried successfully).
      ('a1000004-0000-0000-0000-000000000004','f1000003-0000-0000-0000-000000000003',
       v_assign_submitted, v_john_cand, 1, 'interview-recordings',
       'organization/22222222-2222-2222-2222-222222222222/interviews/e0000002-0000-0000-0000-000000000002/questions/f1000003-0000-0000-0000-000000000003/attempts/a1000004-0000-0000-0000-000000000004.webm',
       'video/webm', 5242880, 88.9, 15.0,
       now() - interval '2 days' + interval '17 minutes', now() - interval '2 days' + interval '19 minutes',
       now() - interval '2 days' + interval '20 minutes', 'uploaded', true, '{"seed":true,"upload_retries":1}')
    on conflict (id) do nothing;

    -- A few factual events for the audit trail.
    if not exists (select 1 from public.interview_events where assignment_id = v_assign_submitted) then
      insert into public.interview_events
        (assignment_id, assignment_question_id, actor_user_id, event_type, event_timestamp, metadata)
      values
        (v_assign_submitted, null, '10000000-0000-0000-0000-000000000011', 'interview_opened', now() - interval '2 days', '{"seed":true}'),
        (v_assign_submitted, null, '10000000-0000-0000-0000-000000000011', 'consent_given', now() - interval '2 days', '{"seed":true}'),
        (v_assign_submitted, 'f1000001-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'question_opened', now() - interval '2 days' + interval '30 seconds', '{"seed":true}'),
        (v_assign_submitted, 'f1000001-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'retry_selected', now() - interval '2 days' + interval '4 minutes', '{"seed":true}'),
        (v_assign_submitted, null, '10000000-0000-0000-0000-000000000011', 'interview_submitted', now() - interval '2 days' + interval '22 minutes', '{"seed":true}');
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
