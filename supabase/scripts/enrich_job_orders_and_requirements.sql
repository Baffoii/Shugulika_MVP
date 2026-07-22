-- =============================================================================
-- Enrich existing job_orders prose + seed job_requirements (ai_parsed)
-- Idempotent: safe to re-run. Does NOT invent new jobs.
-- Localised for Tanzania / East Africa (NBAA, TNMC, NSSF/NHIF, bilingual, etc.)
-- Generated: 2026-07-21
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Financial Analyst — Bahari Financial Group
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Bahari Financial Group is a growing pan-African financial services company serving businesses and individuals across East Africa.\n\nAs Financial Analyst, you will turn financial data into clear insight that guides planning and day-to-day decisions. You will build the models and reporting the finance team relies on, and work closely with managers across departments.\n\nThis is a hybrid role based in Dar es Salaam. Day-to-day work is in English, with Swahili used with colleagues and clients.',
  responsibilities = E'• Build and maintain financial models for forecasting and planning\n• Prepare accurate monthly management reporting and variance analysis\n• Support the annual budgeting process across departments\n• Analyse performance and flag risks and opportunities to leadership\n• Reconcile key accounts and support month-end close\n• Help improve reporting tools, templates, and processes\n• Prepare schedules and working papers for external auditors when needed',
  requirements = E'Must have:\n• 2+ years in financial analysis or a similar finance role\n• Strong Excel and financial-modelling skills\n• Bachelor''s degree in finance, accounting, economics, or related field from a recognised institution\n• Clear written and spoken English and Swahili\n• Working knowledge of IFRS / Tanzanian financial reporting practice\n\nNice to have:\n• CPA(T) with the National Board of Accountants and Auditors (NBAA) — in progress or qualified\n• Experience in banking, microfinance, or a multi-country business\n• Familiarity with an accounting or ERP system (e.g. QuickBooks, Sage, SAP)',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Hybrid working arrangement\n• Transport allowance\n• Support for NBAA / CPA(T) study where agreed'
where id = 'a0000001-0000-0000-0000-000000000001';

delete from public.job_requirements
where job_order_id = 'a0000001-0000-0000-0000-000000000001' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000001-0000-0000-0000-000000000001', 'experience', '2+ years in financial analysis', 'Or a closely related finance role', 'must_have', 2, 0, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'skill', 'Financial modelling in Excel', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'education', 'Degree in finance, accounting or economics', 'From a recognised institution', 'must_have', null, 2, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'language', 'Clear written and spoken English and Swahili', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'skill', 'Working knowledge of IFRS / TZ reporting', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'certification', 'CPA(T) / NBAA — in progress or qualified', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'experience', 'Banking, microfinance or multi-country experience', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000001-0000-0000-0000-000000000001', 'skill', 'Accounting or ERP system familiarity', 'e.g. QuickBooks, Sage, SAP', 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Customer Success Associate — Bahari Financial Group
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Bahari Financial Group provides banking and financial products to small and medium enterprises across Tanzania.\n\nAs Customer Success Associate, you will own day-to-day relationships with SME clients: onboarding them onto products, answering queries, and helping them get value from our services. You are often the first person a client calls when something is unclear.\n\nThis is a full-time, on-site role in Dar es Salaam. You will work in both English and Swahili with clients and colleagues.',
  responsibilities = E'• Onboard new SME clients onto products and explain how to use them\n• Respond to client queries by phone, WhatsApp, and email within agreed SLAs\n• Log issues accurately and follow through until resolved\n• Track client satisfaction and flag at-risk accounts to your supervisor\n• Prepare simple weekly activity reports\n• Support product demos and training sessions for client staff\n• Keep CRM or client records up to date',
  requirements = E'Must have:\n• 1+ year in a customer-facing role (banking, telecoms, insurance, or similar)\n• Fluent spoken and written English and Swahili\n• Form VI / Diploma or equivalent; degree is an advantage\n• Comfortable with MS Office (Word, Excel, Outlook) and smartphone messaging tools\n• Willingness to work on-site in Dar es Salaam\n\nNice to have:\n• Experience with SME banking, mobile money, or microfinance clients\n• Familiarity with a CRM system\n• Prior call-centre or branch service experience',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport allowance\n• On-the-job product training'
where id = 'a0000002-0000-0000-0000-000000000002';

delete from public.job_requirements
where job_order_id = 'a0000002-0000-0000-0000-000000000002' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000002-0000-0000-0000-000000000002', 'experience', '1+ year in a customer-facing role', 'Banking, telecoms, insurance, or similar', 'must_have', 1, 0, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'language', 'Fluent spoken and written English and Swahili', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'education', 'Form VI, Diploma, or equivalent', 'Degree is an advantage', 'must_have', null, 2, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'skill', 'MS Office and smartphone messaging tools', 'Word, Excel, Outlook, WhatsApp', 'must_have', null, 3, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'other', 'Available to work on-site in Dar es Salaam', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'experience', 'SME banking, mobile money or microfinance exposure', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'skill', 'CRM system familiarity', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000002-0000-0000-0000-000000000002', 'experience', 'Call-centre or branch service experience', null, 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Logistics Coordinator — Serengeti Logistics
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Serengeti Logistics moves freight across the Dar es Salaam corridor and into upcountry routes for manufacturers, traders, and distributors.\n\nAs Logistics Coordinator, you will plan routes, manage dispatch, and keep warehouse and fleet teams aligned so consignments leave on time and arrive intact. You will own daily coordination between drivers, warehouse staff, and clients.\n\nThis is a full-time, on-site role in Dar es Salaam. Early starts and phone coordination with drivers are part of the job. English and Swahili are both used daily.',
  responsibilities = E'• Plan daily routes and assign drivers and vehicles\n• Coordinate with the warehouse on loading windows and priorities\n• Track consignments and update clients on ETAs and delays\n• Capture delivery proof and raise exception reports when needed\n• Monitor fuel, turnaround time, and on-time delivery KPIs\n• Ensure drivers carry valid licences and required trip documents\n• Support incident reporting for accidents, losses, or delays\n• Keep dispatch boards and digital records accurate',
  requirements = E'Must have:\n• 2+ years in logistics, fleet dispatch, or supply-chain coordination\n• Valid Tanzania driving licence (Class B or higher)\n• Clear spoken and written English and Swahili\n• Strong Excel / spreadsheet skills for route and KPI tracking\n• Diploma or certificate in logistics, transport, business, or related field\n\nNice to have:\n• Familiarity with LATRA commercial transport compliance for drivers/crew\n• Experience on Dar–upcountry or port corridor freight\n• Class C licence or prior heavy-vehicle exposure\n• Experience with a TMS or GPS tracking tool',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport allowance\n• Mobile airtime allowance for dispatch coordination'
where id = 'a0000003-0000-0000-0000-000000000003';

delete from public.job_requirements
where job_order_id = 'a0000003-0000-0000-0000-000000000003' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000003-0000-0000-0000-000000000003', 'experience', '2+ years in logistics or supply-chain coordination', 'Fleet dispatch or warehouse coordination accepted', 'must_have', 2, 0, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'certification', 'Valid Tanzania driving licence Class B or higher', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'language', 'Clear spoken and written English and Swahili', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'skill', 'Excel for route and KPI tracking', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'education', 'Diploma/certificate in logistics, transport or business', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'skill', 'LATRA commercial-transport compliance awareness', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'experience', 'Dar–upcountry or port corridor freight experience', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'certification', 'Class C licence or heavy-vehicle exposure', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000003-0000-0000-0000-000000000003', 'skill', 'TMS or GPS tracking tool familiarity', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Software Developer — Kilimanjaro Tech Labs
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Kilimanjaro Tech Labs is a Dar es Salaam technology company building web products for Tanzanian and East African clients.\n\nAs Software Developer, you will design, build, and ship features across our web stack. You will write tests, review pull requests, and work with product and design to deliver reliable releases.\n\nThis is a hybrid role based in Dar es Salaam. Team communication is mainly in English; Swahili is useful with some local clients.',
  responsibilities = E'• Develop and maintain web features in JavaScript/TypeScript\n• Build UI with React and APIs with Node.js\n• Write automated tests for critical paths\n• Review code and contribute to coding standards\n• Collaborate with product and design on requirements and estimates\n• Fix bugs and improve performance of existing services\n• Participate in sprint planning and release readiness\n• Document technical decisions where they affect the team',
  requirements = E'Must have:\n• 3+ years professional experience with JavaScript/TypeScript\n• Hands-on React and Node.js experience on shipped products\n• Solid Git workflow (branching, PRs, code review)\n• Bachelor''s degree in Computer Science, Software Engineering, IT, or equivalent practical experience\n• Clear written and spoken English\n\nNice to have:\n• Spoken Swahili for client-facing work\n• Experience with PostgreSQL or MySQL\n• Familiarity with REST APIs, Docker, or CI/CD\n• Prior work for Tanzanian or East African product teams',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Hybrid working arrangement\n• Learning budget for courses/conferences (subject to approval)\n• Transport allowance on office days'
where id = 'a0000004-0000-0000-0000-000000000004';

delete from public.job_requirements
where job_order_id = 'a0000004-0000-0000-0000-000000000004' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000004-0000-0000-0000-000000000004', 'experience', '3+ years with JavaScript/TypeScript', 'Professional software development', 'must_have', 3, 0, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'skill', 'React and Node.js on shipped products', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'skill', 'Solid Git workflow (branching, PRs, review)', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'education', 'Degree in CS/SE/IT or equivalent experience', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'language', 'Clear written and spoken English', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'language', 'Spoken Swahili for client-facing work', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'skill', 'PostgreSQL or MySQL experience', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'skill', 'REST APIs, Docker, or CI/CD familiarity', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000004-0000-0000-0000-000000000004', 'experience', 'Tanzanian or East African product-team experience', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- IT Support Technician — Kilimanjaro Tech Labs
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Kilimanjaro Tech Labs supports internal teams and selected clients with reliable day-to-day technology.\n\nAs IT Support Technician, you are the first line of help for hardware, accounts, and connectivity issues. You will close helpdesk tickets, set up devices, and keep basic network and account hygiene in order.\n\nThis is a full-time, on-site role in Dar es Salaam. You will speak with users in English and Swahili.',
  responsibilities = E'• Triage and resolve first-line helpdesk tickets\n• Set up laptops, printers, and user accounts for new joiners\n• Troubleshoot Windows desktop and basic networking issues\n• Reset passwords and manage access under IT policy\n• Escalate complex incidents to senior engineers with clear notes\n• Keep an asset register and track loaned equipment\n• Support meeting-room AV and basic office connectivity\n• Document recurring fixes in a simple knowledge base',
  requirements = E'Must have:\n• 1+ year in IT support, helpdesk, or desktop support\n• Solid Windows administration basics\n• Basic networking (TCP/IP, Wi-Fi, printers)\n• Certificate or Diploma in IT, Computer Science, or related field (NTA Level 4–6 or equivalent)\n• Clear spoken English and Swahili\n\nNice to have:\n• CompTIA A+ or similar vendor certification\n• Experience with Microsoft 365 / Google Workspace admin\n• Prior support work in a Tanzanian SME or shared-services environment',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport allowance\n• Opportunity to grow into systems administration'
where id = 'a0000005-0000-0000-0000-000000000005';

delete from public.job_requirements
where job_order_id = 'a0000005-0000-0000-0000-000000000005' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000005-0000-0000-0000-000000000005', 'experience', '1+ year in IT helpdesk or desktop support', null, 'must_have', 1, 0, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'skill', 'Windows administration basics', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'skill', 'Basic networking (TCP/IP, Wi-Fi, printers)', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'education', 'IT certificate or diploma (NTA 4–6 or equivalent)', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'language', 'Clear spoken English and Swahili', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'certification', 'CompTIA A+ or similar', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'skill', 'Microsoft 365 or Google Workspace admin', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000005-0000-0000-0000-000000000005', 'experience', 'Support experience in a Tanzanian SME', null, 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Registered Nurse — Uhuru Health Clinic
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Uhuru Health Clinic is a busy community clinic in Arusha providing outpatient and primary care to local families.\n\nAs Registered Nurse, you will assess and triage patients, administer treatments under clinical protocols, and keep accurate nursing records. You are a core part of a small clinical team that sees high daily walk-in volumes.\n\nThis is a full-time, on-site role in Arusha. Patient communication is mainly in Swahili; clinical notes and referrals also require clear English.',
  responsibilities = E'• Assess and triage walk-in and booked patients\n• Administer medications and treatments per protocol and clinician orders\n• Monitor vital signs and escalate deteriorating patients promptly\n• Maintain accurate nursing notes and patient records\n• Educate patients and caregivers on follow-up care\n• Practise infection prevention and control on the ward/clinic floor\n• Support emergency response within clinic capacity\n• Hand over clearly at shift change',
  requirements = E'Must have:\n• Valid registration with the Tanzania Nursing and Midwifery Council (TNMC)\n• Current TNMC practising licence (renewed)\n• Diploma or Bachelor''s degree in Nursing from a recognised institution\n• 2+ years clinical nursing experience (outpatient, ward, or similar)\n• Fluent spoken Swahili and clear working English\n• Willingness to work clinic shifts on site in Arusha\n\nNice to have:\n• Experience in outpatient / primary-care settings\n• Familiarity with electronic medical records\n• Additional short courses in triage, BLS, or infection prevention',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Uniform / PPE as provided by the clinic\n• Continuing professional development support for TNMC licence renewal'
where id = 'a0000006-0000-0000-0000-000000000006';

delete from public.job_requirements
where job_order_id = 'a0000006-0000-0000-0000-000000000006' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000006-0000-0000-0000-000000000006', 'certification', 'TNMC registration as Registered Nurse', 'Tanzania Nursing and Midwifery Council', 'must_have', null, 0, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'certification', 'Current TNMC practising licence', 'Must be valid / renewed', 'must_have', null, 1, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'education', 'Diploma or Bachelor''s in Nursing', 'From a recognised institution', 'must_have', null, 2, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'experience', '2+ years clinical nursing experience', 'Outpatient, ward, or similar', 'must_have', 2, 3, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'language', 'Fluent Swahili and clear working English', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'other', 'Available for on-site clinic shifts in Arusha', null, 'must_have', null, 5, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'experience', 'Outpatient / primary-care experience', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'skill', 'Electronic medical records familiarity', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000006-0000-0000-0000-000000000006', 'certification', 'Triage, BLS, or IPC short course', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Clinic Receptionist — Uhuru Health Clinic
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Uhuru Health Clinic serves walk-in and booked patients in Arusha and needs a calm, organised front desk.\n\nAs Clinic Receptionist, you are the first point of contact: greeting patients, booking appointments, managing records, and directing calls to the right clinician.\n\nThis is a full-time, on-site role in Arusha. You will work primarily in Swahili with patients and in English for records and referrals.',
  responsibilities = E'• Greet patients and visitors courteously and manage the waiting queue\n• Book, confirm, and reschedule appointments\n• Register patients and keep demographic records accurate\n• Answer and direct phone calls and WhatsApp messages\n• Handle basic billing enquiries and receipts as directed\n• Maintain confidentiality of patient information\n• Provide light administrative support to clinical staff\n• Keep the reception area orderly and stocked with forms',
  requirements = E'Must have:\n• Excellent spoken Swahili and clear English\n• Certificate or Diploma in Front Office, Office Administration, Health Records, or related field\n• Proficiency in MS Office (Word, Excel) and basic computer use\n• 1+ year reception or front-office experience (any sector)\n• Comfortable working on site during clinic opening hours\n\nNice to have:\n• Prior experience in a health facility or hospital front desk\n• Familiarity with an electronic medical record or appointment system\n• Basic knowledge of medical terminology',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport allowance\n• On-the-job training on clinic systems'
where id = 'a0000007-0000-0000-0000-000000000007';

delete from public.job_requirements
where job_order_id = 'a0000007-0000-0000-0000-000000000007' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000007-0000-0000-0000-000000000007', 'language', 'Excellent spoken Swahili and clear English', null, 'must_have', null, 0, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'education', 'Certificate/Diploma in front office or admin', 'Health records or related field accepted', 'must_have', null, 1, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'skill', 'MS Office (Word, Excel) and basic computer use', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'experience', '1+ year reception or front-office experience', null, 'must_have', 1, 3, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'other', 'Available on site during clinic opening hours', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'experience', 'Health facility or hospital front-desk experience', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'skill', 'EMR or appointment-system familiarity', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000007-0000-0000-0000-000000000007', 'skill', 'Basic medical terminology', null, 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Hotel Front Desk Agent — Zanzibar Coastal Resorts
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Zanzibar Coastal Resorts operates beachfront hospitality properties serving local and international guests.\n\nAs Hotel Front Desk Agent, you will deliver a warm arrival and departure experience: checking guests in and out, handling reservations, and resolving day-to-day requests with courtesy and accuracy.\n\nThis is a full-time, on-site role in Zanzibar with rotating shifts, including weekends and public holidays. Guests are served in English; Swahili is essential with local partners and colleagues.',
  responsibilities = E'• Check guests in and out accurately and promptly\n• Manage reservations, amendments, and room assignments\n• Answer guest queries and resolve routine requests\n• Handle cash, mobile-money, and card payments per hotel policy\n• Liaise with housekeeping and maintenance on room status\n• Upsell rooms or services when appropriate\n• Keep the lobby and front desk presentable\n• Log incidents and hand over clearly at shift change',
  requirements = E'Must have:\n• Fluent spoken English and conversational Swahili\n• Prior customer-service experience (hotel, restaurant, retail, or similar)\n• Form IV / Certificate; Diploma in Hospitality or Front Office preferred\n• Comfortable with shift work including nights, weekends, and holidays\n• Basic computer skills for a property-management or booking system\n\nNice to have:\n• 1+ year hotel or lodge front-desk experience\n• Experience with a PMS (e.g. Opera, Protel, or similar)\n• Additional language useful for international guests',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Staff meals on duty\n• Uniform provided\n• Tips shared per property policy'
where id = 'a0000008-0000-0000-0000-000000000008';

delete from public.job_requirements
where job_order_id = 'a0000008-0000-0000-0000-000000000008' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000008-0000-0000-0000-000000000008', 'language', 'Fluent spoken English and conversational Swahili', null, 'must_have', null, 0, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'experience', 'Prior customer-service experience', 'Hotel, restaurant, retail, or similar', 'must_have', null, 1, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'education', 'Form IV / Certificate; hospitality diploma preferred', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'other', 'Available for rotating shifts incl. weekends/holidays', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'skill', 'Basic computer skills for PMS / booking tools', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'experience', '1+ year hotel or lodge front-desk experience', null, 'nice_to_have', 1, 5, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'skill', 'Property-management system (PMS) experience', 'e.g. Opera, Protel, or similar', 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000008-0000-0000-0000-000000000008', 'language', 'Additional guest language beyond English/Swahili', null, 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Executive Chef — Zanzibar Coastal Resorts
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Zanzibar Coastal Resorts runs beachfront properties where food quality is central to the guest experience.\n\nAs Executive Chef, you will lead the culinary operation: designing menus, managing kitchen staff, controlling food cost, and upholding hygiene and safety standards across the kitchen.\n\nThis is a senior, full-time, on-site role in Zanzibar with early mornings, evenings, and weekend service. You will brief teams in English and Swahili.',
  responsibilities = E'• Design and cost menus suited to resort guests and seasonality\n• Lead and roster kitchen staff across service periods\n• Enforce food hygiene, HACCP principles, and kitchen safety\n• Control food cost, waste, and supplier quality\n• Ensure all food handlers hold valid medical/health certificates\n• Train sous chefs and cooks on standards and recipes\n• Coordinate with F&B and stores on forecasts and stock\n• Maintain kitchen equipment and escalate maintenance needs',
  requirements = E'Must have:\n• 5+ years senior kitchen experience, including supervisory responsibility\n• Diploma or equivalent in Culinary Arts / Professional Cookery from a recognised institution\n• Demonstrable food-safety and hygiene practice (HACCP or equivalent training)\n• Valid food-handler medical/health certificate (or ability to obtain before start)\n• Clear spoken English and Swahili for leading a mixed kitchen team\n• Experience controlling food cost in a hotel, resort, or high-volume kitchen\n\nNice to have:\n• Prior executive or head-chef role in a beach resort or 3–5 star hotel\n• Experience with Tanzanian coastal / Swahili and international cuisine mix\n• Formal OSHA or workplace safety training for kitchens',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Staff accommodation or housing support (as agreed)\n• Staff meals on duty\n• Performance-linked bonus subject to food-cost targets'
where id = 'a0000009-0000-0000-0000-000000000009';

delete from public.job_requirements
where job_order_id = 'a0000009-0000-0000-0000-000000000009' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000009-0000-0000-0000-000000000009', 'experience', '5+ years senior kitchen experience', 'Must include supervisory responsibility', 'must_have', 5, 0, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'education', 'Diploma in Culinary Arts / Professional Cookery', 'From a recognised institution', 'must_have', null, 1, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'certification', 'Food-safety / HACCP training', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'certification', 'Valid food-handler medical/health certificate', 'Required under TZ food hygiene practice', 'must_have', null, 3, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'language', 'Clear spoken English and Swahili', 'To lead a mixed kitchen team', 'must_have', null, 4, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'skill', 'Food-cost control in hotel/resort kitchen', null, 'must_have', null, 5, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'experience', 'Executive/head-chef in resort or 3–5 star hotel', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'skill', 'Tanzanian coastal and international cuisine mix', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000009-0000-0000-0000-000000000009', 'certification', 'OSHA or kitchen workplace-safety training', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Production Supervisor — Tembo Manufacturing Ltd
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Tembo Manufacturing Ltd operates a production plant in Mwanza supplying goods for the domestic market.\n\nAs Production Supervisor, you will run a manufacturing line and its shift team: planning shifts, monitoring output and quality, and enforcing safety on the floor.\n\nThis is a full-time, on-site role in Mwanza with early starts and rotating shifts. Briefings are in Swahili and English.',
  responsibilities = E'• Plan daily shifts against production targets\n• Supervise operators and resolve line stoppages quickly\n• Monitor output, yield, and scrap; report variances\n• Enforce PPE use and OSHA workplace safety standards on the floor\n• Work with QA on quality checks and corrective actions\n• Coordinate raw-material readiness with stores\n• Raise maintenance requests and follow through on downtime\n• Complete shift handover notes and daily production reports',
  requirements = E'Must have:\n• 2+ years supervising production or a manufacturing line\n• Diploma or Degree in industrial, manufacturing, production, mechanical, or related technical field\n• Practical quality-control experience on a production floor\n• Clear spoken Swahili and working English\n• Demonstrable commitment to workplace safety and PPE compliance\n• Willingness to work rotating shifts on site in Mwanza\n\nNice to have:\n• Formal OSHA / OSH representative training\n• Experience with basic production reporting tools (Excel or MES)\n• Prior work in a Tanzanian manufacturing plant of similar scale',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport / shift allowance\n• PPE provided\n• Overtime paid per company policy and ELRA'
where id = 'a0000010-0000-0000-0000-000000000010';

delete from public.job_requirements
where job_order_id = 'a0000010-0000-0000-0000-000000000010' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000010-0000-0000-0000-000000000010', 'experience', '2+ years supervising production', 'Manufacturing line supervision', 'must_have', 2, 0, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'education', 'Diploma/degree in industrial or production field', 'Mechanical or related technical field accepted', 'must_have', null, 1, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'skill', 'Practical quality-control on a production floor', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'language', 'Clear spoken Swahili and working English', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'skill', 'Workplace safety and PPE compliance', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'other', 'Available for rotating shifts on site in Mwanza', null, 'must_have', null, 5, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'certification', 'OSHA / OSH representative training', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'skill', 'Excel or MES production reporting', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000010-0000-0000-0000-000000000010', 'experience', 'Tanzanian manufacturing plant experience', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Warehouse Assistant — Tembo Manufacturing Ltd
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Tembo Manufacturing Ltd runs a plant warehouse in Mwanza that receives raw materials and dispatches finished goods.\n\nAs Warehouse Assistant, you will support receiving, storage, picking, packing, and inventory updates so the production line and outbound trucks stay supplied.\n\nThis is a full-time, on-site, physically active role in Mwanza. Instructions are given in Swahili and English.',
  responsibilities = E'• Receive and check incoming stock against delivery notes\n• Store materials in correct bins/locations\n• Pick and pack orders for production or dispatch\n• Update inventory counts and report discrepancies\n• Keep the warehouse clean, organised, and secure\n• Use PPE correctly and follow site safety rules\n• Assist loading and offloading under supervisor guidance\n• Support periodic stock takes',
  requirements = E'Must have:\n• Form IV certificate (CSE) or equivalent\n• Ability to follow written and spoken instructions in Swahili; basic English helpful\n• Physically able to lift and move stock safely with PPE\n• Reliable attendance for early warehouse shifts\n• Basic numeracy for counting and recording stock\n\nNice to have:\n• Prior warehouse, godown, or stores experience\n• Valid forklift operator certificate (e.g. NIT or equivalent training)\n• Basic Excel / stock-sheet experience',
  benefits = E'• NSSF and NHIF contributions as required by law\n• PPE provided\n• Transport / shift allowance\n• Overtime paid per company policy'
where id = 'a0000011-0000-0000-0000-000000000011';

delete from public.job_requirements
where job_order_id = 'a0000011-0000-0000-0000-000000000011' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000011-0000-0000-0000-000000000011', 'education', 'Form IV certificate (CSE) or equivalent', null, 'must_have', null, 0, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'language', 'Follow instructions in Swahili; basic English helpful', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'other', 'Physically able to lift/move stock with PPE', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'other', 'Reliable attendance for early warehouse shifts', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'skill', 'Basic numeracy for counting and recording stock', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'experience', 'Prior warehouse, godown, or stores experience', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'certification', 'Forklift operator certificate (NIT or equivalent)', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000011-0000-0000-0000-000000000011', 'skill', 'Basic Excel / stock-sheet experience', null, 'nice_to_have', null, 7, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Accountant — Bahari Financial Group
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Bahari Financial Group is a pan-African financial services company with a growing Tanzania operation.\n\nAs Accountant, you will own monthly reporting and the close for the local entity: preparing statements, managing the close calendar, and supporting internal and external audits.\n\nThis is a hybrid mid-level role based in Dar es Salaam. Working language for finance packs is English; Swahili is used with local stakeholders.',
  responsibilities = E'• Own the month-end close calendar and deliverables\n• Prepare financial statements and supporting schedules\n• Reconcile bank, suspense, and control accounts\n• Post journals and maintain the general ledger\n• Support internal and external audit requests with working papers\n• Assist with VAT, PAYE, and other TRA filing packs as directed\n• Improve close checklists and Excel/ERP templates\n• Partner with business units on cost and variance queries',
  requirements = E'Must have:\n• 3+ years in accounting or financial reporting\n• Bachelor''s degree in Accounting, Finance, or related field (or NBAA ATEC / NTA Level 6 Accounting Diploma pathway)\n• Strong Excel skills (reconciliations, pivot tables, schedules)\n• Working knowledge of IFRS and Tanzanian tax/reporting basics\n• Clear written and spoken English; conversational Swahili\n\nNice to have:\n• CPA(T) candidate or NBAA-registered member\n• Hands-on experience with QuickBooks, Sage, or similar ERP\n• Prior work in banking, insurance, or regulated financial services\n• Experience preparing TRA (VAT/PAYE) supporting schedules',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Hybrid working arrangement\n• Transport allowance\n• Support for NBAA / CPA(T) progression where agreed'
where id = 'a0000012-0000-0000-0000-000000000012';

delete from public.job_requirements
where job_order_id = 'a0000012-0000-0000-0000-000000000012' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000012-0000-0000-0000-000000000012', 'experience', '3+ years in accounting or financial reporting', null, 'must_have', 3, 0, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'education', 'Degree in Accounting/Finance or ATEC/NTA-6 pathway', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'skill', 'Strong Excel (reconciliations, pivots, schedules)', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'skill', 'IFRS and Tanzanian tax/reporting basics', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'language', 'Clear English; conversational Swahili', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'certification', 'CPA(T) candidate or NBAA member', null, 'nice_to_have', null, 5, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'skill', 'QuickBooks, Sage, or similar ERP', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'experience', 'Banking, insurance, or regulated FS experience', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000012-0000-0000-0000-000000000012', 'skill', 'TRA VAT/PAYE supporting schedules', null, 'nice_to_have', null, 8, 'ai_parsed', null);

-- ---------------------------------------------------------------------------
-- Fleet Dispatch Officer — Serengeti Logistics
-- ---------------------------------------------------------------------------
update public.job_orders set
  description = E'Serengeti Logistics coordinates drivers and vehicles across the Dar es Salaam corridor for time-sensitive freight.\n\nAs Fleet Dispatch Officer, you will plan routes, assign drivers, track deliveries, and report dispatch KPIs so the fleet stays productive and compliant.\n\nThis is a full-time, on-site operations role in Dar es Salaam. You will spend much of the day on radio/phone with drivers in Swahili, with written reports in English.',
  responsibilities = E'• Build daily dispatch plans and assign drivers to trips\n• Confirm vehicles are roadworthy and documents are in order before departure\n• Track live deliveries and re-route when delays or breakdowns occur\n• Capture POD (proof of delivery) and close trips in the system\n• Report on-time performance, utilisation, and incident KPIs\n• Coordinate with clients on ETAs and exceptions\n• Escalate accidents, cargo damage, or compliance issues immediately\n• Maintain an accurate driver and vehicle availability board',
  requirements = E'Must have:\n• 2+ years in logistics dispatch, fleet coordination, or transport operations\n• Strong coordination skills under time pressure; clear radio/phone manner\n• Fluent spoken Swahili and clear written English\n• Valid Tanzania driving licence (Class B or higher)\n• Diploma or certificate in logistics, transport, or business administration\n• Comfortable with Excel and smartphone/GPS tracking apps\n\nNice to have:\n• Knowledge of LATRA certification requirements for commercial drivers\n• Experience dispatching heavy goods vehicles on the DSM corridor\n• Class C licence\n• Prior use of a fleet-management or TMS platform',
  benefits = E'• NSSF and NHIF contributions as required by law\n• Transport allowance\n• Mobile airtime allowance\n• Shift meals when on extended dispatch coverage'
where id = 'a0000013-0000-0000-0000-000000000013';

delete from public.job_requirements
where job_order_id = 'a0000013-0000-0000-0000-000000000013' and source = 'ai_parsed';

insert into public.job_requirements
  (job_order_id, category, label, detail, importance, min_years, ordinal, source, created_by)
values
  ('a0000013-0000-0000-0000-000000000013', 'experience', '2+ years in logistics dispatch or fleet coordination', null, 'must_have', 2, 0, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'skill', 'Strong live dispatch coordination under time pressure', null, 'must_have', null, 1, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'language', 'Fluent spoken Swahili and clear written English', null, 'must_have', null, 2, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'certification', 'Valid Tanzania driving licence Class B or higher', null, 'must_have', null, 3, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'education', 'Diploma/certificate in logistics, transport or business', null, 'must_have', null, 4, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'skill', 'Excel and smartphone/GPS tracking apps', null, 'must_have', null, 5, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'skill', 'LATRA commercial-driver certification awareness', null, 'nice_to_have', null, 6, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'experience', 'HGV dispatch on the DSM corridor', null, 'nice_to_have', null, 7, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'certification', 'Class C driving licence', null, 'nice_to_have', null, 8, 'ai_parsed', null),
  ('a0000013-0000-0000-0000-000000000013', 'skill', 'Fleet-management or TMS platform experience', null, 'nice_to_have', null, 9, 'ai_parsed', null);
