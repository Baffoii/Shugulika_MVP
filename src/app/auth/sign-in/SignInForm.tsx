"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field, Input, PasswordInput } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { signInSchema, fieldErrors } from "@/lib/validation";

export function SignInForm({ redirectTo }: { redirectTo: string | null }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const values = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    const parsed = signInSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    router.push(
      redirectTo
        ? `/auth/post-login?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/auth/post-login",
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
      {formError ? (
        <p
          className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {formError}
        </p>
      ) : null}
      <Field label="Email" htmlFor="email" error={errors.email} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password} required>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </Field>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
