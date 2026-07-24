/**
 * Pure email template builders for employer onboarding decisions.
 * No server-only imports — unit-testable without network.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface ChangesRequestedEmailInput {
  companyName: string;
  explanation: string;
  changes: { field?: string; instruction: string }[];
  ctaUrl: string;
}

export interface ApprovedEmailInput {
  companyName: string;
  officeName: string;
  ctaUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ctaButton(label: string, url: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#c45c26;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export function changesRequestedEmail(input: ChangesRequestedEmailInput): EmailContent {
  const company = input.companyName.trim() || "your company";
  const subject = "Action needed: update your Shugulika company registration";
  const bullets = input.changes
    .map((c) => {
      const label = c.field?.trim() ? `${c.field.trim()}: ` : "";
      return `- ${label}${c.instruction.trim()}`;
    })
    .filter((line) => line.length > 2);

  const text = [
    `Shugulika needs updates to the registration for ${company}.`,
    "",
    input.explanation.trim(),
    "",
    bullets.length ? "Required changes:" : null,
    ...bullets,
    "",
    `Update your application: ${input.ctaUrl}`,
  ]
    .filter((line): line is string => line != null)
    .join("\n");

  const htmlBullets =
    bullets.length > 0
      ? `<ul>${input.changes
          .map((c) => {
            const label = c.field?.trim() ? `<strong>${escapeHtml(c.field.trim())}:</strong> ` : "";
            return `<li>${label}${escapeHtml(c.instruction.trim())}</li>`;
          })
          .join("")}</ul>`
      : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#243b53">
      <p>Shugulika needs updates to the registration for <strong>${escapeHtml(company)}</strong>.</p>
      <p>${escapeHtml(input.explanation.trim())}</p>
      ${htmlBullets}
      ${ctaButton("Update application", input.ctaUrl)}
      <p style="font-size:12px;color:#627d98">If the button does not work, open: ${escapeHtml(input.ctaUrl)}</p>
    </div>
  `.trim();

  return { subject, html, text };
}

export function approvedEmail(input: ApprovedEmailInput): EmailContent {
  const company = input.companyName.trim() || "Your company";
  const office = input.officeName.trim() || "Shugulika HQ";
  const subject = "Your company is approved on Shugulika";
  const text = [
    `${company} is now approved on Shugulika.`,
    `Responsible office: ${office}.`,
    "",
    `Open your employer dashboard: ${input.ctaUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#243b53">
      <p><strong>${escapeHtml(company)}</strong> is now approved on Shugulika.</p>
      <p>Responsible office: ${escapeHtml(office)}.</p>
      <p>You can now use the employer portal for roles, submissions, and billing.</p>
      ${ctaButton("Open employer dashboard", input.ctaUrl)}
      <p style="font-size:12px;color:#627d98">If the button does not work, open: ${escapeHtml(input.ctaUrl)}</p>
    </div>
  `.trim();

  return { subject, html, text };
}
