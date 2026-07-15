import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">Candidates and employers can register here.</p>
      <SignUpForm />
      <p className="mt-4 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-brand-700 hover:underline">Sign in</Link>
      </p>
      <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-subtle">
        Recruiter, franchise, operations, accounts and HQ accounts are invite-only and provisioned by an administrator.
      </p>
    </Card>
  );
}
