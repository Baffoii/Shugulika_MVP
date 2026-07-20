"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Star, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseResumeAction } from "@/app/candidate/resume-actions";
import { Badge, Button, Alert, EmptyState } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/form";
import { DOCUMENT_TYPES, CANDIDATE_DOC_BUCKET } from "@/lib/constants";
import { formatDate, titleCase } from "@/lib/format";
import type { CandidateDocumentRow } from "@/lib/database.types";

export function DocumentManager({
  candidateId,
  userId,
  documents,
  fixedDocType,
  embedded = false,
  documentsLocked = false,
}: {
  candidateId: string;
  userId: string;
  documents: CandidateDocumentRow[];
  fixedDocType?: string;
  embedded?: boolean;
  /** When true, an active interview has locked documents — mutations are blocked. */
  documentsLocked?: boolean;
}) {
  const router = useRouter();
  const [selectedDocType, setSelectedDocType] = useState(fixedDocType ?? "cv");
  const docType = fixedDocType ?? selectedDocType;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const profileCvDropzone = embedded && fixedDocType === "cv";

  async function uploadFile(file: File) {
    if (busy) return;
    if (documentsLocked) {
      setError(
        "Documents are locked for your active interview session and cannot be changed until the interview is submitted.",
      );
      return;
    }
    setError(null);
    const cfg = DOCUMENT_TYPES.find((d) => d.key === docType);
    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (cfg && !cfg.accept.split(",").includes(extension)) {
      setError(`Unsupported file type. Choose ${cfg.accept.replaceAll(",", ", ")}.`);
      return;
    }
    if (cfg && file.size > cfg.maxMb * 1024 * 1024) {
      setError(`File too large. Max ${cfg.maxMb} MB.`);
      return;
    }
    setBusy(true);
    setProgress(true);
    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${docType}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(CANDIDATE_DOC_BUCKET)
      .upload(path, file, { upsert: false });
    if (upErr) {
      setBusy(false);
      setProgress(false);
      setError(
        upErr.message.includes("Bucket not found")
          ? "Storage bucket not set up yet — run supabase/migrations/0003_mvp_storage.sql."
          : upErr.message,
      );
      return;
    }
    const isPrimaryCv =
      docType === "cv" && !documents.some((d) => d.doc_type === "cv" && d.is_primary);
    const { data: inserted, error: insErr } = await supabase
      .from("candidate_documents")
      .insert({
        candidate_id: candidateId,
        doc_type: docType,
        title: file.name,
        bucket_id: CANDIDATE_DOC_BUCKET,
        object_path: path,
        mime_type: file.type,
        size_bytes: file.size,
        is_primary: isPrimaryCv,
      })
      .select("id")
      .single();
    setBusy(false);
    setProgress(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    if (fixedDocType === "cv" && inserted) {
      // Await the fast "queued"/validation phase so the DB reflects a status
      // before we refresh — otherwise the page can render before analysis
      // has written anything and the progress UI never engages. The slow
      // extraction work itself still runs in the background server-side.
      await parseResumeAction((inserted as { id: string }).id);
    }
    router.refresh();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }

  function setPrimary(doc: CandidateDocumentRow) {
    if (documentsLocked) {
      setError(
        "Documents are locked for your active interview session and cannot be changed until the interview is submitted.",
      );
      return;
    }
    start(async () => {
      const supabase = createClient();
      await supabase
        .from("candidate_documents")
        .update({ is_primary: false })
        .eq("candidate_id", candidateId)
        .eq("doc_type", "cv");
      await supabase.from("candidate_documents").update({ is_primary: true }).eq("id", doc.id);
      router.refresh();
    });
  }

  function archive(doc: CandidateDocumentRow) {
    if (documentsLocked) {
      setError(
        "Documents are locked for your active interview session and cannot be changed until the interview is submitted.",
      );
      return;
    }
    start(async () => {
      const supabase = createClient();
      await supabase.from("candidate_documents").update({ status: "archived" }).eq("id", doc.id);
      router.refresh();
    });
  }

  async function view(doc: CandidateDocumentRow) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from(doc.bucket_id)
      .createSignedUrl(doc.object_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="space-y-4">
      {documentsLocked ? (
        <Alert tone="warn">
          An interview session is in progress. Identity and supporting documents are locked and
          cannot be replaced until the interview is submitted. Attempted changes are flagged for
          recruiter review.
        </Alert>
      ) : null}
      {profileCvDropzone ? (
        <div>
          <label
            className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 ${
              dragging
                ? "border-brand-500 bg-brand-100"
                : "border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void uploadFile(file);
            }}
          >
            {progress ? (
              <Loader2 className="mb-4 h-12 w-12 animate-spin text-brand-500" aria-hidden />
            ) : (
              <Upload className="mb-4 h-12 w-12 text-brand-400" aria-hidden />
            )}
            {documents.length === 0 ? (
              <span className="mb-1 text-sm font-semibold text-ink">No CV uploaded yet</span>
            ) : null}
            <span className="text-sm font-medium text-ink">
              {busy
                ? "Uploading…"
                : documents.length === 0
                  ? "Choose a CV / resume or drag it here"
                  : "Choose another CV / resume or drag it here"}
            </span>
            <span className="mt-1 text-xs text-ink-subtle">PDF, DOC, or DOCX · maximum 15 MB</span>
            <input
              type="file"
              className="sr-only"
              accept={DOCUMENT_TYPES.find((d) => d.key === docType)?.accept}
              onChange={onFile}
              disabled={busy || documentsLocked}
            />
          </label>
          <p className="mt-2 text-xs text-ink-subtle">
            Stored privately. Only you and recruiters you apply to (via a short-lived link) can open
            your files.
          </p>
          {error ? (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={embedded ? "" : "card p-5"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {!fixedDocType ? (
              <Field label="Document type" htmlFor="doctype">
                <Select
                  id="doctype"
                  value={docType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  className="sm:w-64"
                >
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              {progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {busy ? "Uploading…" : fixedDocType === "cv" ? "Upload CV / resume" : "Upload file"}
              <input
                type="file"
                className="hidden"
                accept={DOCUMENT_TYPES.find((d) => d.key === docType)?.accept}
                onChange={onFile}
                disabled={busy || documentsLocked}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            Stored privately. Only you and recruiters you apply to (via a short-lived link) can open
            your files.
          </p>
          {error ? (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
        </div>
      )}

      {documents.length === 0 ? (
        profileCvDropzone ? null : (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title={fixedDocType === "cv" ? "No CV uploaded yet" : "No documents yet"}
            description="Upload your CV to apply faster."
          />
        )
      ) : (
        <div className={embedded ? "rounded-lg border border-surface-border" : "card"}>
          <ul className="divide-y divide-surface-border">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {d.title ?? d.object_path.split("/").pop()}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {titleCase(d.doc_type)} · {formatDate(d.created_at)}
                    </p>
                  </div>
                  {d.is_primary ? <Badge tone="success">Primary CV</Badge> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => view(d)}>
                    View
                  </Button>
                  {d.doc_type === "cv" && !d.is_primary ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPrimary(d)}
                      disabled={pending}
                    >
                      <Star className="h-4 w-4" /> Set primary
                    </Button>
                  ) : null}
                  <button
                    onClick={() => archive(d)}
                    disabled={pending}
                    aria-label="Archive"
                    className="rounded-md p-1.5 text-ink-subtle hover:bg-red-50 hover:text-status-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
