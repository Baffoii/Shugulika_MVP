import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Alert,
} from "@/components/ui/primitives";
import {
  getMyCandidate,
  getMyExperiences,
  getMyEducation,
  getMySkills,
  getMyDocuments,
  getMyCertifications,
  getMyLanguages,
} from "@/lib/data/candidate";
import { getPendingSuggestions } from "@/lib/data/resume-suggestions";
import { getSessionContext } from "@/lib/auth";
import { DocumentManager } from "@/app/candidate/documents/DocumentManager";
import { CvAnalysisStatus } from "@/components/profile/CvAnalysisStatus";
import { SuggestionCard } from "@/components/profile/SuggestionCard";
import { SuggestionReviewBanner } from "@/components/profile/SuggestionReviewBanner";
import { ProfileForm } from "./ProfileForm";
import {
  ExperienceAddForm,
  EducationAddForm,
  ExperienceItem,
  EducationItem,
  SkillAdder,
  CertificationAddForm,
  CertificationItem,
  LanguageAddForm,
  LanguageItem,
} from "./ProfileSections";

export const metadata: Metadata = { title: "Profile" };

export default async function CandidateProfilePage() {
  const [candidate, session] = await Promise.all([getMyCandidate(), getSessionContext()]);
  if (!candidate || !session)
    return (
      <Alert tone="warn">Your candidate profile is still being set up. Refresh in a moment.</Alert>
    );
  const [experiences, education, skills, documents, certifications, languages, suggestions] =
    await Promise.all([
      getMyExperiences(candidate.id),
      getMyEducation(candidate.id),
      getMySkills(candidate.id),
      getMyDocuments(candidate.id),
      getMyCertifications(candidate.id),
      getMyLanguages(candidate.id),
      getPendingSuggestions(candidate.id),
    ]);
  const cvs = documents.filter((document) => document.doc_type === "cv");
  const latestCv = cvs[0] ?? null;
  const { groups, total, latestRun } = suggestions;

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Build one reusable profile. You choose what recruiters can discover and what employers see."
      />

      <div className="mb-4">
        <Alert tone="info" title="Who can see what">
          Your contact details stay private. Only fields you approve for discovery are searchable by
          authorized recruiters, and employers only ever see a masked profile you consent to share
          for a specific role.
        </Alert>
      </div>

      <SuggestionReviewBanner groups={groups} total={total} />

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Personal & contact</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {groups.profile.length > 0 ? (
              <ul className="space-y-2">
                {groups.profile.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} />
                ))}
              </ul>
            ) : null}
            <ProfileForm profile={candidate} phone={session.profile?.phone ?? null} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work experience</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {experiences.length === 0 && groups.experience.length === 0 ? (
              <p className="text-sm text-ink-subtle">No experience added yet.</p>
            ) : null}
            <ul className="space-y-2">
              {groups.experience.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
              {experiences.map((e) => (
                <ExperienceItem key={e.id} experience={e} />
              ))}
            </ul>
            <ExperienceAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Education</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {education.length === 0 && groups.education.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                No education added yet. Non-university and vocational training are welcome.
              </p>
            ) : null}
            <ul className="space-y-2">
              {groups.education.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
              {education.map((e) => (
                <EducationItem key={e.id} education={e} />
              ))}
            </ul>
            <EducationAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {groups.skill.length > 0 ? (
              <ul className="space-y-2">
                {groups.skill.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} />
                ))}
              </ul>
            ) : null}
            <SkillAdder skills={skills.map((s) => ({ id: s.id, name: s.name }))} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Certifications</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {certifications.length === 0 && groups.certification.length === 0 ? (
              <p className="text-sm text-ink-subtle">No certifications added yet.</p>
            ) : null}
            <ul className="space-y-2">
              {groups.certification.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
              {certifications.map((c) => (
                <CertificationItem key={c.id} certification={c} />
              ))}
            </ul>
            <CertificationAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Languages</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {languages.length === 0 && groups.language.length === 0 ? (
              <p className="text-sm text-ink-subtle">No languages added yet.</p>
            ) : null}
            <ul className="space-y-2">
              {groups.language.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
              {languages.map((l) => (
                <LanguageItem key={l.id} language={l} />
              ))}
            </ul>
            <LanguageAddForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CV / Resume</CardTitle>
          </CardHeader>
          <CardBody>
            <DocumentManager
              candidateId={candidate.id}
              userId={session.userId}
              documents={cvs}
              fixedDocType="cv"
              embedded
            />
            <CvAnalysisStatus document={latestCv} run={latestRun} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
