import { createClient } from "@/lib/supabase/server";
import type { EmployerZohoPoolCandidateRow, JobOrderRow } from "@/lib/database.types";
import type { TalentSearchFilters } from "@/lib/data/talent-search";

export type EmployerZohoSearchFilters = TalentSearchFilters & {
  industry?: string;
  qualification?: string;
  role?: string;
  page?: number;
  pageSize?: number;
};

/** Path A jobs the employer can search the pool against. */
export async function listEmployerPathAJobs(
  employerOrgId: string,
): Promise<Pick<JobOrderRow, "id" | "title" | "city" | "country_code" | "status">[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_orders")
    .select("id,title,city,country_code,status")
    .eq("employer_org_id", employerOrgId)
    .eq("recruitment_path", "A")
    .in("status", ["submitted", "approved", "active", "on_hold", "partially_filled"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listEmployerPathAJobs]", error.message);
    return [];
  }
  return (data as Pick<JobOrderRow, "id" | "title" | "city" | "country_code" | "status">[]) ?? [];
}

/**
 * Search the Zoho-synced candidate cache (experimental).
 * Masking is enforced in the SECURITY DEFINER RPC — never select the cache table directly.
 */
export async function searchEmployerTalentPool(
  jobOrderId: string,
  filters: EmployerZohoSearchFilters,
): Promise<{
  candidates: EmployerZohoPoolCandidateRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  error: string | null;
}> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_zoho_employer_talent_pool", {
    p_job_order_id: jobOrderId,
    p_q: filters.q?.trim() || null,
    p_skill: filters.skill?.trim() || null,
    p_country: filters.country?.trim() || null,
    p_city: filters.city?.trim() || null,
    p_availability: filters.availability?.trim() || null,
    p_experience_level: filters.experience_level?.trim() || null,
    p_industry: filters.industry?.trim() || null,
    p_qualification: filters.qualification?.trim() || null,
    p_role: filters.role?.trim() || null,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    console.error("[searchEmployerTalentPool]", error.message);
    return { candidates: [], totalCount: 0, page, pageSize, error: error.message };
  }

  const candidates = (data as EmployerZohoPoolCandidateRow[] | null) ?? [];
  const totalCount = candidates[0]?.total_count ?? 0;
  return { candidates, totalCount: Number(totalCount) || 0, page, pageSize, error: null };
}

export async function openEmployerPoolCandidate(
  candidateId: string,
  jobOrderId: string,
): Promise<{ candidate: EmployerZohoPoolCandidateRow | null; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_zoho_employer_pool_candidate", {
    p_candidate_id: candidateId,
    p_job_order_id: jobOrderId,
  });

  if (error) {
    console.error("[openEmployerPoolCandidate]", error.message);
    return { candidate: null, error: error.message };
  }
  const rows = (data as EmployerZohoPoolCandidateRow[] | null) ?? [];
  return { candidate: rows[0] ?? null, error: null };
}
