import { createClient } from "@/lib/supabase/server";
import type {
  ResumeFieldSuggestionRow,
  ResumeParseRunRow,
  ResumeSuggestionTargetEntity,
} from "@/lib/database.types";

export type PendingSuggestionsByEntity = Record<
  ResumeSuggestionTargetEntity,
  ResumeFieldSuggestionRow[]
>;

function emptyGroups(): PendingSuggestionsByEntity {
  return { profile: [], experience: [], education: [], skill: [], certification: [], language: [] };
}

/** The most recent parse run for a candidate's CV(s), across all documents. */
export async function getLatestParseRun(candidateId: string): Promise<ResumeParseRunRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("resume_parse_runs")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ResumeParseRunRow | null) ?? null;
}

/**
 * Pending suggestions from only the latest parse run, grouped by target
 * entity. Older, unresolved suggestions from a superseded run are left in
 * the database (queryable) but intentionally not surfaced here.
 */
export async function getPendingSuggestions(candidateId: string): Promise<{
  latestRun: ResumeParseRunRow | null;
  groups: PendingSuggestionsByEntity;
  total: number;
}> {
  const latestRun = await getLatestParseRun(candidateId);
  if (!latestRun) return { latestRun: null, groups: emptyGroups(), total: 0 };

  const supabase = createClient();
  const { data } = await supabase
    .from("resume_field_suggestions")
    .select("*")
    .eq("parse_run_id", latestRun.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const rows = (data as ResumeFieldSuggestionRow[] | null) ?? [];

  const groups = emptyGroups();
  for (const row of rows) {
    groups[row.target_entity].push(row);
  }
  return { latestRun, groups, total: rows.length };
}

export async function getSuggestionById(id: string): Promise<ResumeFieldSuggestionRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("resume_field_suggestions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ResumeFieldSuggestionRow | null) ?? null;
}
