-- File 0009: adds contact_email to candidate_profiles so professional contact
-- email can differ from the Supabase Auth sign-in email on public.profiles /
-- auth.users. CV autofill and the profile form write here; they never change
-- the login identity.
alter table public.candidate_profiles
  add column if not exists contact_email citext;

-- Seed from the account email so existing candidates aren't blank; they can
-- edit this independently afterward.
update public.candidate_profiles cp
set contact_email = p.email
from public.profiles p
where cp.user_id = p.id
  and cp.contact_email is null;

notify pgrst, 'reload schema';
