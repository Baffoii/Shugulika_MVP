import type { Metadata } from "next";
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import {
  SUPPORTED_ASSESSMENT_DEVICES,
  SUPPORTED_INTERVIEW_DEVICES,
} from "@/lib/candidate/constants";
import {
  applicationRoleLabel,
  getMyApplications,
  getMyAssessmentAssignments,
  getMyCandidate,
} from "@/lib/data/candidate";
import { getMyInterviewAssignments } from "@/lib/data/video-interviews";
import { formatDateTime } from "@/lib/format";
import { HelpRequestForm } from "./HelpRequestForm";
import { DeviceCheck } from "./DeviceCheck";

export const metadata: Metadata = { title: "Candidate help" };

export default async function CandidateHelpPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const [applications, assessments, interviews] = await Promise.all([
    getMyApplications(candidate.id),
    getMyAssessmentAssignments(candidate.id),
    getMyInterviewAssignments(candidate.id),
  ]);
  const appLabels = new Map(applications.map((app) => [app.id, applicationRoleLabel(app)]));
  const subjects = [
    ...applications.map((app) => ({
      type: "application" as const,
      id: app.id,
      label: `Application · ${applicationRoleLabel(app)}`,
    })),
    ...assessments.map((assessment) => ({
      type: "assessment" as const,
      id: assessment.id,
      label: `Assessment · ${appLabels.get(assessment.application_id) ?? "Job application"}${
        assessment.due_at ? ` · Due ${formatDateTime(assessment.due_at)}` : ""
      }`,
    })),
    ...interviews.map((interview) => ({
      type: "interview" as const,
      id: interview.id,
      label: `Interview · ${interview.job_title ?? interview.template_name_snapshot}${
        interview.expires_at ? ` · Due ${formatDateTime(interview.expires_at)}` : ""
      }`,
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Preparation, accessibility, and help"
        description="Check your setup early. If a deadline is at risk, send a request before it passes so staff can respond."
        actions={
          <ButtonLink href="/candidate/dashboard" variant="outline" size="sm">
            Back to progress home
          </ButtonLink>
        }
      />

      <Alert tone="warn" title="Deadlines still apply">
        Sending a help or reschedule request does not automatically extend a deadline. The hiring
        team will notify you if a new deadline is approved.
      </Alert>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Assessment setup</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
              {SUPPORTED_ASSESSMENT_DEVICES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Interview setup</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
              {SUPPORTED_INTERVIEW_DEVICES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accessibility tips</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-ink-muted">
            <ul className="list-disc space-y-2 pl-5">
              <li>Use browser zoom and your preferred screen reader.</li>
              <li>Request additional time or another format before the deadline.</li>
              <li>Include the specific barrier in your help request.</li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Browser device check</CardTitle>
        </CardHeader>
        <CardBody>
          <DeviceCheck />
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Contact the hiring team</CardTitle>
        </CardHeader>
        <CardBody>
          <HelpRequestForm candidateId={candidate.id} subjects={subjects} />
        </CardBody>
      </Card>
    </div>
  );
}
