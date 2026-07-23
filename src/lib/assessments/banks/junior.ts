import type { AssessmentQuestionBank } from "@/lib/assessments/question-bank-types";

/** Junior Shugulika aptitude bank — working style, judgment, interests, scenarios. */
export const JUNIOR_QUESTION_BANK: AssessmentQuestionBank = {
  id: "shugulika-junior-v1",
  seniority: "junior",
  title: "Shugulika Junior Aptitude Assessment",
  description:
    "Scenario-based questions on working style, practical judgment, interests, and problem solving.",
  passThresholdPercent: 65,
  questions: [
    {
      id: "jr_q1",
      kind: "mcq",
      prompt:
        "You are asked to finish a customer report by 4pm. At 2pm you realize a key data file is incomplete. What should you do first?",
      choices: [
        { id: "a", label: "Submit the report with gaps and hope nobody notices" },
        { id: "b", label: "Tell your supervisor immediately and propose a recovery plan" },
        { id: "c", label: "Wait until 3:55pm in case the file appears on its own" },
        { id: "d", label: "Ask a colleague to take the blame if the report is late" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "jr_q2",
      kind: "mcq",
      prompt:
        "A teammate gives you feedback that your emails are unclear. Which response best shows a constructive working style?",
      choices: [
        { id: "a", label: "Ignore it — the teammate is being difficult" },
        { id: "b", label: "Defend every past email in detail" },
        {
          id: "c",
          label: "Thank them, ask for one example, and adjust your next emails",
        },
        { id: "d", label: "Stop writing emails and only use chat" },
      ],
      correctChoiceIds: ["c"],
      points: 1,
    },
    {
      id: "jr_q3",
      kind: "mcq",
      prompt:
        "You have three tasks: a 10-minute urgent client reply, a 2-hour analysis due tomorrow, and filing receipts with no deadline. What order is most practical?",
      choices: [
        { id: "a", label: "Filing → analysis → client reply" },
        { id: "b", label: "Client reply → analysis → filing" },
        { id: "c", label: "Analysis → filing → client reply" },
        { id: "d", label: "Filing → client reply → analysis" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "jr_q4",
      kind: "mcq",
      prompt:
        "During a team stand-up you do not understand an instruction. What is the best action?",
      choices: [
        { id: "a", label: "Stay silent and guess later" },
        { id: "b", label: "Ask a clarifying question before the meeting ends" },
        { id: "c", label: "Pretend you understood and message a friend outside work" },
        { id: "d", label: "Skip the related task entirely" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "jr_q5",
      kind: "mcq",
      prompt: "Which activity best matches a strength in practical, hands-on problem solving?",
      choices: [
        { id: "a", label: "Preferring abstract theory with no application" },
        {
          id: "b",
          label: "Breaking a messy process into steps and testing a small fix",
        },
        { id: "c", label: "Avoiding tools and checklists" },
        { id: "d", label: "Waiting for someone else to define every detail" },
      ],
      correctChoiceIds: ["b"],
      points: 1,
    },
    {
      id: "jr_q6",
      kind: "free_response",
      prompt:
        "A customer is upset because a delivery is two days late. In 4–6 sentences, describe how you would handle the call: what you would say first, what information you would gather, and how you would close the conversation.",
      points: 2,
      rubric: {
        id: "jr_q6_rubric",
        criteria: [
          {
            id: "empathy",
            label: "Empathy and ownership",
            maxPoints: 0.7,
            guidance:
              "Acknowledges the inconvenience without blaming the customer; takes responsibility for helping.",
          },
          {
            id: "information",
            label: "Information gathering",
            maxPoints: 0.7,
            guidance:
              "Asks for order details, timeline facts, and what outcome the customer needs.",
          },
          {
            id: "resolution",
            label: "Clear next step",
            maxPoints: 0.6,
            guidance:
              "States a concrete follow-up (escalate, reschedule, compensate per policy) and a time to update the customer.",
          },
        ],
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      },
    },
    {
      id: "jr_q7",
      kind: "free_response",
      prompt:
        "You notice two coworkers disagreeing about who owns a shared spreadsheet. Explain how you would help resolve the situation without escalating unnecessarily. Cover roles, communication, and a simple working agreement.",
      points: 2,
      rubric: {
        id: "jr_q7_rubric",
        criteria: [
          {
            id: "facilitation",
            label: "Facilitation",
            maxPoints: 0.7,
            guidance:
              "Brings both parties into a short clarifying conversation; avoids taking sides prematurely.",
          },
          {
            id: "clarity",
            label: "Ownership clarity",
            maxPoints: 0.7,
            guidance: "Proposes a clear owner, backup, and update cadence for the spreadsheet.",
          },
          {
            id: "agreement",
            label: "Working agreement",
            maxPoints: 0.6,
            guidance:
              "Documents a simple rule (who edits, how conflicts are flagged) and checks both agree.",
          },
        ],
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      },
    },
  ],
};
