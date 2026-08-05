"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { revertMergeAction } from "@/app/hq/merge-review/actions";

/**
 * Reverting asks for a reason before it asks for a click.
 *
 * The reason is not paperwork: a reverted merge means someone decided two
 * records were the same person and was wrong, and the next person to look at
 * the pair needs to know why.
 */
export function RevertMergeForm({ mergeEventId }: { mergeEventId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Revert
      </Button>
    );
  }

  return (
    <form action={revertMergeAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="mergeEventId" value={mergeEventId} />
      <input
        name="reason"
        required
        placeholder="Why is this being reverted?"
        className="w-56 rounded-md border border-surface-border bg-white px-2 py-1 text-sm text-ink"
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" size="sm">
          Revert merge
        </Button>
      </div>
    </form>
  );
}
