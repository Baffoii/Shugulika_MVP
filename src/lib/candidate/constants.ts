export const CANDIDATE_RESULT_SHARE_PURPOSE = "share_assessment_result" as const;

export const CANDIDATE_HELP_REQUEST_TYPES = ["help", "reschedule", "duplicate_review"] as const;
export type CandidateHelpRequestType = (typeof CANDIDATE_HELP_REQUEST_TYPES)[number];

export const SUPPORTED_ASSESSMENT_DEVICES = [
  "A recent Chrome, Edge, Firefox, or Safari browser",
  "A stable internet connection for submitting answers",
  "A laptop or desktop for employer-provided files",
] as const;

export const SUPPORTED_INTERVIEW_DEVICES = [
  "A laptop or desktop with a working camera and microphone",
  "Chrome, Edge, or Firefox with camera and microphone permission",
  "A stable connection and a quiet, well-lit space",
] as const;
