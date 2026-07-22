-- Temporary: route all demo/live roles through Shugulika-managed (path B).
-- Direct employer (path A) remains supported in schema/UI for later.
update public.job_orders
set recruitment_path = 'B'
where recruitment_path = 'A';

update public.applications
set recruitment_path = 'B'
where recruitment_path = 'A';
