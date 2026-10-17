"use client";

import { useEffect } from "react";
import { Panel } from "@/components/ui";

/**
 * Error boundary for every signed-in module.
 *
 * It never shows raw database text to the user; the digest is surfaced so the exact
 * failure can be matched to the server log, and retry() re-runs the failed segment
 * without a full reload.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("LEVI OS module error:", error);
  }, [error]);

  return (
    <Panel>
      <div className="stack-sm">
        <p className="eyebrow">Something broke</p>
        <h1>This screen could not load</h1>
        <p className="muted">
          Nothing you saved was lost. The page failed while reading or rendering your data, so it can simply be
          retried.
        </p>
        <div className="row">
          <button className="button" type="button" onClick={() => retry()}>
            Try again
          </button>
          <a className="button secondary" href="/dashboard">
            Back to command center
          </a>
        </div>
        {error.digest ? <p className="faint">Reference: {error.digest}</p> : null}
      </div>
    </Panel>
  );
}
