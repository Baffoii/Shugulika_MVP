import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyInterviewDetail } from "@/lib/data/video-interviews";
import { markInterviewExpiredAction } from "@/app/candidate/interview-actions";
import { completeLiveAiInterviewAction } from "@/app/recruiter/ai-interview-actions";
import { InterviewSession } from "./InterviewSession";
import { LiveAiInterviewSession } from "./LiveAiInterviewSession";

export const metadata: Metadata = { title: "Interview session" };

export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const detail = await getMyInterviewDetail(assignmentId);
  if (!detail) notFound();

  const softExpired =
    detail.assignment.expires_at !== null && new Date(detail.assignment.expires_at) < new Date();
  if (softExpired && ["invited", "in_progress"].includes(detail.assignment.status)) {
    await markInterviewExpiredAction(assignmentId);
    redirect(`/candidate/interviews/${assignmentId}`);
  }

  // Live AI: completed interviews never reopen the mic-check / start flow.
  if (detail.assignment.interview_mode === "live_ai_voice") {
    if (["submitted", "reviewed"].includes(detail.assignment.status)) {
      redirect(`/candidate/interviews/${assignmentId}`);
    }
    if (!["invited", "in_progress"].includes(detail.assignment.status)) {
      redirect(`/candidate/interviews/${assignmentId}`);
    }

    const supabase = createClient();
    const { data: liveSession } = await supabase
      .from("interview_live_sessions")
      .select("id, status")
      .eq("assignment_id", assignmentId)
      .in("status", ["completed", "incomplete_technical", "abandoned"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (liveSession) {
      // Session already ended — finalize assignment if needed, then show confirmation.
      await completeLiveAiInterviewAction((liveSession as { id: string }).id);
      redirect(`/candidate/interviews/${assignmentId}`);
    }

    return (
      <LiveAiInterviewSession
        assignment={detail.assignment}
        questions={detail.questions}
        jobTitle={detail.jobTitle ?? detail.assignment.template_name_snapshot}
      />
    );
  }

  if (detail.assignment.status !== "in_progress") {
    redirect(`/candidate/interviews/${assignmentId}`);
  }

  return <InterviewSession initialDetail={detail} />;
}
