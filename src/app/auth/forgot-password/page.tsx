"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { Card, Button, Alert } from "@/components/ui/primitives";
import { Field, Input } from "@/components/ui/form";
import { forgotPasswordSchema, fieldErrors } from "@/lib/validation";

export default function ForgotPasswordPage() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.siteUrl()}/auth/callback`,
    });
    setLoading(false);
    if (error) setFormError(error.message);
    else setSent(true);
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">We&apos;ll email you a secure reset link.</p>
      {sent ? (
        <Alert tone="success" title="Email sent">
          If an account exists for that address, a reset link is on its way.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field label="Email" htmlFor="email" error={errors.email} required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/auth/sign-in" className="text-brand-700 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </Card>
  );
}
