-- Store language proficiency in Title Case to match the profile UI.
-- Previously: ('basic','conversational','professional','fluent','native')

alter table public.candidate_languages
  drop constraint if exists candidate_languages_proficiency_check;

update public.candidate_languages
set proficiency = initcap(lower(proficiency))
where proficiency is not null;

alter table public.candidate_languages
  add constraint candidate_languages_proficiency_check
  check (
    proficiency is null
    or proficiency in ('Basic', 'Conversational', 'Professional', 'Fluent', 'Native')
  );
