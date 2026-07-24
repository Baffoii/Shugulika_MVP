import { describe, it, expect } from "vitest";
import { approvedEmail, changesRequestedEmail } from "@/lib/email/templates/employer-application";

describe("employer decision email templates", () => {
  it("builds a changes-requested email with explanation, changes, and onboarding CTA", () => {
    const content = changesRequestedEmail({
      companyName: "Acme Logistics <Ltd>",
      explanation: 'Please clarify the industry for "Acme".',
      changes: [
        { field: "industry", instruction: "Use a specific sector, not 'Other'." },
        { instruction: "Confirm the physical address includes a street number." },
      ],
      ctaUrl: "http://localhost:3000/onboarding/employer",
    });

    expect(content.subject).toBe("Action needed: update your Shugulika company registration");
    expect(content.text).toContain("Acme Logistics <Ltd>");
    expect(content.text).toContain('Please clarify the industry for "Acme".');
    expect(content.text).toContain("industry: Use a specific sector");
    expect(content.text).toContain("Confirm the physical address");
    expect(content.text).toContain("http://localhost:3000/onboarding/employer");
    expect(content.html).toContain("Update application");
    expect(content.html).toContain("http://localhost:3000/onboarding/employer");
    expect(content.html).toContain("Acme Logistics &lt;Ltd&gt;");
    expect(content.html).not.toContain("<Ltd>");
  });

  it("builds an approved email with office name and dashboard CTA", () => {
    const content = approvedEmail({
      companyName: "Bahari Financial Group",
      officeName: "Shugulika Tanzania (Dar es Salaam)",
      ctaUrl: "https://app.example.com/employer/dashboard",
    });

    expect(content.subject).toBe("Your company is approved on Shugulika");
    expect(content.text).toContain("Bahari Financial Group is now approved");
    expect(content.text).toContain("Shugulika Tanzania (Dar es Salaam)");
    expect(content.text).toContain("https://app.example.com/employer/dashboard");
    expect(content.html).toContain("Open employer dashboard");
    expect(content.html).toContain("https://app.example.com/employer/dashboard");
  });

  it("falls back to generic company and office labels when names are blank", () => {
    const changes = changesRequestedEmail({
      companyName: "  ",
      explanation: "Need more detail on the registered address.",
      changes: [],
      ctaUrl: "http://localhost:3000/onboarding/employer",
    });
    expect(changes.text).toContain("your company");

    const approved = approvedEmail({
      companyName: "",
      officeName: "",
      ctaUrl: "http://localhost:3000/employer/dashboard",
    });
    expect(approved.text).toContain("Your company is now approved");
    expect(approved.text).toContain("Responsible office: Shugulika HQ");
  });
});
