"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/interview-analytics";
import { cn } from "@/lib/cn";

/**
 * Playback for interview recordings. Uses the known wall-clock duration so a
 * missing/incorrect WebM Duration field cannot show a multi-minute timeline
 * for a short answer, and forces playback to start at 0:00.
 */
export function RecordingPlayback({
  src,
  durationSeconds,
  className,
  "aria-label": ariaLabel = "Recorded response preview",
}: {
  src: string;
  durationSeconds: number;
  className?: string;
  "aria-label"?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState(0);
  const knownDuration = Math.max(0, durationSeconds);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      try {
        video.currentTime = 0;
      } catch {
        // Some engines throw if seek is not yet allowed; ignore.
      }
      setCurrent(0);
    };
    const onTime = () => {
      const t = video.currentTime || 0;
      // Clamp UI time to known duration if the container metadata is wrong.
      setCurrent(knownDuration > 0 ? Math.min(t, knownDuration) : t);
      if (knownDuration > 0 && t > knownDuration + 0.25) {
        video.pause();
        video.currentTime = 0;
      }
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    onLoaded();
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [src, knownDuration]);

  return (
    <div className={cn("relative aspect-video w-full bg-black", className)}>
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        aria-label={ariaLabel}
      />
      <p className="pointer-events-none absolute bottom-10 left-3 z-10 rounded bg-black/70 px-2 py-0.5 text-xs tabular-nums text-white">
        {formatClock(current)} / {formatClock(knownDuration)}
      </p>
    </div>
  );
}
