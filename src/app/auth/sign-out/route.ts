import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  // Use the request origin so local multi-port / preview hosts don't bounce
  // to a stale NEXT_PUBLIC_SITE_URL (commonly localhost:3000).
  const { origin } = new URL(request.url);
  return NextResponse.redirect(new URL("/auth/sign-in", origin), { status: 303 });
}
