import type { ReactNode } from "react";

/**
 * Small, presentation-only building blocks shared by every module.
 * Business rules deliberately do not live here.
 */

export function Panel({
  children,
  as: Tag = "section",
  className = "",
}: {
  children: ReactNode;
  as?: "section" | "div" | "article";
  className?: string;
}) {
  return <Tag className={`panel ${className}`.trim()}>{children}</Tag>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="editorial row-between">
      <div className="stack-sm">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function StatTile({
  label,
  value,
  hint,
  progress,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** 0–100; renders a progress bar when provided. */
  progress?: number;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="stack-sm">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {typeof progress === "number" ? (
        <div
          className={`bar ${tone && tone !== "default" ? tone : ""}`.trim()}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      ) : null}
      {hint ? <p className="faint">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ value, label, tone }: { value: number; label: string; tone?: "success" | "warning" }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      className={`bar ${tone ?? ""}`.trim()}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone ?? ""}`.trim()}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "success" | "error";
  children: ReactNode;
}) {
  return (
    <p className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="faint">{hint}</p> : null}
    </div>
  );
}

/** Shown when the Supabase environment variables are absent, instead of crashing. */
export function ConfigurationNotice() {
  return (
    <Panel>
      <div className="stack-sm">
        <p className="eyebrow">Setup required</p>
        <h2>Supabase is not configured</h2>
        <p className="muted">
          Copy <code>.env.example</code> to <code>.env.local</code> and set
          <code> NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, then
          apply the migrations in <code>supabase/migrations</code>. The pages below render real data as soon
          as those two values are present.
        </p>
      </div>
    </Panel>
  );
}

/** Consistent signed-out state for a module page. */
export function SignedOutState({ module }: { module: string }) {
  return (
    <Panel>
      <div className="stack-sm">
        <p className="eyebrow">{module}</p>
        <h1>Sign in to continue</h1>
        <p className="muted">
          LEVI OS keeps every record private to your account, so this screen has nothing to show until you
          sign in.
        </p>
        <div className="row">
          <a className="button" href="/login">
            Sign in
          </a>
        </div>
      </div>
    </Panel>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status}>{status.replace("_", " ")}</Badge>;
}
