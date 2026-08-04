import { NextResponse } from "next/server";
import { verifyZohoWebhookAuth } from "@/lib/integrations/zoho-recruit/webhook-auth";
import { storeInboxWebhook } from "@/lib/integrations/zoho-recruit/inbox";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const auth = verifyZohoWebhookAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    const text = new TextDecoder("utf-8").decode(raw);
    payload = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const client = createServiceRoleClient();
  if (!client) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("id")
    .eq("connection_key", "primary")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "connection_missing" }, { status: 503 });
  }

  const eventType =
    typeof payload === "object" &&
    payload &&
    "event" in payload &&
    typeof (payload as { event: unknown }).event === "string"
      ? (payload as { event: string }).event
      : undefined;

  // Quick ack — durable store then 202. Business processing is asynchronous.
  const { row, created } = await storeInboxWebhook({
    connectionId: (connection as { id: string }).id,
    payload,
    eventType,
    signatureVerified: false,
  });

  return NextResponse.json({ accepted: true, inboxId: row.id, created }, { status: 202 });
}
