import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getMyInterviewDetail } from "@/lib/data/video-interviews";
import { markInterviewExpiredAction } from "@/app/candidate/interview-actions";
import { InterviewSession } from "./InterviewSession";

export const metadata: Metadata = { title: "Record video interview" };

export default async function InterviewSessionPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  const detail = await getMyInterviewDetail(params.assignmentId);
  if (!detail) notFound();

  const softExpired =
    detail.assignment.expires_at !== null && new Date(detail.assignment.expires_at) < new Date();
  if (softExpired && ["invited", "in_progress"].includes(detail.assignment.status)) {
    await markInterviewExpiredAction(params.assignmentId);
    redirect(`/candidate/interviews/${params.assignmentId}`);
  }

  if (detail.assignment.status !== "in_progress") {
    redirect(`/candidate/interviews/${params.assignmentId}`);
  }

  return <InterviewSession initialDetail={detail} />;
}
