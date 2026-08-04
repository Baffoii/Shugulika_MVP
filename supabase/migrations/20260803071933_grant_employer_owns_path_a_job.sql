-- Preview/API routes call this helper via the authenticated role.
-- Search RPCs are SECURITY DEFINER and did not need the grant; zoho-cv-preview does.

grant execute on function public.employer_owns_path_a_job(uuid, uuid) to authenticated;
