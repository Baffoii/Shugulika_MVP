import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getMyInterviewDetail } from "@/lib/data/video-interviews";
import { markInterviewExpiredAction } from "@/app/candidate/interview-actions";
import { InterviewSession } from "./InterviewSession";

export const metadata: Metadata = { title: "Record video interview" };

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

  if (detail.assignment.status !== "in_progress") {
    redirect(`/candidate/interviews/${assignmentId}`);
  }

  return <InterviewSession initialDetail={detail} />;
}
