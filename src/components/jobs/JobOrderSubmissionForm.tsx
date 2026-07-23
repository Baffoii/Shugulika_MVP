"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { submitJobOrderAction, type JobOrderActionResult } from "@/app/job-order-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { COUNTRIES, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_ARRANGEMENTS } from "@/lib/constants";

const initial: JobOrderActionResult = { ok: false };

function SubmitButton({ submitted }: { submitted: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending || submitted}>
      {pending ? "Submitting…" : submitted ? "Submitted" : "Submit for approval"}
    </Button>
  );
}

function JobOrderSubmissionFormInner({ onSubmitAnother }: { onSubmitAnother: () => void }) {
  const [state, action] = useFormState(submitJobOrderAction, initial);
  const [vacancies, setVacancies] = useState("1");
  const [assessmentMode, setAssessmentMode] = useState("shugulika");
  const [assessmentDialogOpen, setAssessmentDialogOpen] = useState(false);
  const [assessmentFileNames, setAssessmentFileNames] = useState<string[]>([]);
  const [answerKeyFileNames, setAnswerKeyFileNames] = useState<string[]>([]);
  const submitted = state.ok;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Submit a new job order</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={action} className="grid gap-4 md:grid-cols-2">
          {state.error ? (
            <div className="md:col-span-2">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null}
          {submitted ? (
            <div className="md:col-span-2">
              <Alert tone="success">{state.message}</Alert>
            </div>
          ) : null}
          <Field label="Job title" htmlFor="title" required>
            <Input id="title" name="title" required disabled={submitted} />
          </Field>
          <Field label="Department" htmlFor="department">
            <Input id="department" name="department" disabled={submitted} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" required disabled={submitted} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Requirements" htmlFor="requirements">
              <Textarea id="requirements" name="requirements" disabled={submitted} />
            </Field>
          </div>
          <Field label="Country" htmlFor="country_code" required>
            <Select id="country_code" name="country_code" defaultValue="TZ" disabled={submitted}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code} disabled={!c.active}>
                  {c.name}
                  {!c.active ? " — not active" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" disabled={submitted} />
          </Field>
          <Field label="Employment type" htmlFor="employment_type">
            <Select id="employment_type" name="employment_type" disabled={submitted}>
              <option value="">Select</option>
              {EMPLOYMENT_TYPES.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work arrangement" htmlFor="work_arrangement">
            <Select id="work_arrangement" name="work_arrangement" disabled={submitted}>
              <option value="">Select</option>
              {WORK_ARRANGEMENTS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Experience level" htmlFor="experience_level">
            <Select id="experience_level" name="experience_level" disabled={submitted}>
              <option value="">Select</option>
              {EXPERIENCE_LEVELS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vacancies" htmlFor="vacancy_count" required>
            <Input
              id="vacancy_count"
              name="vacancy_count"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={vacancies}
              required
              disabled={submitted}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setVacancies("");
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setVacancies(String(Math.max(1, Math.trunc(n))));
              }}
              onBlur={() => {
                const n = Number(vacancies);
                if (!Number.isFinite(n) || n < 1) setVacancies("1");
              }}
            />
          </Field>
          <Field label="Recruitment route" htmlFor="recruitment_path" required>
            <Select
              id="recruitment_path"
              name="recruitment_path"
              defaultValue="B"
              disabled={submitted}
            >
              <option value="B">Shugulika-managed</option>
              <option value="A">Direct employer recruitment</option>
            </Select>
          </Field>
          <Field label="Application deadline" htmlFor="application_deadline">
            <Input
              id="application_deadline"
              name="application_deadline"
              type="date"
              disabled={submitted}
            />
          </Field>
          <Field label="Minimum salary" htmlFor="salary_min">
            <Input id="salary_min" name="salary_min" type="number" min="0" disabled={submitted} />
          </Field>
          <Field label="Maximum salary" htmlFor="salary_max">
            <Input id="salary_max" name="salary_max" type="number" min="0" disabled={submitted} />
          </Field>
          <div className="flex items-end">
            <Checkbox
              name="salary_public"
              label="Show salary on the public job post"
              disabled={submitted}
            />
          </div>

          <section className="md:col-span-2 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
            <h3 className="text-sm font-semibold text-ink">Aptitude testing</h3>
            <p className="mt-1 text-sm text-ink-muted">
              How would you like aptitude testing to be handled for this role?
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Assessment option" htmlFor="assessment_mode" required>
                <Select
                  id="assessment_mode"
                  name="assessment_mode"
                  value={assessmentMode}
                  disabled={submitted}
                  onChange={(event) => {
                    const mode = event.target.value;
                    setAssessmentMode(mode);
                    if (mode === "employer" || mode === "both") {
                      setAssessmentDialogOpen(true);
                    }
                  }}
                >
                  <option value="shugulika">Shugulika administers the aptitude test</option>
                  <option value="employer">We will provide our own test</option>
                  <option value="both">Both Shugulika and employer-provided tests</option>
                </Select>
              </Field>
              <Field label="Assessment level" htmlFor="assessment_seniority" required>
                <Select
                  id="assessment_seniority"
                  name="assessment_seniority"
                  defaultValue="junior"
                  disabled={submitted}
                >
                  <option value="junior">Junior assessment</option>
                  <option value="senior">Senior assessment</option>
                </Select>
              </Field>
            </div>
            {assessmentMode === "employer" || assessmentMode === "both" ? (
              <div className="mt-3 space-y-2 rounded-lg bg-white p-3 text-sm">
                <p className="text-ink-muted">
                  Candidate test files:{" "}
                  {assessmentFileNames.length
                    ? assessmentFileNames.join(", ")
                    : "none attached yet."}
                </p>
                <p className="text-ink-muted">
                  Answer key files:{" "}
                  {answerKeyFileNames.length ? answerKeyFileNames.join(", ") : "none attached yet."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitted}
                  onClick={() => setAssessmentDialogOpen(true)}
                >
                  {assessmentFileNames.length || answerKeyFileNames.length
                    ? "Replace files"
                    : "Attach employer test + answer key"}
                </Button>
              </div>
            ) : null}
          </section>

          <div
            className={
              assessmentDialogOpen
                ? "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                : "hidden"
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="assessment-upload-title"
          >
            <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
              <h3 id="assessment-upload-title" className="text-base font-semibold text-ink">
                Employer test files
              </h3>
              <p className="mt-1 text-sm text-ink-muted">
                Upload one or more candidate-facing test files and one or more answer-key files. Do
                not put answer keys in the candidate-facing uploads.
              </p>
              <div className="mt-4 space-y-4">
                <Field
                  label="Candidate-facing test file(s)"
                  htmlFor="assessment_files"
                  hint="PDF, DOC, DOCX, XLS, XLSX, or CSV. Maximum 10 MB each. Multiple files allowed."
                  required={assessmentMode !== "shugulika"}
                >
                  <Input
                    id="assessment_files"
                    name="assessment_files"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
                    disabled={submitted}
                    onChange={(event) =>
                      setAssessmentFileNames(
                        Array.from(event.target.files ?? []).map((file) => file.name),
                      )
                    }
                  />
                </Field>
                <Field
                  label="Answer key file(s)"
                  htmlFor="answer_key_files"
                  hint="Required with employer tests. Staff-only access. Multiple files allowed."
                  required={assessmentMode !== "shugulika"}
                >
                  <Input
                    id="answer_key_files"
                    name="answer_key_files"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
                    disabled={submitted}
                    onChange={(event) =>
                      setAnswerKeyFileNames(
                        Array.from(event.target.files ?? []).map((file) => file.name),
                      )
                    }
                  />
                </Field>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAssessmentDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!assessmentFileNames.length || !answerKeyFileNames.length}
                  onClick={() => setAssessmentDialogOpen(false)}
                >
                  Use these files
                </Button>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-3">
            {submitted ? (
              <Button type="button" variant="secondary" onClick={onSubmitAnother}>
                Submit another role
              </Button>
            ) : null}
            <SubmitButton submitted={submitted} />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function JobOrderSubmissionForm() {
  const [formKey, setFormKey] = useState(0);
  return (
    <JobOrderSubmissionFormInner
      key={formKey}
      onSubmitAnother={() => setFormKey((key) => key + 1)}
    />
  );
}
