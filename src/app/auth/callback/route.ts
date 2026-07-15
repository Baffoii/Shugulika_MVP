import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Handles Supabase email confirmation / magic-link / password-reset redirects. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/auth/post-login";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/auth/post-login"}`);
    }
  }
  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback`);
}
