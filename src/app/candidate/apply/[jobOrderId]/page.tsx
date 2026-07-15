import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Card, CardBody, Alert } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";
import { getMyCandidate, getMyDocuments } from "@/lib/data/candidate";
import type { PublicJobRow, JobScreeningQuestionRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Apply" };

export default async function ApplyPage({ params }: { params: { jobOrderId: string } }) {
  const candidate = await getMyCandidate();
  if (!candidate) return <Alert tone="warn">Set up your candidate profile first.</Alert>;

  const supabase = createClient();
  const { data: job } = await supabase.from("public_jobs").select("*").eq("job_order_id", params.jobOrderId).maybeSingle();
  const jobRow = job as PublicJobRow | null;
  if (!jobRow) notFound();

  const [docs, { data: questions }] = await Promise.all([
    getMyDocuments(candidate.id),
    supabase.from("job_screening_questions").select("*").eq("job_order_id", params.jobOrderId).order("ordinal"),
  ]);
  const cvs = docs.filter((d) => d.doc_type === "cv");

  const { ApplyForm } = await import("./ApplyForm");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Apply — ${jobRow.title}`} description={`${jobRow.employer_name} · ${jobRow.city ?? ""} ${jobRow.country_code}`} />
      <Card className="mb-4">
        <CardBody className="text-sm text-ink-muted">
          Takes about 3–5 minutes. Your saved profile and CV are used, so you don&apos;t need to re-enter everything.
        </CardBody>
      </Card>
      <ApplyForm
        jobOrderId={params.jobOrderId}
        jobTitle={jobRow.title}
        employerName={jobRow.employer_name}
        cvs={cvs}
        questions={(questions as JobScreeningQuestionRow[] | null) ?? []}
      />
    </div>
  );
}
