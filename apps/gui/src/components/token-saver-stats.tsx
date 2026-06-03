import type { SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import { SavingsChart } from "./savings-chart.js";

type TokenSaverStatsProps = {
  stats: SessionTokenSaverStats | null;
  events: TokenSaverEvent[];
};

function StatField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted uppercase tracking-widest">{label}</dt>
      <dd className="text-sm text-text-primary tabular-nums">{value}</dd>
    </div>
  );
}

export function TokenSaverStats({ stats, events }: TokenSaverStatsProps): JSX.Element {
  if (stats === null) {
    return <p className="text-sm text-text-muted">No activity yet.</p>;
  }
  const savingPct = `${Math.round(stats.savingRatio * 100)}%`;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
        <StatField label="Events" value={String(stats.eventsTotal)} />
        <StatField label="Saved" value={savingPct} />
        <StatField label="Bytes saved" value={String(stats.bytesSavedTotal)} />
        <StatField label="Secrets redacted" value={String(stats.secretsRedactedTotal)} />
        <StatField label="Chunks stored" value={String(stats.chunksStoredTotal)} />
      </dl>
      <SavingsChart events={events} />
    </div>
  );
}
