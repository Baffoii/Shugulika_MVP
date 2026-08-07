import "server-only";

/**
 * The full rehearsal migration: Zoho Recruit → Supabase, read-only on the Zoho
 * side, idempotent on the Supabase side.
 *
 *   Clients      → organizations (employer)
 *   Job_Openings → job_orders
 *   associations → applications + application_stage_history   (immutable)
 *   Attachments  → Storage + candidate_documents
 *   Candidates   → candidate_profiles + auth users (via the existing
 *                  canonical upsert, so dedupe and account provisioning are
 *                  not reimplemented here)
 *
 * Idempotency comes from zoho_recruit_external_mappings: every created row is
 * recorded against its Zoho id with sync_direction 'inbound', so a re-run links
 * instead of duplicating. That matters because migrated applications are
 * immutable — a duplicate could not be cleaned up through the app.
 *
 * Safety, checked at runtime rather than assumed:
 *   - the rehearsal guard (explicit ack, non-production, non-production project)
 *   - outbound sync gates must be OFF, so nothing can be pushed back to Zoho
 */
import { COUNTRIES } from "@/lib/constants";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { assertTestMigrationAllowed } from "@/lib/integrations/zoho-recruit/import/test-source";
import { mapZohoCandidate } from "@/lib/integrations/zoho-recruit/import/mapping";
import { upsertCanonicalCandidate } from "@/lib/integrations/zoho-recruit/import/canonical-upsert";
import {
  listClients,
  listJobOpenings,
  listJobCandidates,
  listCandidateAttachments,
  downloadCandidateAttachment,
  readZohoId,
  type ZohoRecord,
} from "@/lib/integrations/zoho-recruit/import/full-migration/reader";
import {
  mapZohoClientToOrganization,
  mapZohoJobOpeningToJobOrder,
  mapAssociationToApplication,
  looksLikeCv,
  mimeForFile,
  migratedCvObjectPath,
} from "@/lib/integrations/zoho-recruit/import/full-migration/mappers";

const CV_BUCKET = "candidate-documents";
/** Refuse anything larger; a rehearsal should not haul 100MB blobs. */
const MAX_CV_BYTES = 15 * 1024 * 1024;

export interface RehearsalOptions {
  /** Org that will own imported jobs and applications (a franchise or HQ org). */
  responsibleOrgId: string;
  /** Cap each module for a small first run. */
  limit?: number;
  /** Skip the (slow) attachment download pass. */
  skipCvs?: boolean;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  onProgress?: (message: string) => void;
}

export interface RehearsalReport {
  dryRun: boolean;
  organizations: { seen: number; created: number; linked: number; skipped: number };
  jobOrders: { seen: number; created: number; linked: number; skipped: number };
  candidates: { seen: number; created: number; linked: number; failed: number };
  applications: { seen: number; created: number; linked: number; skipped: number };
  cvs: { seen: number; stored: number; skipped: number; failed: number };
  /** Mapping issues, counted by reason, so the report is readable at scale. */
  problems: Record<string, number>;
  /** Stage distribution of imported applications. */
  stages: Record<string, number>;
  errors: string[];
}

function emptyReport(dryRun: boolean): RehearsalReport {
  return {
    dryRun,
    organizations: { seen: 0, created: 0, linked: 0, skipped: 0 },
    jobOrders: { seen: 0, created: 0, linked: 0, skipped: 0 },
    candidates: { seen: 0, created: 0, linked: 0, failed: 0 },
    applications: { seen: 0, created: 0, linked: 0, skipped: 0 },
    cvs: { seen: 0, stored: 0, skipped: 0, failed: 0 },
    problems: {},
    stages: {},
    errors: [],
  };
}

const bump = (counter: Record<string, number>, key: string) => {
  counter[key] = (counter[key] ?? 0) + 1;
};

type Client = NonNullable<ReturnType<typeof createServiceRoleClient>>;

// ---------------------------------------------------------------------------
// External-mapping helpers (idempotency)
// ---------------------------------------------------------------------------

/**
 * Every existing inbound mapping for this connection, keyed
 * `entityType|zohoModule|zohoRecordId`.
 *
 * Loaded once instead of one query per record. A per-record lookup made the
 * import network-bound on Supabase round-trips rather than on Zoho: with a few
 * thousand clients and jobs that is thousands of sequential queries, and it
 * dominated the run.
 */
type MappingIndex = Map<string, string>;

const mappingKey = (entityType: string, zohoModule: string, zohoRecordId: string) =>
  `${entityType}|${zohoModule}|${zohoRecordId}`;

async function loadMappingIndex(client: Client, connectionId: string): Promise<MappingIndex> {
  const index: MappingIndex = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("zoho_recruit_external_mappings")
      .select("local_entity_type,zoho_module,zoho_record_id,local_entity_id")
      .eq("connection_id", connectionId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load existing mappings: ${error.message}`);
    const rows =
      (data as Array<{
        local_entity_type: string;
        zoho_module: string;
        zoho_record_id: string;
        local_entity_id: string;
      }> | null) ?? [];
    for (const row of rows) {
      index.set(
        mappingKey(row.local_entity_type, row.zoho_module, row.zoho_record_id),
        row.local_entity_id,
      );
    }
    if (rows.length < PAGE) break;
  }
  return index;
}

async function recordMapping(
  client: Client,
  connectionId: string,
  entityType: string,
  localId: string,
  zohoModule: string,
  zohoRecordId: string,
  index?: MappingIndex,
): Promise<void> {
  const { error } = await client.from("zoho_recruit_external_mappings").insert({
    connection_id: connectionId,
    local_entity_type: entityType,
    local_entity_id: localId,
    zoho_module: zohoModule,
    zoho_record_id: zohoRecordId,
    sync_direction: "inbound",
    last_synced_at: new Date().toISOString(),
    metadata: { source: "zoho_rehearsal_migration" },
  });
  // A duplicate here means a concurrent run already claimed it; not fatal.
  if (error && !/duplicate|unique/i.test(error.message)) {
    throw new Error(`Could not record mapping for ${entityType} ${localId}: ${error.message}`);
  }
  index?.set(mappingKey(entityType, zohoModule, zohoRecordId), localId);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runFullRehearsal(options: RehearsalOptions): Promise<RehearsalReport> {
  assertTestMigrationAllowed();

  const report = emptyReport(options.dryRun === true);
  const log = options.onProgress ?? (() => {});

  // Outbound must be off. This is the difference between a read-only rehearsal
  // and one that can push fabricated records into the live Zoho workspace.
  const gates = await getZohoRecruitGateStatus();
  if (gates.syncAllowed) {
    throw new Error(
      "Refusing to run: Zoho outbound sync is enabled. Disable zoho_recruit_data_sync_enabled " +
        "and zoho_recruit_production_data_enabled before rehearsing a migration.",
    );
  }

  const client = createServiceRoleClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("id,status")
    .eq("connection_key", "primary")
    .maybeSingle();
  const conn = connection as { id: string; status: string } | null;
  if (!conn || conn.status !== "connected") {
    throw new Error("Zoho Recruit is not connected.");
  }
  const connectionId = conn.id;

  const { data: responsibleOrg } = await client
    .from("organizations")
    .select("id")
    .eq("id", options.responsibleOrgId)
    .maybeSingle();
  if (!responsibleOrg) {
    throw new Error(`responsibleOrgId ${options.responsibleOrgId} does not exist.`);
  }

  // Two one-shot prefetches. Doing these per record turned the import into
  // thousands of sequential Supabase round-trips, which dominated the run time
  // — the Zoho reads were never the bottleneck.
  log("Loading existing mappings…");
  const mappings = await loadMappingIndex(client, connectionId);

  const existingEmployerOrgs = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("organizations")
      .select("id,name")
      .eq("org_type", "employer")
      .range(from, from + 999);
    if (error) throw new Error(`Could not load existing employers: ${error.message}`);
    const rows = (data as Array<{ id: string; name: string }> | null) ?? [];
    for (const row of rows) existingEmployerOrgs.set(row.name.trim().toLowerCase(), row.id);
    if (rows.length < 1000) break;
  }
  log(`Existing: ${mappings.size} mappings, ${existingEmployerOrgs.size} employer orgs.`);

  const countries = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));
  const fallbackCountry = countries[0]?.code ?? "TZ";
  const mapperOpts = { countries, fallbackCountry };

  // ---- 1. Clients → organizations -----------------------------------------
  log("Reading Zoho Clients…");
  const clients = await listClients({ limit: options.limit });
  /** Zoho client name (lowercased) → local organization id (fallback link). */
  const orgByName = new Map<string, string>();
  /** Zoho Clients record id → local organization id (exact link, preferred). */
  const orgByZohoId = new Map<string, string>();

  for (const record of clients) {
    report.organizations.seen += 1;
    const zohoId = readZohoId(record);
    if (!zohoId) {
      report.organizations.skipped += 1;
      bump(report.problems, "client_id_missing");
      continue;
    }

    const { draft, problems } = mapZohoClientToOrganization(record, mapperOpts);
    for (const p of problems) bump(report.problems, p);
    if (!draft) {
      report.organizations.skipped += 1;
      continue;
    }

    const existing = mappings.get(mappingKey("organization", "Clients", zohoId)) ?? null;
    if (existing) {
      report.organizations.linked += 1;
      orgByName.set(draft.name.toLowerCase(), existing);
      orgByZohoId.set(zohoId, existing);
      continue;
    }

    // Reuse an employer org that already exists under the same name rather than
    // creating a near-duplicate next to the orgs already in this project.
    // Served from the prefetched map — this was a per-record query.
    const byName = existingEmployerOrgs.has(draft.name.trim().toLowerCase())
      ? { id: existingEmployerOrgs.get(draft.name.trim().toLowerCase())! }
      : null;

    if (options.dryRun) {
      const existingId = byName?.id ?? null;
      report.organizations.created += existingId ? 0 : 1;
      report.organizations.linked += existingId ? 1 : 0;
      // Register a placeholder for orgs we would have created, so the job pass
      // can still resolve its employer. Without this every job reports as
      // unresolvable and the dry-run report — the point of a dry run — lies.
      const idForLinking = existingId ?? `dry-run:${zohoId}`;
      orgByName.set(draft.name.toLowerCase(), idForLinking);
      orgByZohoId.set(zohoId, idForLinking);
      continue;
    }

    let orgId = (byName as { id: string } | null)?.id ?? null;
    if (orgId) {
      report.organizations.linked += 1;
    } else {
      const { data: created, error } = await client
        .from("organizations")
        .insert(draft)
        .select("id")
        .single();
      if (error || !created) {
        report.organizations.skipped += 1;
        report.errors.push(`organization "${draft.name}": ${error?.message ?? "insert failed"}`);
        continue;
      }
      orgId = (created as { id: string }).id;
      report.organizations.created += 1;
    }
    await recordMapping(client, connectionId, "organization", orgId, "Clients", zohoId, mappings);
    orgByName.set(draft.name.toLowerCase(), orgId);
    orgByZohoId.set(zohoId, orgId);
  }
  log(
    `Clients: ${report.organizations.created} created, ${report.organizations.linked} linked, ${report.organizations.skipped} skipped.`,
  );

  // ---- 2. Job_Openings → job_orders ---------------------------------------
  log("Reading Zoho Job Openings…");
  const jobs = await listJobOpenings({ limit: options.limit });
  /** Local job_order id per Zoho job id, for the application pass. */
  const jobOrderByZohoId = new Map<string, string>();

  for (const record of jobs) {
    report.jobOrders.seen += 1;
    const zohoId = readZohoId(record);
    if (!zohoId) {
      report.jobOrders.skipped += 1;
      bump(report.problems, "job_id_missing");
      continue;
    }

    const { draft, problems } = mapZohoJobOpeningToJobOrder(record, mapperOpts);
    for (const p of problems) bump(report.problems, p);
    if (!draft) {
      report.jobOrders.skipped += 1;
      continue;
    }

    const existing = mappings.get(mappingKey("job_order", "Job_Openings", zohoId)) ?? null;
    if (existing) {
      report.jobOrders.linked += 1;
      jobOrderByZohoId.set(zohoId, existing);
      continue;
    }

    // job_orders.employer_org_id is NOT NULL, so a job whose client we could
    // not resolve is skipped rather than attached to an arbitrary employer.
    // Prefer the Zoho client id (exact) and fall back to the name only when the
    // lookup object carried no id.
    const employerOrgId =
      (draft.clientZohoId ? orgByZohoId.get(draft.clientZohoId) : null) ??
      (draft.clientName ? orgByName.get(draft.clientName.toLowerCase()) : null) ??
      null;
    if (!employerOrgId) {
      report.jobOrders.skipped += 1;
      bump(report.problems, draft.clientName ? "job_client_unresolved" : "job_client_missing");
      continue;
    }

    if (options.dryRun) {
      report.jobOrders.created += 1;
      // Register a placeholder so the association pass still runs and reports
      // the stage distribution — the most useful number a dry run produces.
      jobOrderByZohoId.set(zohoId, `dry-run:${zohoId}`);
      continue;
    }

    const { clientName: _clientName, clientZohoId: _clientZohoId, ...jobRow } = draft;
    const { data: created, error } = await client
      .from("job_orders")
      .insert({
        ...jobRow,
        employer_org_id: employerOrgId,
        responsible_org_id: options.responsibleOrgId,
        recruitment_path: "B",
      })
      .select("id")
      .single();
    if (error || !created) {
      report.jobOrders.skipped += 1;
      report.errors.push(`job "${draft.title}": ${error?.message ?? "insert failed"}`);
      continue;
    }
    const jobOrderId = (created as { id: string }).id;
    report.jobOrders.created += 1;
    await recordMapping(
      client,
      connectionId,
      "job_order",
      jobOrderId,
      "Job_Openings",
      zohoId,
      mappings,
    );
    jobOrderByZohoId.set(zohoId, jobOrderId);
  }
  log(
    `Job openings: ${report.jobOrders.created} created, ${report.jobOrders.linked} linked, ${report.jobOrders.skipped} skipped.`,
  );

  // ---- 3. Associations → candidates + applications -------------------------
  /** Zoho candidate id → local candidate_profiles id. */
  const candidateByZohoId = new Map<string, string>();

  for (const [zohoJobId, jobOrderId] of jobOrderByZohoId) {
    let associated: ZohoRecord[] = [];
    try {
      associated = await listJobCandidates(zohoJobId);
    } catch (error) {
      report.errors.push(
        `associations for job ${zohoJobId}: ${error instanceof Error ? error.message : "failed"}`,
      );
      continue;
    }

    for (const assoc of associated) {
      report.applications.seen += 1;
      const zohoCandidateId = readZohoId(assoc);
      if (!zohoCandidateId) {
        report.applications.skipped += 1;
        bump(report.problems, "association_candidate_id_missing");
        continue;
      }

      // -- candidate --------------------------------------------------------
      let candidateId = candidateByZohoId.get(zohoCandidateId) ?? null;
      if (!candidateId) {
        candidateId = mappings.get(mappingKey("candidate", "Candidates", zohoCandidateId)) ?? null;
      }
      if (!candidateId) {
        report.candidates.seen += 1;
        const mapping = mapZohoCandidate(assoc, { countries, hasConsent: true });
        // Surface the candidate mapper's findings — notably
        // prohibited_field_present, which fires on Ethnicity / Religion /
        // Nationality. Discarding these would hide the single most important
        // privacy signal the rehearsal produces.
        for (const problem of mapping.problems) bump(report.problems, problem);
        if (!mapping.draft.email) {
          // provisionCandidateAccount needs an email to create the auth user.
          report.candidates.failed += 1;
          report.applications.skipped += 1;
          bump(report.problems, "candidate_email_missing");
          continue;
        }
        if (options.dryRun) {
          report.candidates.created += 1;
          report.applications.created += 1;
          bump(
            report.stages,
            mapAssociationToApplication(assoc, { zohoCandidateId }).draft.current_stage,
          );
          continue;
        }
        const upsert = await upsertCanonicalCandidate({
          connectionId,
          zohoRecordId: zohoCandidateId,
          draft: mapping.draft,
          matchedCandidateId: null,
          fingerprint: mapping.fingerprint,
        });
        if (!upsert.ok || !upsert.candidateId) {
          report.candidates.failed += 1;
          report.applications.skipped += 1;
          report.errors.push(
            `candidate ${zohoCandidateId}: ${"error" in upsert ? upsert.error : "upsert failed"}`,
          );
          continue;
        }
        candidateId = upsert.candidateId;
        if (upsert.created) report.candidates.created += 1;
        else report.candidates.linked += 1;
      } else {
        report.candidates.linked += 1;
      }
      candidateByZohoId.set(zohoCandidateId, candidateId);

      // -- application ------------------------------------------------------
      const { draft: appDraft, problems } = mapAssociationToApplication(assoc, {
        zohoCandidateId,
      });
      for (const p of problems) bump(report.problems, p);
      bump(report.stages, appDraft.current_stage);

      if (options.dryRun) {
        report.applications.created += 1;
        continue;
      }

      // applications is unique (candidate_id, job_order_id); a re-run links.
      const { data: existingApp } = await client
        .from("applications")
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("job_order_id", jobOrderId)
        .maybeSingle();
      if (existingApp) {
        report.applications.linked += 1;
        continue;
      }

      const { data: createdApp, error: appError } = await client
        .from("applications")
        .insert({
          candidate_id: candidateId,
          job_order_id: jobOrderId,
          owning_org_id: options.responsibleOrgId,
          recruitment_path: appDraft.recruitment_path,
          entry_source: appDraft.entry_source,
          current_stage: appDraft.current_stage,
          rejected_from_stage: appDraft.rejected_from_stage,
          is_on_hold: appDraft.is_on_hold,
          is_migrated_readonly: true,
        })
        .select("id")
        .single();
      if (appError || !createdApp) {
        report.applications.skipped += 1;
        report.errors.push(
          `application ${zohoCandidateId}→${zohoJobId}: ${appError?.message ?? "insert failed"}`,
        );
        continue;
      }
      const applicationId = (createdApp as { id: string }).id;
      report.applications.created += 1;

      // One history row recording where Zoho left this application. Written
      // with source='zoho_migration' so the immutability trigger covers it.
      const { error: historyError } = await client.from("application_stage_history").insert({
        application_id: applicationId,
        from_stage: null,
        to_stage: appDraft.current_stage,
        source: "zoho_migration",
        note: "Imported from Zoho Recruit (rehearsal migration).",
      });
      if (historyError) {
        report.errors.push(`stage history for ${applicationId}: ${historyError.message}`);
      }

      await recordMapping(
        client,
        connectionId,
        "application",
        applicationId,
        "Job_Openings",
        `${zohoJobId}:${zohoCandidateId}`,
        mappings,
      );
    }
  }
  log(
    `Applications: ${report.applications.created} created, ${report.applications.linked} linked, ${report.applications.skipped} skipped.`,
  );

  // ---- 4. Attachments → Storage + candidate_documents ----------------------
  if (!options.skipCvs) {
    for (const [zohoCandidateId, candidateId] of candidateByZohoId) {
      let attachments: Awaited<ReturnType<typeof listCandidateAttachments>> = [];
      try {
        attachments = await listCandidateAttachments(zohoCandidateId);
      } catch (error) {
        report.cvs.failed += 1;
        report.errors.push(
          `attachments for ${zohoCandidateId}: ${error instanceof Error ? error.message : "failed"}`,
        );
        continue;
      }

      for (const attachment of attachments) {
        report.cvs.seen += 1;
        if (!looksLikeCv(attachment.fileName)) {
          report.cvs.skipped += 1;
          continue;
        }
        if (attachment.size !== null && attachment.size > MAX_CV_BYTES) {
          report.cvs.skipped += 1;
          bump(report.problems, "cv_too_large");
          continue;
        }
        if (options.dryRun) {
          report.cvs.stored += 1;
          continue;
        }

        const already = mappings.get(
          mappingKey("candidate_document", "Attachments", attachment.id),
        );
        if (already) {
          report.cvs.skipped += 1;
          continue;
        }

        let download: Awaited<ReturnType<typeof downloadCandidateAttachment>> = null;
        try {
          download = await downloadCandidateAttachment(zohoCandidateId, attachment.id);
        } catch {
          download = null;
        }
        if (!download || download.bytes.byteLength === 0) {
          report.cvs.failed += 1;
          bump(report.problems, "cv_download_failed");
          continue;
        }

        const objectPath = migratedCvObjectPath(candidateId, attachment.id, attachment.fileName);
        const contentType = mimeForFile(attachment.fileName, download.contentType);
        const { error: uploadError } = await client.storage
          .from(CV_BUCKET)
          .upload(objectPath, download.bytes, { contentType, upsert: true });
        if (uploadError) {
          report.cvs.failed += 1;
          report.errors.push(`cv upload ${attachment.fileName}: ${uploadError.message}`);
          continue;
        }

        const { data: doc, error: docError } = await client
          .from("candidate_documents")
          .insert({
            candidate_id: candidateId,
            doc_type: "cv",
            title: attachment.fileName,
            bucket_id: CV_BUCKET,
            object_path: objectPath,
            mime_type: contentType,
            size_bytes: download.bytes.byteLength,
            is_primary: false,
            status: "active",
          })
          .select("id")
          .single();
        if (docError || !doc) {
          report.cvs.failed += 1;
          report.errors.push(`cv row ${attachment.fileName}: ${docError?.message ?? "failed"}`);
          continue;
        }
        report.cvs.stored += 1;
        await recordMapping(
          client,
          connectionId,
          "candidate_document",
          (doc as { id: string }).id,
          "Attachments",
          attachment.id,
          mappings,
        );
      }
    }
    log(
      `CVs: ${report.cvs.stored} stored, ${report.cvs.skipped} skipped, ${report.cvs.failed} failed.`,
    );
  }

  return report;
}
