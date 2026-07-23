import type { AssessmentQuestionBank } from "@/lib/assessments/question-bank-types";

/** Senior Shugulika aptitude bank — management, leadership, strategy, scenarios. */
export const SENIOR_QUESTION_BANK: AssessmentQuestionBank = {
  id: "shugulika-senior-v1",
  seniority: "senior",
  title: "Shugulika Senior Aptitude Assessment",
  description:
    "Scenario-based questions on technical management, leadership, strategic thinking, and judgment.",
  passThresholdPercent: 65,
  questions: [
    {
      id: "sr_q1",
      kind: "mcq",
      prompt:
        "A critical project is slipping. Two seniors disagree on architecture and the team is blocked. What should you do first as the lead?",
      choices: [
        { id: "a", label: "Pick a side privately and tell the team later" },
        {
          id: "b",
          label: "Facilitate a time-boxed decision meeting with decision criteria and an owner",
        },
        { id: "c", label: "Pause all work indefinitely until consensus appears" },
        { id: "d", label: "Replace both seniors immediately" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "sr_q2",
      kind: "mcq",
      prompt:
        "Which metric set best supports strategic hiring capacity planning for the next two quarters?",
      choices: [
        {
          id: "a",
          label: "Office snack preferences and commute distance only",
        },
        {
          id: "b",
          label: "Pipeline conversion, time-to-fill, attrition risk, and role criticality",
        },
        { id: "c", label: "Only the CEO’s preferred job titles" },
        { id: "d", label: "Number of LinkedIn connections on the team" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "sr_q3",
      kind: "mcq",
      prompt:
        "A high performer asks to skip a mandatory compliance training. What is the most appropriate leadership response?",
      choices: [
        { id: "a", label: "Exempt them permanently because of their results" },
        {
          id: "b",
          label:
            "Explain the non-negotiable requirement, schedule it, and protect their delivery priorities where possible",
        },
        { id: "c", label: "Publicly criticize them in the team chat" },
        { id: "d", label: "Ignore the request and hope they forget" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "sr_q4",
      kind: "mcq",
      prompt:
        "You must choose between shipping a partial feature this sprint or delaying for a more complete design. Stakeholders want speed; engineering flags maintainability risk. Best next step?",
      choices: [
        {
          id: "a",
          label:
            "Decide with an explicit trade-off: scope a safe MVP, document debt, and set a follow-up date",
        },
        { id: "b", label: "Ship everything unfinished with no tracking" },
        { id: "c", label: "Delay indefinitely with no stakeholder update" },
        { id: "d", label: "Let the loudest stakeholder decide alone" },
      ],
      correctChoiceIds: ["a"],
      points: 1,
    },
    {
      id: "sr_q5",
      kind: "mcq",
      prompt: "Which approach best develops a junior on a complex workstream?",
      choices: [
        { id: "a", label: "Assign the whole stream with no check-ins" },
        {
          id: "b",
          label:
            "Scaffold ownership: clear outcomes, paired reviews early, then increasing autonomy",
        },
        { id: "c", label: "Do the work yourself and keep them observing forever" },
        { id: "d", label: "Only give them administrative tasks" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "sr_q6",
      kind: "free_response",
      prompt:
        "Your team’s delivery quality has dropped for three sprints. Outline a 30-day recovery plan covering diagnosis, team communication, process changes, and how you will know it worked. Write 5–8 sentences.",
      points: 2,
      rubric: {
        id: "sr_q6_rubric",
        criteria: [
          {
            id: "diagnosis",
            label: "Diagnosis",
            maxPoints: 0.6,
            guidance:
              "Identifies likely causes with evidence (defects, unclear requirements, overload) rather than blame-only language.",
          },
          {
            id: "communication",
            label: "Communication",
            maxPoints: 0.5,
            guidance:
              "Explains how the leader aligns the team and stakeholders on the problem and plan.",
          },
          {
            id: "process",
            label: "Process changes",
            maxPoints: 0.5,
            guidance:
              "Proposes concrete changes (definition of done, review gates, WIP limits, pairing).",
          },
          {
            id: "measurement",
            label: "Success measures",
            maxPoints: 0.4,
            guidance:
              "Defines measurable signals within ~30 days (defect rate, cycle time, escaped bugs).",
          },
        ],
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      },
    },
    {
      id: "sr_q7",
      kind: "free_response",
      prompt:
        "A peer manager is consistently pulling your engineers into unplanned work. Describe how you would address this strategically while protecting delivery and the working relationship.",
      points: 2,
      rubric: {
        id: "sr_q7_rubric",
        criteria: [
          {
            id: "relationship",
            label: "Relationship and directness",
            maxPoints: 0.7,
            guidance:
              "Uses a private, respectful conversation; focuses on impact and shared goals.",
          },
          {
            id: "structure",
            label: "Intake structure",
            maxPoints: 0.7,
            guidance:
              "Proposes a request path (prioritization forum, SLA, capacity buffer) rather than ad-hoc grabs.",
          },
          {
            id: "escalation",
            label: "Escalation judgment",
            maxPoints: 0.6,
            guidance:
              "Knows when to escalate with facts if the behavior continues; protects team focus.",
          },
        ],
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      },
    },
  ],
};
