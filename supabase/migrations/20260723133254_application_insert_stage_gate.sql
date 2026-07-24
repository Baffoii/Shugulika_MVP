-- Force application inserts through the entry stage unless the pipeline RPC session
-- flag is set (test fixtures / controlled reopen paths). Prevents clients from
-- INSERTing directly into hired / client_submission and skipping gates.

create or replace function private.enforce_application_insert_stage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if private.pipeline_stage_rpc_enabled() then
    return new;
  end if;

  if new.current_stage is distinct from 'cv_review' then
    raise exception
      'New applications must start in cv_review (got %). Use advance_application after create.',
      new.current_stage;
  end if;

  -- Clear rejection metadata on fresh applications.
  new.rejected_from_stage := null;
  new.rejected_at := null;
  new.rejection_reason := null;

  return new;
end;
$$;

drop trigger if exists trg_applications_insert_stage on public.applications;
create trigger trg_applications_insert_stage
  before insert on public.applications
  for each row
  execute function private.enforce_application_insert_stage();
