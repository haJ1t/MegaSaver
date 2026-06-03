import type { TokenSaverEvent } from "@megasaver/stats";

type SavingsChartProps = {
  events: TokenSaverEvent[];
};

// Hand-rolled inline-SVG bar chart of per-event savingRatio — no charting
// dependency (epic constraint). Decorative-with-label: the wrapper carries
// role=img + an aria-label summarising the trend; the SVG is aria-hidden and
// not keyboard-interactive.
const VIEW_W = 240;
const VIEW_H = 48;
const GAP = 2;

export function SavingsChart({ events }: SavingsChartProps): JSX.Element {
  if (events.length === 0) {
    return <p className="text-xs text-text-muted">No savings data yet.</p>;
  }

  // Panel passes events newest-first; render oldest→newest so the trend reads
  // left-to-right. Copy before sorting so we never mutate the caller's array.
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const count = ordered.length;
  const avgPct = Math.round((ordered.reduce((sum, e) => sum + e.savingRatio, 0) / count) * 100);
  const noun = count === 1 ? "event" : "events";
  const label = `Savings trend: ${count} ${noun}, avg ${avgPct}%`;

  const slot = VIEW_W / count;
  const barW = Math.max(slot - GAP, 1);

  return (
    <div role="img" aria-label={label} className="text-accent">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="block h-12 w-full"
        aria-hidden="true"
      >
        {ordered.map((event, i) => {
          // savingRatio is 0..1; a full bar means 100% saved.
          const h = Math.max(event.savingRatio * VIEW_H, 1);
          return (
            <rect
              key={event.id}
              data-bar=""
              x={i * slot}
              y={VIEW_H - h}
              width={barW}
              height={h}
              fill="currentColor"
              opacity={0.85}
            />
          );
        })}
      </svg>
    </div>
  );
}
