import { useCallback, useEffect, useState } from "react";
import {
  type ThemeChoice,
  applyTheme,
  nextTheme,
  prefersDarkNow,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  subscribePrefersDark,
} from "../lib/theme.js";

export function ThemeToggle(): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : ({ getItem: () => null } as unknown as Storage);
    return readStoredTheme(storage);
  });
  const [prefersDark, setPrefersDark] = useState(prefersDarkNow);

  useEffect(() => {
    applyTheme(document.documentElement, choice);
  }, [choice]);

  // Keep following the OS while the choice is `system`.
  useEffect(() => subscribePrefersDark(setPrefersDark), []);

  const resolved = resolveTheme(choice, prefersDark);
  const target = resolved === "dark" ? "light" : "dark";

  const flip = useCallback(() => {
    setChoice((current) => {
      const next = nextTheme(current, prefersDark);
      if (typeof localStorage !== "undefined") storeTheme(localStorage, next);
      return next;
    });
  }, [prefersDark]);

  return (
    <button
      type="button"
      onClick={flip}
      title={`Switch to ${target} theme`}
      aria-label={`Switch to ${target} theme`}
      className="ml-auto grid place-items-center w-[26px] h-[26px] rounded-md border border-border bg-transparent text-text-secondary text-xs cursor-pointer hover:bg-surface-elevated"
    >
      <span aria-hidden="true">{resolved === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
