"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Alert } from "@/components/ui/primitives";
import { Field, PasswordInput } from "@/components/ui/form";
import { updatePasswordSchema, fieldErrors } from "@/lib/validation";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setReady(true);
    });
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const parsed = updatePasswordSchema.safeParse({
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setDone(true);
    router.push("/auth/post-login");
    router.refresh();
  }

  if (!ready) {
    return (
      <Card className="p-6 sm:p-8">
        <p className="text-sm text-ink-muted">Checking your session…</p>
      </Card>
    );
  }

  if (!hasSession) {
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-lg font-semibold text-ink">Set a new password</h1>
        <div className="mt-4">
          <Alert tone="danger" title="Link expired or invalid">
            Open the latest reset link from your email, or request a new one.
          </Alert>
        </div>
        <p className="mt-4 text-sm">
          <Link href="/auth/forgot-password" className="text-brand-700 hover:underline">
            Request a new reset link
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-ink">Set a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">Choose a password for your Shugulika account.</p>
      {done ? (
        <div className="mt-5">
          <Alert tone="success" title="Password updated">
            Taking you to your account…
          </Alert>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field
            label="New password"
            htmlFor="password"
            error={errors.password}
            hint="At least 8 characters."
            required
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
          <Field
            label="Confirm password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword}
            required
          >
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Saving…" : "Update password"}
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
