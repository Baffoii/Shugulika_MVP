import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Card, CardBody, Alert } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";
import { getMyCandidate, getMyDocuments } from "@/lib/data/candidate";
import type { PublicJobRow, JobScreeningQuestionRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Apply" };

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobOrderId: string }>;
  searchParams?: Promise<{ reapply?: string }>;
}) {
  const { jobOrderId } = await params;
  const query = (await searchParams) ?? {};
  const candidate = await getMyCandidate();
  if (!candidate) return <Alert tone="warn">Set up your candidate profile first.</Alert>;

  const supabase = createClient();
  const { data: job } = await supabase
    .from("public_jobs")
    .select("*")
    .eq("job_order_id", jobOrderId)
    .maybeSingle();
  const jobRow = job as PublicJobRow | null;
  if (!jobRow) notFound();

  const [docs, { data: questions }, { data: existingApp }] = await Promise.all([
    getMyDocuments(candidate.id),
    supabase
      .from("job_screening_questions")
      .select("*")
      .eq("job_order_id", jobOrderId)
      .order("ordinal"),
    supabase
      .from("applications")
      .select("id, withdrawn_at")
      .eq("candidate_id", candidate.id)
      .eq("job_order_id", jobOrderId)
      .maybeSingle(),
  ]);
  const cvs = docs.filter((d) => d.doc_type === "cv");
  const existing = existingApp as { id: string; withdrawn_at: string | null } | null;
  const alreadyApplied = Boolean(existing && !existing.withdrawn_at);
  const isReapply = Boolean(existing?.withdrawn_at) || query.reapply === "1";
  const isResubmit = alreadyApplied || isReapply;

  const { ApplyForm } = await import("./ApplyForm");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`${
          existing?.withdrawn_at ? "Reapply" : alreadyApplied ? "Update application" : "Apply"
        } — ${jobRow.title}`}
        description={`${jobRow.employer_name} · ${jobRow.city ?? ""} ${jobRow.country_code}`}
      />
      <Card className="mb-4">
        <CardBody className="text-sm text-ink-muted">
          Takes about 3–5 minutes. Your saved profile and CV are used, so you don&apos;t need to
          re-enter everything.
        </CardBody>
      </Card>
      <ApplyForm
        jobOrderId={jobOrderId}
        jobTitle={jobRow.title}
        employerName={jobRow.employer_name}
        cvs={cvs}
        questions={(questions as JobScreeningQuestionRow[] | null) ?? []}
        alreadyApplied={isResubmit}
        isReapplyAfterWithdraw={Boolean(existing?.withdrawn_at)}
      />
    </div>
  );
}
