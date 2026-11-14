import React, { useEffect, useRef, useState } from "react";
import type { GenerationJob, JobLifecycleState } from "../../shared/types";

/**
 * Screen-reader-only live region for generation lifecycle changes.
 *
 * Announces only transitions a person cares about (started, finished,
 * failed, cancelled) — never per-step progress, which would be noise.
 * Submission is already announced by the "queued" toast.
 */
const ANNOUNCED: ReadonlySet<JobLifecycleState> = new Set([
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const shortPrompt = (prompt: string): string => {
  const clean = prompt.trim().replace(/\s+/g, " ");
  if (!clean) return "untitled render";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
};

const describe = (job: GenerationJob): string => {
  const subject = shortPrompt(job.prompt);
  switch (job.status) {
    case "RUNNING":
      return `Generating: ${subject}`;
    case "COMPLETED": {
      const count = job.outputPaths.length;
      return count > 0
        ? `Generation complete, ${count} ${count === 1 ? "image" : "images"} saved to the library.`
        : "Generation complete.";
    }
    case "FAILED":
      return `Generation failed${job.errorMessage ? `: ${job.errorMessage}` : "."}`;
    case "CANCELLED":
      return "Generation cancelled.";
    default:
      return "";
  }
};

export const JobStatusAnnouncer: React.FC<{ jobs: GenerationJob[] }> = ({ jobs }) => {
  const seen = useRef<Map<string, JobLifecycleState>>(new Map());
  const [message, setMessage] = useState({ text: "", tick: 0 });

  useEffect(() => {
    let latest: string | null = null;
    for (const job of jobs) {
      const previous = seen.current.get(job.id);
      seen.current.set(job.id, job.status);
      // Jobs that arrive already finished (history loaded at startup) stay silent.
      if (previous === undefined && job.status !== "RUNNING") continue;
      if (previous === job.status) continue;
      if (!ANNOUNCED.has(job.status)) continue;
      latest = describe(job);
    }
    if (latest) {
      setMessage((prev) => ({ text: latest as string, tick: prev.tick + 1 }));
    }
  }, [jobs]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {/* The alternating no-break space makes repeated identical messages re-announce. */}
      {message.text}
      {message.tick % 2 === 1 ? "\u00a0" : ""}
    </div>
  );
};
