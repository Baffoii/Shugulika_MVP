"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui/primitives";

interface CheckResult {
  label: string;
  ready: boolean;
  detail: string;
}

export function DeviceCheck() {
  const [results, setResults] = useState<CheckResult[] | null>(null);

  function runCheck() {
    const mediaDevices = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    const mediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;
    const secureContext = typeof window !== "undefined" && window.isSecureContext;
    setResults([
      {
        label: "Secure browser connection",
        ready: secureContext,
        detail: secureContext
          ? "The browser can safely request device permissions."
          : "Open Shugulika over HTTPS before an interview.",
      },
      {
        label: "Camera and microphone access",
        ready: mediaDevices,
        detail: mediaDevices
          ? "Your browser supports camera and microphone permission prompts."
          : "Use a recent Chrome, Edge, or Firefox browser on a laptop or desktop.",
      },
      {
        label: "Interview recording support",
        ready: mediaRecorder,
        detail: mediaRecorder
          ? "Your browser supports local interview recording."
          : "This browser cannot record the required interview format.",
      },
    ]);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        This check reads browser capabilities only. It does not record or upload anything.
      </p>
      <Button onClick={runCheck} variant="secondary">
        Run device check
      </Button>
      {results ? (
        <ul className="space-y-2" aria-live="polite">
          {results.map((result) => (
            <li key={result.label}>
              <Alert tone={result.ready ? "success" : "warn"} title={result.label}>
                {result.detail}
              </Alert>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
