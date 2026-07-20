"use client";

import {
  cancelAssignmentAction,
  getPlaybackUrlAction,
  markReviewedAction,
  saveReviewAction,
  sendInterviewReminderAction,
} from "@/app/recruiter/interview-actions";
import { RecordingPlayback } from "@/components/interviews/RecordingPlayback";
import type { InterviewReviewRow } from "@/lib/database.types";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function Playback({
  attemptId,
  durationSeconds,
}: {
  attemptId: string;
  durationSeconds?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    setError(null);
    start(async () => {
      const result = await getPlaybackUrlAction(attemptId);
      if (!result.ok || !result.url) return setError(result.error ?? "Recording unavailable.");
      setUrl(result.url);
    });
  }

  if (url) {
    return (
      <div className="mt-3">
        {durationSeconds != null && durationSeconds > 0 ? (
          <RecordingPlayback
            src={url}
            durationSeconds={Number(durationSeconds)}
            aria-label="Selected candidate response"
            className="rounded-lg bg-black"
          />
        ) : (
          <video
            className="w-full rounded-lg bg-black"
            src={url}
            controls
            preload="none"
            aria-label="Selected candidate response"
            onError={() => {
              setUrl(null);
              setError("Playback link expired or the recording is unavailable. Load it again.");
            }}
          />
        )}
        <p className="mt-1 text-xs text-ink-subtle">Playback links expire after two minutes.</p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={load}>
        {pending ? "Loading recording…" : error ? "Retry loading recording" : "Load recording"}
      </Button>
      <p className="mt-1 text-xs text-ink-subtle">Playback links expire after two minutes.</p>
    </div>
  );
}

export function ReviewForm({
  assignmentId,
  review,
}: {
  assignmentId: string;
  review: InterviewReviewRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  function submit(form: HTMLFormElement, markReviewed: boolean) {
    const data = new FormData(form);
    data.set("assignment_id", assignmentId);
    setMessage(null);
    start(async () => {
      const result = await (markReviewed ? markReviewedAction(data) : saveReviewAction(data));
      if (!result.ok)
        return setMessage({ tone: "danger", text: result.error ?? "Could not save review." });
      setMessage({
        tone: "success",
        text: markReviewed ? "Interview marked reviewed." : "Review saved.",
      });
      router.refresh();
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recruiter review</CardTitle>
      </CardHeader>
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget, false);
          }}
        >
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <Field label="Overall rating" htmlFor="overall-rating">
            <Select
              id="overall-rating"
              name="overall_rating"
              defaultValue={review?.overall_rating ?? ""}
            >
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating} / 5
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Internal notes"
            htmlFor="internal-notes"
            hint="Never visible to the candidate."
          >
            <Textarea
              id="internal-notes"
              name="internal_notes"
              defaultValue={review?.internal_notes ?? ""}
              maxLength={4000}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save review"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (form) submit(form, true);
              }}
            >
              Mark reviewed
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function CancelInterviewButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error ? <p className="mb-2 text-xs text-status-danger">{error}</p> : null}
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Cancel this interview invitation?")) return;
          const data = new FormData();
          data.set("assignment_id", assignmentId);
          start(async () => {
            const result = await cancelAssignmentAction(data);
            if (!result.ok) return setError(result.error ?? "Could not cancel.");
            router.refresh();
          });
        }}
      >
        {pending ? "Cancelling…" : "Cancel interview"}
      </Button>
    </div>
  );
}

export function ReminderButton({ assignmentId }: { assignmentId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{
    tone: "danger" | "success";
    text: string;
  } | null>(null);
  return (
    <div>
      {message ? (
        <div className="mb-2">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set("assignment_id", assignmentId);
          setMessage(null);
          start(async () => {
            const result = await sendInterviewReminderAction(data);
            setMessage(
              result.ok
                ? { tone: "success", text: "In-app deadline reminder sent." }
                : { tone: "danger", text: result.error ?? "Could not send reminder." },
            );
          });
        }}
      >
        {pending ? "Sending…" : "Send deadline reminder"}
      </Button>
    </div>
  );
}
