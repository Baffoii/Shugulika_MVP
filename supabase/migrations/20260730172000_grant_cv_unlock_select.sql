-- Employers need SELECT on unlock wallet tables (RLS still scopes rows).
-- Top-ups worked via security-definer RPCs, but the billing UI read always
-- returned empty without these grants → CV unlocks left stuck at 0.

grant select on public.employer_cv_unlock_balances to authenticated;
grant select on public.employer_cv_unlock_ledger to authenticated;
grant select on public.employer_cv_unlocks to authenticated;
