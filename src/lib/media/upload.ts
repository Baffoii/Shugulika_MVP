/**
 * Secure recording upload (client-only). The attempt row (with its
 * server-generated private storage path) is created by a server action first;
 * this uploads the local Blob to that exact path with real progress events.
 *
 * Flow: createSignedUploadUrl under the candidate's own JWT (storage RLS
 * INSERT policy authorizes the path) → XHR PUT (progress) → server action
 * verifies and marks the attempt uploaded. While the Blob is still in memory
 * a failed upload can be retried without re-recording.
 */
import { createClient } from "@/lib/supabase/client";
import { INTERVIEW_LIMITS } from "@/lib/constants";

export interface UploadParams {
  bucket: string;
  path: string;
  blob: Blob;
  onProgress?: (fraction: number) => void;
  /** Abort hook: assign to cancel an in-flight upload. */
  signal?: AbortSignal;
}

export class UploadError extends Error {
  retriable: boolean;
  constructor(message: string, retriable = true) {
    super(message);
    this.retriable = retriable;
  }
}

/** Upload the blob; resolves only after Supabase Storage confirms success. */
export async function uploadRecording({
  bucket,
  path,
  blob,
  onProgress,
  signal,
}: UploadParams): Promise<void> {
  if (blob.size === 0) throw new UploadError("The recording is empty.", false);
  if (blob.size > INTERVIEW_LIMITS.maxUploadBytes) {
    throw new UploadError("The recording is too large to upload.", false);
  }

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new UploadError(error?.message ?? "Could not authorize the upload.");
  }

  await putWithProgress(data.signedUrl, blob, onProgress, signal);
}

function putWithProgress(
  url: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    // A retry may follow "Storage succeeded, DB confirmation failed". Reusing
    // the same server-generated path replaces that object instead of creating
    // a duplicate.
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(
          new UploadError(
            `Upload failed (${xhr.status}). Check your connection and try again.`,
            xhr.status !== 400 && xhr.status !== 413,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new UploadError("Network error during upload. Check your connection and retry."));
    xhr.onabort = () => reject(new UploadError("Upload cancelled."));
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}
