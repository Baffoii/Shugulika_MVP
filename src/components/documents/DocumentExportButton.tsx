"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { DocumentSourceKind } from "@/lib/documents/access-types";

/** HQ Super Admin only — triggers audited original-file export. */
export function DocumentExportButton({
  source,
  id,
  label = "Export original",
}: {
  source: DocumentSourceKind;
  id: string;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exportOriginal() {
    setError(null);
    start(() => {
      const q = new URLSearchParams({ source, id });
      // Full navigation so the browser receives Content-Disposition: attachment.
      window.location.assign(`/api/documents/export?${q.toString()}`);
    });
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={exportOriginal} disabled={pending}>
        {pending ? "Exporting…" : label}
      </Button>
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
      <p className="text-xs text-ink-subtle">Super Admin only · every export is audited</p>
    </div>
  );
}
