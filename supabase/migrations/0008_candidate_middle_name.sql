-- File 0008: adds middle_name to candidate_profiles so the profile form and
-- CV-autofill suggestions can capture it (optional — many candidates have
-- none). Phone and email already exist on public.profiles (the shared
-- account row) and are surfaced in the UI from there instead of being
-- duplicated onto candidate_profiles.
alter table public.candidate_profiles add column if not exists middle_name text;

notify pgrst, 'reload schema';
