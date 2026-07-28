import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_MS = 2600;

export type ToastApi = {
  message: string;
  say: (message: string) => void;
};

export function useToast(): ToastApi {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = useCallback((next: string) => {
    clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(""), DISMISS_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, say };
}

export function Toast({ message }: { message: string }): JSX.Element {
  // <output> carries an implicit role=status (aria-live=polite), which is what
  // biome a11y/useSemanticElements wants instead of <div role="status">.
  // It stays mounted and empty rather than unmounting: inserting a live region
  // and its text in the same tick goes unannounced by several screen readers.
  return (
    <output
      className={
        message
          ? "fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5 px-5 py-3 rounded-lg border border-border bg-surface shadow-md text-sm pop-in"
          : "sr-only"
      }
    >
      {message ? (
        <>
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-ok" />
          {message}
        </>
      ) : null}
    </output>
  );
}
