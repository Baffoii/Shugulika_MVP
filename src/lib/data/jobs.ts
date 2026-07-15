import { createClient } from "@/lib/supabase/server";
import type { PublicJobRow } from "@/lib/database.types";

export interface JobFilters {
  q?: string;
  country?: string;
  employment_type?: string;
  work_arrangement?: string;
  experience_level?: string;
}

export interface JobQueryResult {
  jobs: PublicJobRow[];
  configured: boolean;
  error: string | null;
}

/** Public job board query. Reads the safe `public_jobs` view (advertised only). */
export async function listPublicJobs(filters: JobFilters): Promise<JobQueryResult> {
  const supabase = createClient();
  let query = supabase.from("public_jobs").select("*").order("published_at", { ascending: false });

  if (filters.country) query = query.eq("country_code", filters.country);
  if (filters.employment_type) query = query.eq("employment_type", filters.employment_type);
  if (filters.work_arrangement) query = query.eq("work_arrangement", filters.work_arrangement);
  if (filters.experience_level) query = query.eq("experience_level", filters.experience_level);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`title.ilike.${term},description.ilike.${term},employer_name.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) {
    // Missing table/view (schema not applied yet) → treat as unconfigured, not a crash.
    return { jobs: [], configured: false, error: error.message };
  }
  return { jobs: (data ?? []) as PublicJobRow[], configured: true, error: null };
}

export async function getPublicJob(idOrSlug: string): Promise<PublicJobRow | null> {
  const supabase = createClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const query = supabase.from("public_jobs").select("*");
  const { data } = isUuid
    ? await query.eq("job_id", idOrSlug).maybeSingle()
    : await query.eq("public_slug", idOrSlug).maybeSingle();
  return (data as PublicJobRow | null) ?? null;
}
