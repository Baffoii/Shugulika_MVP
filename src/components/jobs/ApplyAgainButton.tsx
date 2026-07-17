"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";

/** Confirms before navigating to the apply form when the candidate already applied. */
export function ApplyAgainButton({
  href,
  jobTitle,
  employerName,
}: {
  href: string;
  jobTitle: string;
  employerName: string;
}) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={() => {
        const ok = window.confirm(
          `You've already applied for ${jobTitle} at ${employerName}. Do you want to submit another application?`,
        );
        if (ok) router.push(href);
      }}
    >
      Apply again
    </Button>
  );
}
