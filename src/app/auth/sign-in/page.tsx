import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-muted">Sign in to your Shugulika account.</p>
      <SignInForm redirectTo={redirectTo ?? null} />
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/auth/forgot-password" className="text-brand-700 hover:underline">
          Forgot password?
        </Link>
        <Link href="/auth/sign-up" className="text-brand-700 hover:underline">
          Create an account
        </Link>
      </div>
    </Card>
  );
}
