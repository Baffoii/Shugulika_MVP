"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Star, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, Badge, Button, Alert, EmptyState } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/form";
import { DOCUMENT_TYPES, CANDIDATE_DOC_BUCKET } from "@/lib/constants";
import { formatDate, titleCase } from "@/lib/format";
import type { CandidateDocumentRow } from "@/lib/database.types";

export function DocumentManager({ candidateId, userId, documents }: { candidateId: string; userId: string; documents: CandidateDocumentRow[] }) {
  const router = useRouter();
  const [docType, setDocType] = useState("cv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(false);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const cfg = DOCUMENT_TYPES.find((d) => d.key === docType);
    if (cfg && file.size > cfg.maxMb * 1024 * 1024) {
      setError(`File too large. Max ${cfg.maxMb} MB.`);
      return;
    }
    setBusy(true);
    setProgress(true);
    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${docType}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(CANDIDATE_DOC_BUCKET).upload(path, file, { upsert: false });
    if (upErr) {
      setBusy(false); setProgress(false);
      setError(upErr.message.includes("Bucket not found") ? "Storage bucket not set up yet — run supabase/migrations/0003_mvp_storage.sql." : upErr.message);
      return;
    }
    const isPrimaryCv = docType === "cv" && !documents.some((d) => d.doc_type === "cv" && d.is_primary);
    const { error: insErr } = await supabase.from("candidate_documents").insert({
      candidate_id: candidateId, doc_type: docType, title: file.name, bucket_id: CANDIDATE_DOC_BUCKET,
      object_path: path, mime_type: file.type, size_bytes: file.size, is_primary: isPrimaryCv,
    });
    setBusy(false); setProgress(false);
    if (insErr) { setError(insErr.message); return; }
    router.refresh();
  }

  function setPrimary(doc: CandidateDocumentRow) {
    start(async () => {
      const supabase = createClient();
      await supabase.from("candidate_documents").update({ is_primary: false }).eq("candidate_id", candidateId).eq("doc_type", "cv");
      await supabase.from("candidate_documents").update({ is_primary: true }).eq("id", doc.id);
      router.refresh();
    });
  }

  function archive(doc: CandidateDocumentRow) {
    start(async () => {
      const supabase = createClient();
      await supabase.from("candidate_documents").update({ status: "archived" }).eq("id", doc.id);
      router.refresh();
    });
  }

  async function view(doc: CandidateDocumentRow) {
    const supabase = createClient();
    const { data } = await supabase.storage.from(doc.bucket_id).createSignedUrl(doc.object_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Document type" htmlFor="doctype">
            <Select id="doctype" value={docType} onChange={(e) => setDocType(e.target.value)} className="sm:w-64">
              {DOCUMENT_TYPES.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
            </Select>
          </Field>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : "Upload file"}
            <input type="file" className="hidden" accept={DOCUMENT_TYPES.find((d) => d.key === docType)?.accept} onChange={onFile} disabled={busy} />
          </label>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">Stored privately. Only you and recruiters you apply to (via a short-lived link) can open your files.</p>
        {error ? <div className="mt-3"><Alert tone="danger">{error}</Alert></div> : null}
      </Card>

      {documents.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet" description="Upload your CV to apply faster." />
      ) : (
        <Card>
          <ul className="divide-y divide-surface-border">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{d.title ?? d.object_path.split("/").pop()}</p>
                    <p className="text-xs text-ink-subtle">{titleCase(d.doc_type)} · {formatDate(d.created_at)}</p>
                  </div>
                  {d.is_primary ? <Badge tone="success">Primary CV</Badge> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => view(d)}>View</Button>
                  {d.doc_type === "cv" && !d.is_primary ? (
                    <Button variant="ghost" size="sm" onClick={() => setPrimary(d)} disabled={pending}><Star className="h-4 w-4" /> Set primary</Button>
                  ) : null}
                  <button onClick={() => archive(d)} disabled={pending} aria-label="Archive" className="rounded-md p-1.5 text-ink-subtle hover:bg-red-50 hover:text-status-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
