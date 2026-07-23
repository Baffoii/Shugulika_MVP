import { createClient } from "@/lib/supabase/server";
import type { DiscoverableCandidateRow, JobOrderRow } from "@/lib/database.types";

export interface TalentSearchFilters {
  q?: string;
  skill?: string;
  country?: string;
  city?: string;
  availability?: string;
  experience_level?: string;
}

/** Search the Ring-2 talent pool (candidate-approved fields only). */
export async function searchTalentPool(
  filters: TalentSearchFilters,
): Promise<{ candidates: DiscoverableCandidateRow[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_talent_pool", {
    p_q: filters.q?.trim() || null,
    p_skill: filters.skill?.trim() || null,
    p_country: filters.country?.trim() || null,
    p_city: filters.city?.trim() || null,
    p_availability: filters.availability?.trim() || null,
    p_experience_level: filters.experience_level?.trim() || null,
    p_limit: 50,
  });

  if (error) {
    console.error("[searchTalentPool]", error.message);
    return { candidates: [], error: error.message };
  }
  return { candidates: (data as DiscoverableCandidateRow[] | null) ?? [], error: null };
}

/**
 * Open a discovered candidate profile. Writes an access audit event and returns
 * only approved search fields — never franchise-private processing records.
 */
export async function openDiscoveredCandidate(
  candidateId: string,
): Promise<{ candidate: DiscoverableCandidateRow | null; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_discovered_candidate", {
    p_candidate: candidateId,
  });

  if (error) {
    console.error("[openDiscoveredCandidate]", error.message);
    return { candidate: null, error: error.message };
  }
  const rows = (data as DiscoverableCandidateRow[] | null) ?? [];
  return { candidate: rows[0] ?? null, error: null };
}

/** Active / approved job orders the recruiter can source a candidate onto. */
export async function listSourceableJobs(): Promise<
  Pick<JobOrderRow, "id" | "title" | "city" | "country_code" | "status" | "responsible_org_id">[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_orders")
    .select("id,title,city,country_code,status,responsible_org_id")
    .in("status", ["active", "approved", "on_hold"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listSourceableJobs]", error.message);
    return [];
  }
  return (
    (data as Pick<
      JobOrderRow,
      "id" | "title" | "city" | "country_code" | "status" | "responsible_org_id"
    >[]) ?? []
  );
}

/** Applications the caller's org already has for this candidate (RLS-scoped). */
export async function listOwnOrgApplicationsForCandidate(candidateId: string): Promise<
  {
    id: string;
    job_order_id: string;
    current_stage: string;
    withdrawn_at: string | null;
    entry_source: string;
    sourced_contact_status: string | null;
    job_title: string | null;
  }[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id,job_order_id,current_stage,withdrawn_at,entry_source,sourced_contact_status")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listOwnOrgApplicationsForCandidate]", error.message);
    return [];
  }

  const apps =
    (data as {
      id: string;
      job_order_id: string;
      current_stage: string;
      withdrawn_at: string | null;
      entry_source: string;
      sourced_contact_status: string | null;
    }[]) ?? [];
  if (apps.length === 0) return [];

  const jobIds = [...new Set(apps.map((a) => a.job_order_id))];
  const { data: jobs } = await supabase.from("job_orders").select("id,title").in("id", jobIds);
  const titleById = new Map(
    ((jobs as { id: string; title: string }[] | null) ?? []).map((j) => [j.id, j.title]),
  );

  return apps.map((a) => ({
    ...a,
    job_title: titleById.get(a.job_order_id) ?? null,
  }));
}
