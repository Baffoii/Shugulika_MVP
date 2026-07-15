import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Alert } from "@/components/ui/primitives";
import { getMyCandidate, getMyExperiences, getMyEducation, getMySkills } from "@/lib/data/candidate";
import { ProfileForm } from "./ProfileForm";
import { ExperienceAddForm, EducationAddForm, SkillAdder, DeleteButton } from "./ProfileSections";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Profile" };

export default async function CandidateProfilePage() {
  const candidate = await getMyCandidate();
  if (!candidate) return <Alert tone="warn">Your candidate profile is still being set up. Refresh in a moment.</Alert>;
  const [experiences, education, skills] = await Promise.all([
    getMyExperiences(candidate.id),
    getMyEducation(candidate.id),
    getMySkills(candidate.id),
  ]);

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
                <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-surface-border p-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{e.title}{e.employer_name ? ` · ${e.employer_name}` : ""}</p>
                    <p className="text-xs text-ink-subtle">{formatDate(e.start_date)} – {e.is_current ? "Present" : formatDate(e.end_date)}</p>
                    {e.description ? <p className="mt-1 text-sm text-ink-muted">{e.description}</p> : null}
                  </div>
                  <DeleteButton table="candidate_experiences" id={e.id} />
                </li>
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
                <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-surface-border p-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{e.institution}</p>
                    <p className="text-xs text-ink-subtle">{[e.qualification, e.field_of_study].filter(Boolean).join(" · ")}</p>
                  </div>
                  <DeleteButton table="candidate_education" id={e.id} />
                </li>
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
      </div>
    </div>
  );
}
