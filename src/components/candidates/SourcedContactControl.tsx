"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSourcedContactStatusAction } from "@/app/recruiter/sourcing-actions";
import { SOURCED_CONTACT_STATUSES, type SourcedContactStatusKey } from "@/lib/constants";
import { Select } from "@/components/ui/form";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";

export function SourcedContactControl({
  applicationId,
  status,
  contactedAt,
}: {
  applicationId: string;
  status: SourcedContactStatusKey | null;
  contactedAt: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<SourcedContactStatusKey>(status ?? "not_contacted");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await updateSourcedContactStatusAction({
        applicationId,
        status: value,
      });
      if (!result.ok) {
        setError(result.error ?? "Update failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sourcing contact</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="text-sm text-ink-muted">
          Sourced candidates start as Not contacted. Update disposition as you outreach.
        </p>
        <Select
          value={value}
          onChange={(e) => setValue(e.target.value as SourcedContactStatusKey)}
          aria-label="Sourced contact status"
        >
          {SOURCED_CONTACT_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        {contactedAt ? (
          <p className="text-xs text-ink-subtle">First contacted {formatDateTime(contactedAt)}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={pending || value === (status ?? "not_contacted")}
          onClick={save}
        >
          {pending ? "Saving…" : "Update status"}
        </Button>
      </CardBody>
    </Card>
  );
}
