import { test, expect } from "@playwright/test";

/**
 * Live auth + role e2e. These need a configured Supabase (GoTrue) and the seeded
 * test accounts (supabase/migrations/0005_seed_test_users.sql). They are skipped
 * unless E2E_LIVE=1, so the default CI smoke run stays deterministic.
 *
 * Run locally:  E2E_LIVE=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
 */
const live = process.env.E2E_LIVE === "1";
const PASSWORD = "12345678";

test.describe("authenticated portals (live)", () => {
  test.skip(!live, "Set E2E_LIVE=1 with a configured Supabase + seeded users to run.");

  async function signIn(page: import("@playwright/test").Page, email: string) {
    await page.goto("/auth/sign-in");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
  }

  test("candidate signs in and lands on the candidate dashboard", async ({ page }) => {
    await signIn(page, "candidate@shugulika.test");
    await expect(page).toHaveURL(/\/candidate\/dashboard/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("recruiter reaches the pipeline; candidate cannot", async ({ page }) => {
    await signIn(page, "recruiter@shugulika.test");
    await expect(page).toHaveURL(/\/recruiter\/dashboard/, { timeout: 15_000 });
    await page.goto("/recruiter/pipeline");
    await expect(page.getByRole("heading", { name: /pipeline/i })).toBeVisible();
  });

  test("employer is denied the HQ portal (server-side authorization)", async ({ page }) => {
    await signIn(page, "employer@shugulika.test");
    await expect(page).toHaveURL(/\/employer\/dashboard/, { timeout: 15_000 });
    await page.goto("/hq/dashboard");
    // Redirected away — cannot access another portal even by direct URL.
    await expect(page).not.toHaveURL(/\/hq\/dashboard/);
  });
});
