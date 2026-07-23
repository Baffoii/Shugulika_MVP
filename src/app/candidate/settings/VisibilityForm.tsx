"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { SEARCH_APPROVED_FIELDS } from "@/lib/constants";

const APPROVED_FIELDS = SEARCH_APPROVED_FIELDS;

export function VisibilityForm({
  candidateId,
  initialSearchable,
  initialFields,
}: {
  candidateId: string;
  initialSearchable: boolean;
  initialFields: string[];
}) {
  const router = useRouter();
  const [searchable, setSearchable] = useState(initialSearchable);
  const [fields, setFields] = useState<string[]>(
    initialFields.length ? initialFields : APPROVED_FIELDS.map((f) => f.key),
  );
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function toggleField(key: string) {
    setFields((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function save() {
    setSaved(false);
    start(async () => {
      const supabase = createClient();
      await supabase.from("candidate_search_visibility").upsert({
        candidate_id: candidateId,
        is_searchable: searchable,
        approved_fields: fields,
        updated_at: new Date().toISOString(),
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {saved ? <Alert tone="success">Visibility preferences saved.</Alert> : null}
      <div className="space-y-2">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={searchable}
            onChange={(e) => setSearchable(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="block text-sm font-medium text-ink">
              Discoverable by authorized Shugulika recruiters
            </span>
            <span className="block text-xs text-ink-subtle">
              When off, your profile won&apos;t appear in the recruiter talent search. You can still
              apply to jobs normally.
            </span>
          </span>
        </label>
      </div>

      {searchable ? (
        <div className="rounded-lg border border-surface-border p-4">
          <p className="mb-2 text-sm font-medium text-ink">Fields recruiters may see in search</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {APPROVED_FIELDS.map((f) => (
              <Checkbox
                key={f.key}
                label={f.label}
                checked={fields.includes(f.key)}
                onChange={() => toggleField(f.key)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-subtle">
            We never include your government ID, contact details, references, recruiter notes,
            rejection reasons, or applications to other employers.
          </p>
        </div>
      ) : null}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </div>
  );
}
