"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";

/** Confirms before navigating to the apply form when the candidate already applied or withdrew. */
export function ApplyAgainButton({
  href,
  jobTitle,
  employerName,
  mode = "update",
}: {
  href: string;
  jobTitle: string;
  employerName: string;
  /** `reapply` after withdraw; `update` when still actively applied. */
  mode?: "update" | "reapply";
}) {
  const router = useRouter();
  const isReapply = mode === "reapply";
  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={() => {
        const ok = window.confirm(
          isReapply
            ? `You withdrew your application for ${jobTitle} at ${employerName}. Apply again? Recruiters will see that you previously withdrew.`
            : `You've already applied for ${jobTitle} at ${employerName}. Do you want to update your application?`,
        );
        if (ok) router.push(href);
      }}
    >
      {isReapply ? "Apply again" : "Update application"}
    </Button>
  );
}
