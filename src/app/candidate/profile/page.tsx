import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Alert } from "@/components/ui/primitives";
import { getMyCandidate, getMyExperiences, getMyEducation, getMySkills, getMyDocuments } from "@/lib/data/candidate";
import { getSessionContext } from "@/lib/auth";
import { DocumentManager } from "@/app/candidate/documents/DocumentManager";
import { ProfileForm } from "./ProfileForm";
import { ExperienceAddForm, EducationAddForm, ExperienceItem, EducationItem, SkillAdder } from "./ProfileSections";

export const metadata: Metadata = { title: "Profile" };

export default async function CandidateProfilePage() {
  const [candidate, session] = await Promise.all([getMyCandidate(), getSessionContext()]);
  if (!candidate || !session) return <Alert tone="warn">Your candidate profile is still being set up. Refresh in a moment.</Alert>;
  const [experiences, education, skills, documents] = await Promise.all([
    getMyExperiences(candidate.id),
    getMyEducation(candidate.id),
    getMySkills(candidate.id),
    getMyDocuments(candidate.id),
  ]);
  const cvs = documents.filter((document) => document.doc_type === "cv");

  return (
    <div>
      <PageHeader title="My profile" description="Build one reusable profile. You choose what recruiters can discover and what employers see." />

      <div className="mb-4">
        <Alert tone="info" title="Who can see what">
          Your contact details stay private. Only fields you approve for discovery are searchable by authorized recruiters, and employers only ever see a masked
          profile you consent to share for a specific role.
        </Alert>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Personal & contact</CardTitle></CardHeader>
          <CardBody><ProfileForm profile={candidate} /></CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Work experience</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {experiences.length === 0 ? <p className="text-sm text-ink-subtle">No experience added yet.</p> : null}
            <ul className="space-y-2">
              {experiences.map((e) => (
                <ExperienceItem key={e.id} experience={e} />
              ))}
            </ul>
            <ExperienceAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Education</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {education.length === 0 ? <p className="text-sm text-ink-subtle">No education added yet. Non-university and vocational training are welcome.</p> : null}
            <ul className="space-y-2">
              {education.map((e) => (
                <EducationItem key={e.id} education={e} />
              ))}
            </ul>
            <EducationAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
          <CardBody>
            <SkillAdder skills={skills.map((s) => ({ id: s.id, name: s.name }))} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>CV / Resume</CardTitle></CardHeader>
          <CardBody>
            <DocumentManager
              candidateId={candidate.id}
              userId={session.userId}
              documents={cvs}
              fixedDocType="cv"
              embedded
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
