# Prompt: enrich existing job descriptions + generate structured requirements

Paste everything in the fenced block below into Cursor (which has Supabase access).
It enriches every existing `job_orders` row's prose fields **and** populates the
`job_requirements` table so the AI CV-screening feature has data to score against.

---

````text
You have direct access to this project's Supabase database. Your task is to
enrich the EXISTING job postings and generate structured requirements for them.
Do not invent new jobs.

CONTEXT
- This is Shugulika, a recruitment platform for the Tanzanian / East African job
  market. Employers are local SMEs and mid-market companies. Salaries are in TZS.
  Locations are cities like Dar es Salaam, Arusha, Zanzibar, Mwanza. Many roles
  operate in both English and Swahili.
- These are ordinary local roles (e.g. Accountant, Registered Nurse, Warehouse
  Assistant, Software Developer, Hotel Front Desk Agent). Write accordingly:
  professional, concrete, and PROPORTIONATE. This is NOT a Silicon Valley tech
  company — keep it grounded and realistic, not grandiose. Aim for roughly
  one-third the length and flourish of a big-US-tech job post.

STEP 1 — READ
Query all rows from public.job_orders. For each row note: id, title, department,
description, responsibilities, requirements, country_code, city, employment_type
(full_time/part_time/contract), work_arrangement (on_site/hybrid/remote),
experience_level (entry/mid/senior), salary_min, salary_max, salary_currency,
vacancy_count. Also read the employer via
public.organizations (join on employer_org_id) for the company name and industry.
Treat the existing description/responsibilities/requirements as the source of
truth for the role's INTENT — enrich and expand them, never contradict the
seniority, location, or function they imply.

STEP 2 — WRITE THE PROSE (update public.job_orders)
For each job, compose and UPDATE these text columns. Keep the candidate-market
realistic; do NOT fabricate benefits, salary, or company claims you cannot infer.

- description  (2–3 short paragraphs, ~90–160 words total):
    Para 1: one line on the employer and what they do (from the org name/industry).
    Para 2: what this role is and why it matters to the team.
    Optional Para 3: one line on the working context (location, on-site/hybrid,
    shift work, English/Swahili) when relevant.
- responsibilities  (5–8 bullets, each starting with "• " and separated by newlines):
    Concrete, day-to-day duties phrased with action verbs. Expand the existing
    short list; keep each bullet to one line.
- requirements  (human-readable list, "• " bullets separated by newlines):
    First a "Must have:" group (4–7 bullets), then a "Nice to have:" group
    (2–4 bullets). Each requirement must be CONCRETE and verifiable from a CV
    (e.g. "3+ years in financial analysis", "Registered Nurse licence",
    "Fluent written and spoken English and Swahili") — avoid vague traits like
    "team player" unless tied to something observable.
- benefits  (OPTIONAL, only if reasonable for the role/market; 2–4 "• " bullets,
    e.g. health cover, training, transport allowance). If you cannot reasonably
    infer any, set benefits to NULL rather than inventing perks.

Do NOT modify: title, department, salary_min, salary_max, salary_currency,
country_code, city, status, or any id/timestamp column. Leave salary untouched.

STYLE RULES
- Plain, confident, human tone. Short sentences. No buzzword soup, no "rockstar/
  ninja", no emoji.
- Spell out an acronym on first use only when a local candidate might not know it.
- Inclusive and lawful: never reference age, gender, marital/family status,
  religion, ethnicity, or nationality, and never imply a preference for any.
- Keep must-haves genuinely essential; push "would be a plus" items to Nice to have.

STEP 3 — GENERATE STRUCTURED REQUIREMENTS (public.job_requirements)
For each job, turn the Must have / Nice to have list into rows in
public.job_requirements. Columns and allowed values:
  job_order_id  -> the job's id
  category      -> one of: skill | experience | education | language |
                   certification | responsibility | other
  label         -> the concise requirement, e.g. "3+ years in logistics"
  detail        -> optional one-line clarification, else NULL
  importance    -> 'must_have' for the Must-have group, 'nice_to_have' otherwise
  min_years     -> integer number of years when the requirement states one
                   (e.g. "3+ years" -> 3); otherwise NULL
  ordinal       -> 0-based order (must-haves first, then nice-to-haves)
  source        -> 'ai_parsed'   (ALWAYS this value)
  created_by    -> NULL
Produce 6–11 requirement rows per job. Every label must be independently checkable
against a CV. Map sensibly: a degree/licence -> education or certification; a
spoken-language need -> language; years-in-a-function -> experience; a tool/skill
-> skill.

STEP 4 — OUTPUT AS IDEMPOTENT SQL
Return a single SQL script I can run in the Supabase SQL editor. It must be safe
to run more than once:
- Use one UPDATE public.job_orders SET ... WHERE id = '<id>'; per job.
- Before inserting requirements for a job, delete its prior AI-parsed rows so the
  script is re-runnable:
      delete from public.job_requirements
        where job_order_id = '<id>' and source = 'ai_parsed';
  then INSERT the new rows for that id.
- Escape single quotes/apostrophes correctly (e.g. driver''s licence). Use E'...'
  or chr(10) for the newline-separated bullet lists so bullets render on separate
  lines.
- Do not wrap in a transaction that could half-apply; group each job's UPDATE +
  DELETE + INSERT together with a comment header naming the job title.

Before writing the SQL, show me a preview of ONE completed job (the prose + its
requirement rows) so I can confirm the tone and depth, then generate the rest.
````

---

## Worked example (target tone & depth — a local role, not a US-tech epic)

Use this as the calibration bar. This is roughly the ceiling of length/polish you
want; simpler roles (receptionist, warehouse assistant) should be shorter still.

**Job:** Financial Analyst — Finance — Dar es Salaam — hybrid — mid

**description**
> Bahari Financial Group is a growing pan-African financial services company
> serving businesses and individuals across the region.
>
> As Financial Analyst, you'll turn financial data into clear insight that guides
> planning and day-to-day decisions. You'll build the models and reporting the
> finance team relies on, and work closely with managers across departments.
>
> This is a hybrid role based in Dar es Salaam.

**responsibilities**
> • Build and maintain financial models for forecasting and planning
> • Prepare accurate monthly management reporting and variance analysis
> • Support the annual budgeting process across departments
> • Analyse performance and flag risks and opportunities to leadership
> • Help improve reporting tools, templates, and processes

**requirements**
> Must have:
> • 2+ years in financial analysis or a similar finance role
> • Strong Excel and financial-modelling skills
> • Degree in finance, accounting, economics, or related field
> • Clear written and spoken English
>
> Nice to have:
> • CPA (in progress or qualified)
> • Experience in financial services or a multi-country business
> • Familiarity with an accounting/ERP system

**job_requirements rows**

| category | label | importance | min_years | ordinal |
|---|---|---|---|---|
| experience | 2+ years in financial analysis | must_have | 2 | 0 |
| skill | Financial modelling in Excel | must_have | – | 1 |
| education | Degree in finance/accounting/economics | must_have | – | 2 |
| language | Clear written & spoken English | must_have | – | 3 |
| certification | CPA (in progress or qualified) | nice_to_have | – | 4 |
| experience | Financial-services or multi-country experience | nice_to_have | – | 5 |
| skill | Accounting/ERP system familiarity | nice_to_have | – | 6 |
