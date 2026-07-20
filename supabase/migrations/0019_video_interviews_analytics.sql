-- =============================================================================
-- Shugulika MVP — asynchronous video interviews: analytics views.
-- Deterministic, factual metrics derived from attempts + timestamps only —
-- no scoring, no judgment. security_invoker so the querying user's RLS on the
-- underlying tables governs visibility (candidates see their own, staff their
-- org scope).
-- =============================================================================

create or replace view public.interview_question_analytics
with (security_invoker = on) as
select
  q.id as assignment_question_id,
  q.assignment_id,
  q.display_order,
  q.is_required,
  q.status,
  count(a.id) filter (where a.recording_started_at is not null or a.upload_status <> 'pending')::int as attempts_used,
  greatest(count(a.id) filter (where a.recording_started_at is not null or a.upload_status <> 'pending')::int - 1, 0) as retry_count,
  max(a.attempt_number) filter (where a.is_selected_submission) as selected_attempt_number,
  max(a.duration_seconds) filter (where a.is_selected_submission) as selected_response_duration_seconds,
  avg(a.duration_seconds) as average_attempt_duration_seconds,
  coalesce(sum(a.duration_seconds), 0) as total_attempt_duration_seconds,
  max(a.preparation_time_used_seconds) filter (where a.is_selected_submission) as preparation_time_used_seconds,
  case when q.started_at is not null and q.completed_at is not null
       then extract(epoch from (q.completed_at - q.started_at))
  end as time_from_question_opened_to_completion_seconds,
  count(a.id) filter (where a.upload_status = 'failed')::int as upload_failure_count
from public.interview_assignment_questions q
left join public.interview_response_attempts a on a.assignment_question_id = q.id
group by q.id;

create or replace view public.interview_assignment_analytics
with (security_invoker = on) as
select
  ia.id as assignment_id,
  ia.status,
  count(q.id) filter (where q.is_required)::int as required_question_count,
  count(q.id)::int as total_question_count,
  count(q.id) filter (where q.status = 'completed')::int as completed_question_count,
  case when count(q.id) filter (where q.is_required) > 0
       then round(
         100.0 * count(q.id) filter (where q.is_required and q.status = 'completed')
         / count(q.id) filter (where q.is_required))
       else 0
  end::int as completion_percentage,
  ia.started_at,
  ia.submitted_at,
  case when ia.started_at is not null and ia.submitted_at is not null
       then extract(epoch from (ia.submitted_at - ia.started_at))
  end as total_elapsed_seconds,
  count(a.id) filter (where a.recording_started_at is not null or a.upload_status <> 'pending')::int as total_attempts,
  greatest(
    count(a.id) filter (where a.recording_started_at is not null or a.upload_status <> 'pending')::int
      - count(distinct a.assignment_question_id) filter (where a.recording_started_at is not null or a.upload_status <> 'pending')::int,
    0
  ) as total_retries,
  avg(a.duration_seconds) filter (where a.is_selected_submission) as average_final_response_duration_seconds,
  case when count(distinct a.assignment_question_id) > 0
       then round(count(a.id)::numeric / count(distinct a.assignment_question_id), 2)
  end as average_attempts_per_question,
  coalesce(sum(a.duration_seconds) filter (where a.is_selected_submission), 0) as total_final_recording_duration_seconds,
  coalesce(sum(a.duration_seconds), 0) as total_recording_duration_seconds,
  count(a.id) filter (where a.upload_status = 'failed')::int as upload_failure_count,
  coalesce(sum(a.file_size_bytes) filter (where a.upload_status = 'uploaded'), 0)::bigint as total_uploaded_bytes
from public.interview_assignments ia
left join public.interview_assignment_questions q on q.assignment_id = ia.id
left join public.interview_response_attempts a on a.assignment_question_id = q.id
group by ia.id;

grant select on public.interview_question_analytics, public.interview_assignment_analytics to authenticated;
