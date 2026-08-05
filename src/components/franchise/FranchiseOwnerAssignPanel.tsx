"use client";

import { useState, useTransition } from "react";
import { reassignEmployerApplicationOwnerAction } from "@/app/employer-application-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/form";

export function FranchiseOwnerAssignPanel({
  applicationId,
  currentOwnerId,
  owners,
}: {
  applicationId: string;
  currentOwnerId: string | null;
  owners: { id: string; name: string; email: string }[];
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId ?? "");
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign owner</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-muted">
          Ownership stays inside your franchise. Cross-franchise queue moves remain HQ-only.
        </p>
        {result ? (
          <Alert tone={result.ok ? "success" : "danger"}>{result.message ?? result.error}</Alert>
        ) : null}
        <Field label="Owner">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.email})
              </option>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          disabled={pending || ownerId === (currentOwnerId ?? "")}
          onClick={() =>
            startTransition(async () => {
              const res = await reassignEmployerApplicationOwnerAction(
                applicationId,
                ownerId || null,
              );
              setResult(res);
            })
          }
        >
          {pending ? "Saving…" : "Update owner"}
        </Button>
      </CardBody>
    </Card>
  );
}
