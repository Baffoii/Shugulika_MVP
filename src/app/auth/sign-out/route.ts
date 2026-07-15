import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/auth/sign-in", env.siteUrl()), { status: 303 });
}
