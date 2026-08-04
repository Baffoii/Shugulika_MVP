import { createClient } from "@/lib/supabase/server";
import type { EmployerPoolCandidateRow, JobOrderRow } from "@/lib/database.types";
import type { TalentSearchFilters } from "@/lib/data/talent-search";

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

export async function searchEmployerTalentPool(
  jobOrderId: string,
  filters: TalentSearchFilters,
): Promise<{ candidates: EmployerPoolCandidateRow[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_employer_talent_pool", {
    p_job_order_id: jobOrderId,
    p_q: filters.q?.trim() || null,
    p_skill: filters.skill?.trim() || null,
    p_country: filters.country?.trim() || null,
    p_city: filters.city?.trim() || null,
    p_availability: filters.availability?.trim() || null,
    p_experience_level: filters.experience_level?.trim() || null,
    p_limit: 50,
  });

  if (error) {
    console.error("[searchEmployerTalentPool]", error.message);
    return { candidates: [], error: error.message };
  }
  return { candidates: (data as EmployerPoolCandidateRow[] | null) ?? [], error: null };
}

export async function openEmployerPoolCandidate(
  candidateId: string,
  jobOrderId: string,
): Promise<{ candidate: EmployerPoolCandidateRow | null; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_employer_pool_candidate", {
    p_candidate_id: candidateId,
    p_job_order_id: jobOrderId,
  });

  if (error) {
    console.error("[openEmployerPoolCandidate]", error.message);
    return { candidate: null, error: error.message };
  }
  const rows = (data as EmployerPoolCandidateRow[] | null) ?? [];
  return { candidate: rows[0] ?? null, error: null };
}
