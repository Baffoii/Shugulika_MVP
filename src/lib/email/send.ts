import "server-only";

import { env } from "@/lib/env";
import { emailFrom, getResendClient, isEmailConfigured } from "@/lib/email/client";
import {
  approvedEmail,
  changesRequestedEmail,
  type ApprovedEmailInput,
  type ChangesRequestedEmailInput,
} from "@/lib/email/templates/employer-application";

export type EmployerDecisionEmailKind = "changes_requested" | "approved";

export interface SendEmployerDecisionEmailArgs {
  to: string;
  kind: EmployerDecisionEmailKind;
  payload: ChangesRequestedEmailInput | ApprovedEmailInput;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  id?: string;
}

/**
 * Best-effort transactional email for employer onboarding decisions.
 * Never throws — callers keep treating the DB RPC as the source of truth.
 */
export async function sendEmployerDecisionEmail(
  args: SendEmployerDecisionEmailArgs,
): Promise<SendEmailResult> {
  const to = args.to.trim();
  if (!to) {
    console.warn("[email] skipped employer decision email: missing recipient");
    return { ok: false, skipped: true, error: "missing recipient" };
  }

  if (!isEmailConfigured()) {
    console.info("[email] skipped employer decision email (no RESEND_API_KEY / EMAIL_FROM)");
    return { ok: true, skipped: true };
  }

  const client = getResendClient();
  const from = emailFrom();
  if (!client || !from) {
    console.info("[email] skipped employer decision email (client unavailable)");
    return { ok: true, skipped: true };
  }

  const content =
    args.kind === "changes_requested"
      ? changesRequestedEmail(args.payload as ChangesRequestedEmailInput)
      : approvedEmail(args.payload as ApprovedEmailInput);

  try {
    const { data, error } = await client.emails.send({
      from,
      to: [to],
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (error) {
      console.error("[email] Resend send failed", error);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] Resend send threw", message);
    return { ok: false, error: message };
  }
}

/** Absolute URL helper for CTA links in decision emails. */
export function employerDecisionCtaUrl(
  path: "/onboarding/employer" | "/employer/dashboard",
): string {
  const base = env.siteUrl().replace(/\/$/, "");
  return `${base}${path}`;
}
