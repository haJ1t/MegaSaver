import type { TokenSaverSettings } from "@megasaver/core";

type SavingsBadgeProps = {
  tokenSaver?: TokenSaverSettings | undefined;
  savingRatio?: number | undefined;
};

const BASE = "inline-block px-2 py-0.5 text-xs font-medium rounded-sm tracking-wide leading-none";

export function SavingsBadge({ tokenSaver, savingRatio }: SavingsBadgeProps): JSX.Element | null {
  if (tokenSaver?.enabled !== true) {
    return null;
  }
  const label = savingRatio === undefined ? "on" : `${Math.round(savingRatio * 100)}% saved`;
  return (
    <span className={`${BASE} badge-status-open`} aria-label="Mega Saver Mode active">
      {label}
    </span>
  );
}
