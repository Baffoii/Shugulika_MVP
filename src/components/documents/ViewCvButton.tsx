"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";

/** Opens a short-lived signed URL for a private Storage object (view-only). */
export function ViewCvButton({
  bucketId,
  objectPath,
  label,
}: {
  bucketId: string;
  objectPath: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const supabase = createClient();
      const { data } = await supabase.storage.from(bucketId).createSignedUrl(objectPath, 120);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    });
  }
  return (
    <Button variant="ghost" size="sm" onClick={open} disabled={pending}>
      {pending ? "Opening…" : label}
    </Button>
  );
}
