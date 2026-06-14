import type { BridgeErrorCode } from "../bridge-error-code.js";
import { BRIDGE_ERROR_COPY } from "../bridge-error-code.js";

// ── LoadingState ──────────────────────────────────────────────────────────────

export function LoadingState({ label }: { label: string }): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 py-8 px-4 text-text-muted text-sm"
      aria-busy="true"
      aria-label={label}
    >
      {/* Minimal animated dot indicator — respects prefers-reduced-motion via tokens.css */}
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

// ── ErrorState ────────────────────────────────────────────────────────────────
// role="alert" ensures screen readers announce bridge errors immediately.
// Focus is moved to this element by the parent on render (see usages).

export type BridgeError = {
  error: string;
  code: BridgeErrorCode;
  details?: unknown;
};

type ErrorStateProps = {
  error: BridgeError | string;
  onRetry?: () => void;
};

export function ErrorState({ error, onRetry }: ErrorStateProps): JSX.Element {
  const isStructured = typeof error === "object";
  const code = isStructured ? error.code : undefined;
  const message = isStructured ? (BRIDGE_ERROR_COPY[error.code] ?? error.error) : error;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-4 my-4 p-4 rounded-md border border-danger/30 bg-danger/5"
    >
      <p className="text-sm text-danger">{message}</p>
      {code && (
        <p className="mt-1 text-xs text-text-muted">
          code: <span className="font-medium">{code}</span>
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3 py-8 px-4">
      <p className="text-sm text-text-secondary">{title}</p>
      {description && <p className="text-xs text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
