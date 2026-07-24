import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Handles Supabase email confirmation / magic-link / password-reset redirects. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Password-recovery emails pass next=/auth/update-password; confirmations default to post-login.
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next");
  const next = nextParam ?? (type === "recovery" ? "/auth/update-password" : "/auth/post-login");

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/auth/post-login"}`);
    }
  }
  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback`);
}
