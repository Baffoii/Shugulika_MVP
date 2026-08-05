# Live AI voice interview — enablement runbook

The live AI voice interview ships **disabled**. Migration
`20260810090000_ai_live_interview.sql` sets `feature_flags.ai_interview_enabled`
to `false` and must never be changed to enable it.

Recording a candidate's voice, transcribing it, and sending it to a third-party
provider is not a decision a schema migration can make. A production
administrator enables the flag explicitly, once, after the approvals below.

## Blockers that must clear before enabling

These are **not** yet resolved in the codebase. Enabling the feature before they
are closed would put candidate data and hiring decisions at risk.

### Engineering

| # | Blocker | Why it blocks |
|---|---|---|
| 1 | Candidate-writable session state | Every server action uses the RLS-bound candidate client (`createClient()`), so anything the server writes, a candidate can replicate from the browser with their own JWT — including `status`, `model`, `estimated_cost_usd` and `openai_session_ref`. Sensitive transitions must move behind `SECURITY DEFINER` RPCs or a service-role path. |
| 2 | No durable post-interview processing | Transcription/evaluation runs inside the request. It is awaited (not fire-and-forget) and failure is recorded, but there is still no persisted claim/retry queue, so a cold start or timeout can drop work. |
| 3 | Consent is not versioned or enforced in the database | Consent must be explicit, versioned, immutable and auditable, and checked at the DB boundary before a secret is minted. |
| 4 | Retention is displayed, not enforced | The 180-day value is shown to candidates but nothing deletes recordings or transcripts on schedule. |
| 5 | No rate limiting or deduplication on secret minting | A candidate can request repeated Realtime secrets; there is no cap on concurrent sessions or reconnects, so provider cost is unbounded. |
| 6 | Plan generation and freeze are a single action | `generateAndFreezeAiInterviewPlanAction` drafts and freezes in one step, so no human reviews the questions before they are assigned. |
| 7 | Authorization test coverage is absent | No tests yet for anonymous callers, other candidates, cross-organization access, forged completion, direct RPC abuse, expired assignments or storage-path substitution. |

### Business and legal

These require a decision from someone other than engineering:

- **Retention period.** 180 days is a placeholder. It is *provisional* until a
  documented approval exists. Treat the current value as unapproved.
- **Lawful basis and candidate disclosure.** The disclosure copy, and the
  jurisdictions the pilot runs in, need review — voice recording and biometric
  handling rules vary by country.
- **Cross-border transfer.** Audio and transcripts are sent to OpenAI. Confirm
  this is permitted for the candidate populations in scope.
- **Sub-processor disclosure.** OpenAI must appear in the sub-processor list
  candidates and employers are shown.
- **Decline path.** The alternative offered to a candidate who declines must be
  a real, staffed process, not a dead end.

## Enabling (after all of the above)

```sql
update public.feature_flags
set is_enabled = true,
    notes = 'Enabled <date> by <name> — approval ref <ticket>'
where key = 'ai_interview_enabled';
```

Record who approved it and against which privacy review. To roll back, set
`is_enabled = false`; the flag is read at request time, so no deploy is needed.

## Standing constraints

These hold whether or not the flag is on:

- AI output is **advisory evidence only**. It must never reject, hire, advance,
  score or change an application stage.
- No inference of emotion, personality, accent, protected characteristics,
  health or demographic traits.
- The permanent `OPENAI_API_KEY` never reaches the browser. The client receives
  only a short-lived Realtime client secret minted for its own assignment.
  Enforced by `src/test/security/no-server-credentials-in-client.test.ts`.
- Provider failure must never destroy or hide a candidate's submitted interview.
