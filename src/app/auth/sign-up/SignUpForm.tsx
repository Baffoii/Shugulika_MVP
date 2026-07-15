"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { Field, Input, Select } from "@/components/ui/form";
import { Button, Alert } from "@/components/ui/primitives";
import { signUpSchema, fieldErrors } from "@/lib/validation";
import { ROLE_LABELS } from "@/lib/constants";

export function SignUpForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const values = {
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      role: String(form.get("role") ?? "candidate"),
    };
    const parsed = signUpSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${env.siteUrl()}/auth/callback`,
        data: { full_name: parsed.data.fullName, role: parsed.data.role },
      },
    });
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    // If email confirmation is required, there is no session yet.
    if (!data.session) {
      setNeedsConfirm(true);
      return;
    }
    router.push("/auth/post-login");
    router.refresh();
  }

  if (needsConfirm) {
    return (
      <div className="mt-5">
        <Alert tone="success" title="Check your email">
          We sent a confirmation link. Confirm your address, then sign in. (If email confirmation is disabled
          in your Supabase project, you can sign in immediately.)
        </Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field label="Full name" htmlFor="fullName" error={errors.fullName} required>
        <Input id="fullName" name="fullName" autoComplete="name" placeholder="Amina Hassan" />
      </Field>
      <Field label="I am a" htmlFor="role" error={errors.role} required>
        <Select id="role" name="role" defaultValue="candidate">
          <option value="candidate">{ROLE_LABELS.candidate} — looking for work</option>
          <option value="employer_user">{ROLE_LABELS.employer_user} — hiring</option>
        </Select>
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters." required>
        <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" />
      </Field>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
