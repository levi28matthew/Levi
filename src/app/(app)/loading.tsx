import { Panel } from "@/components/ui";

/**
 * Route-level fallback. It intentionally mirrors the panel shape of the real pages so
 * the layout does not jump when data arrives.
 */
export default function AppLoading() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your data…</span>
      <div className="stack-sm">
        <span className="skeleton" style={{ width: "5rem", height: "0.7rem" }} />
        <span className="skeleton" style={{ width: "18rem", height: "1.6rem" }} />
      </div>
      <div className="grid">
        {[0, 1, 2, 3].map((key) => (
          <Panel key={key}>
            <div className="stack-sm">
              <span className="skeleton" style={{ width: "40%" }} />
              <span className="skeleton" style={{ width: "65%", height: "1.6rem" }} />
              <span className="skeleton" style={{ width: "100%" }} />
            </div>
          </Panel>
        ))}
      </div>
      <Panel>
        <div className="stack-sm">
          <span className="skeleton" style={{ width: "30%" }} />
          <span className="skeleton" style={{ width: "100%" }} />
          <span className="skeleton" style={{ width: "90%" }} />
        </div>
      </Panel>
    </div>
  );
}
