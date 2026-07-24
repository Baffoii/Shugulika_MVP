import { test, expect } from "@playwright/test";

// These smoke tests are deterministic and do not need a live auth backend: they
// assert public structure and the middleware auth gate (unauthenticated → sign-in).

test("landing page renders the Shugulika brand and a jobs entry point", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /browse jobs/i }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /create account|create a candidate profile/i }).first(),
  ).toBeVisible();
});

test("job board shows the search + filter controls", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: /find your next role/i })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByLabel("Keyword")).toBeVisible();
  await expect(page.getByRole("button", { name: /search/i })).toBeVisible();
});

test("sign-in page exposes an accessible form", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  // Prefer the password input by name — getByLabel(/password/i) also matches the
  // show/hide toggle's aria-label ("Show password").
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /show password/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("protected candidate route redirects unauthenticated visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/candidate/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  // and preserves where they were headed
  await expect(page).toHaveURL(/redirectTo=%2Fcandidate%2Fdashboard/);
});

test("protected HQ route is also gated", async ({ page }) => {
  await page.goto("/hq/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});
