-- Make Kilimanjaro Tech Labs "IT Support Technician" a Direct (Path A) role
-- so employers can use Find candidates / pool search against it.
-- Software Developer stays Managed (Path B).

update public.job_orders
set recruitment_path = 'A'
where id = 'a0000005-0000-0000-0000-000000000005'
  and employer_org_id = '55555555-5555-5555-5555-555555555555';

update public.applications
set recruitment_path = 'A'
where job_order_id = 'a0000005-0000-0000-0000-000000000005';
