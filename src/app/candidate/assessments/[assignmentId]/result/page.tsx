import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import {
  getMyAssessmentAssignments,
  getMyCandidate,
  getMyResultShareGrants,
  getMyResultSnapshot,
} from "@/lib/data/candidate";
import { formatDateTime } from "@/lib/format";
import { ResultShareControls } from "./ResultShareControls";

export const metadata: Metadata = { title: "Assessment result" };

function payloadEntries(payload: unknown): Array<[string, string]> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
    key.replaceAll("_", " "),
    typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value),
  ]);
}

export default async function CandidateAssessmentResultPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const candidate = await getMyCandidate();
  if (!candidate) notFound();
  const [assignments, snapshot, allGrants] = await Promise.all([
    getMyAssessmentAssignments(candidate.id),
    getMyResultSnapshot(candidate.id, assignmentId),
    getMyResultShareGrants(candidate.id),
  ]);
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment || !snapshot) notFound();
  const grants = allGrants.filter((grant) => grant.assignment_id === assignmentId);
  const entries = payloadEntries(snapshot.permitted_payload);

  return (
    <div>
      <PageHeader
        title="Your assessment result"
        description="This is a verified snapshot stored by Shugulika, so it remains available if the assessment provider is offline."
        actions={
          <ButtonLink href="/candidate/assessments" variant="outline" size="sm">
            Back to assessments
          </ButtonLink>
        }
      />

      <Alert tone="info" title="What this result means">
        It describes this assessment only. It is not an employability rating and does not compare
        you with other candidates or protected groups.
      </Alert>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Permitted result snapshot</CardTitle>
            <Badge tone={snapshot.visibility_tier === "candidate_full" ? "success" : "info"}>
              {snapshot.visibility_tier === "candidate_full"
                ? "Full candidate result"
                : snapshot.visibility_tier === "candidate_limited"
                  ? "Limited candidate result"
                  : "Completion only"}
            </Badge>
          </CardHeader>
          <CardBody>
            <dl className="space-y-3">
              {entries.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink">{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Snapshot captured
                </dt>
                <dd className="mt-0.5 text-sm text-ink">{formatDateTime(snapshot.captured_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Provider
                </dt>
                <dd className="mt-0.5 text-sm text-ink">{snapshot.provider}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who can see this</CardTitle>
          </CardHeader>
          <CardBody>
            <ResultShareControls
              assignmentId={assignmentId}
              grants={grants}
              canCreateShare={snapshot.visibility_tier === "candidate_full"}
              asOf={new Date().toISOString()}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
