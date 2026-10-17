"use client";

import { useActionState, useId } from "react";
import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";

export type ServerAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * Wraps a form around a server action and renders its outcome.
 *
 * Accessibility notes: the submit button reflects the pending state, success and error
 * messages are announced with `role="status"` / `role="alert"`, and every field keeps a
 * real `<label>` — the action's message never replaces the form.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitClassName = "button",
  pendingLabel = "Saving…",
  hidden,
  resetOnSuccess = true,
  className,
  disabled,
  ariaLabel,
  title,
}: {
  action: ServerAction;
  children: ReactNode;
  submitLabel: string;
  submitClassName?: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  resetOnSuccess?: boolean;
  className?: string;
  /** Renders the submit button as unavailable (e.g. a move that cannot happen). */
  disabled?: boolean;
  /** Accessible name for a button whose visible text is a glyph. */
  ariaLabel?: string;
  title?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const statusId = useId();

  return (
    <form
      action={formAction}
      className={className}
      // Remounting on success clears the inputs so the same entry is not submitted twice.
      key={resetOnSuccess && state?.ok ? (state.message ?? "ok") : "form"}
    >
      <div className="stack-sm">
        {hidden
          ? Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))
          : null}
        {children}
        <div className="row">
          <button
            className={submitClassName}
            type="submit"
            disabled={pending || disabled}
            aria-label={ariaLabel}
            title={title}
            aria-describedby={statusId}
          >
            {pending ? pendingLabel : submitLabel}
          </button>
        </div>
        <div id={statusId}>
          {state && !state.ok && state.error ? (
            <p className="notice error" role="alert">
              {state.error}
            </p>
          ) : null}
          {state?.ok && state.message ? (
            <p className="notice success" role="status">
              {state.message}
              {state.unlocked && state.unlocked.length > 0
                ? ` Achievement unlocked: ${state.unlocked.join(", ")}.`
                : ""}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** A plain icon-button form for one-shot mutations (complete, skip, delete…). */
export function ActionButton({
  action,
  label,
  fields,
  variant = "secondary",
  confirm,
  pendingLabel,
  disabled,
  ariaLabel,
  title,
}: {
  action: ServerAction;
  label: string;
  fields: Record<string, string>;
  variant?: "secondary" | "danger" | "ghost";
  confirm?: string;
  pendingLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={label}
      submitClassName={`button ${variant} tiny`}
      pendingLabel={pendingLabel ?? label}
      hidden={fields}
      resetOnSuccess={false}
      disabled={disabled}
      ariaLabel={ariaLabel}
      title={title}
    >
      {confirm ? <input type="hidden" name="confirm" value="yes" /> : null}
    </ActionForm>
  );
}
