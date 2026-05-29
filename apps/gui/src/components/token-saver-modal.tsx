import type { TokenSaverMode } from "@megasaver/shared";
import { useEffect, useId, useRef, useState } from "react";
import type { EnableTokenSaverBody } from "../lib/api-client.js";

type TokenSaverModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (body: EnableTokenSaverBody) => void;
};

const MODES: TokenSaverMode[] = ["safe", "balanced", "aggressive"];

const CHECKBOX_FIELDS = [
  { key: "storeRawOutput", label: "Store raw output" },
  { key: "redactSecrets", label: "Redact secrets" },
  { key: "autoRepair", label: "Auto-repair connector config" },
] as const;

export function TokenSaverModal({
  open,
  onClose,
  onConfirm,
}: TokenSaverModalProps): JSX.Element | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<TokenSaverMode>("balanced");
  const [maxReturnedBytes, setMaxReturnedBytes] = useState(12_000);
  const [storeRawOutput, setStoreRawOutput] = useState(true);
  const [redactSecrets, setRedactSecrets] = useState(true);
  const [autoRepair, setAutoRepair] = useState(true);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, [open]);

  if (!open) return null;

  const flags = { storeRawOutput, redactSecrets, autoRepair };
  const setFlag: Record<(typeof CHECKBOX_FIELDS)[number]["key"], (v: boolean) => void> = {
    storeRawOutput: setStoreRawOutput,
    redactSecrets: setRedactSecrets,
    autoRepair: setAutoRepair,
  };

  function confirm(): void {
    onConfirm({ mode, maxReturnedBytes, storeRawOutput, redactSecrets, autoRepair });
  }

  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else trapFocus(e);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <h2 id={titleId} className="mb-4 text-base font-medium text-text-primary">
          Enable Mega Saver Mode
        </h2>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-text-secondary">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as TokenSaverMode)}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-primary"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-text-secondary">
            Max returned bytes
            <input
              type="number"
              min={1}
              value={maxReturnedBytes}
              onChange={(e) => setMaxReturnedBytes(Number(e.target.value))}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-primary tabular-nums"
            />
          </label>

          {CHECKBOX_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={flags[field.key]}
                onChange={(e) => setFlag[field.key](e.target.checked)}
              />
              {field.label}
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md bg-accent px-4 py-1.5 text-sm text-accent-fg cursor-pointer hover:opacity-90 transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}
