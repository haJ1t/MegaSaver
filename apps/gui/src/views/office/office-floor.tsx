import type { OfficeStatusEntry } from "../../lib/office-client.js";

// One floor, ten desks — the capacity the console design draws. Multi-floor is
// deliberately not built: OfficeAgent carries no floor field, so extra floors
// would be frontend-only fiction (see spec 2026-07-28 §4).
const DESKS_PER_FLOOR = 10;

// Deterministic per-seat variation. Index-keyed rather than random so a desk
// keeps its look across re-renders and polls.
const SKIN = ["#e2b892", "#c8905f", "#8d6a4e", "#f0d0ae", "#b57f55", "#e8c6a4"] as const;
const HAIR = ["#3b3128", "#6b4a2f", "#1f1a16", "#8a6f4e", "#2b2b33", "#54402c"] as const;

function shirtColor(status: string): string {
  if (status === "working") return "var(--color-ok)";
  if (status === "paused") return "var(--color-warn)";
  if (status === "error") return "var(--color-danger)";
  return "var(--color-text-muted)";
}

function bubbleText(entry: OfficeStatusEntry): string {
  const { agent, currentTask } = entry;
  if (agent.status === "paused") return "Paused";
  if (agent.status === "error") return "Needs attention";
  if (currentTask?.instruction) {
    const t = currentTask.instruction;
    return t.length > 24 ? `${t.slice(0, 23)}…` : t;
  }
  return "Waiting for work";
}

function Desk({
  entry,
  seat,
  selected,
  onSelect,
}: {
  entry: OfficeStatusEntry | null;
  seat: number;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const working = entry?.agent.status === "working";
  const skin = SKIN[seat % SKIN.length];
  const hair = HAIR[seat % HAIR.length];
  const shirt = entry ? shirtColor(entry.agent.status) : "transparent";
  const dim = entry?.agent.status === "paused" ? 0.66 : entry ? 1 : 0.85;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={entry ? `${entry.agent.name} · ${entry.agent.status}` : "Free desk"}
      aria-label={entry ? `${entry.agent.name}, ${entry.agent.status}` : `Free desk ${seat + 1}`}
      aria-pressed={selected}
      className="flex flex-col items-center gap-1 w-full min-w-[116px] max-w-[210px] justify-self-center self-end p-0 border-0 bg-transparent cursor-pointer"
      style={{ opacity: dim }}
    >
      <span className="relative block w-full h-[140px]">
        {selected ? (
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 bottom-1.5 w-4/5 h-4 rounded-full bg-accent opacity-15"
          />
        ) : null}

        {entry ? (
          <>
            {/* speech bubble */}
            <span className="absolute left-1/2 -translate-x-1/2 top-0 z-[6] flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full border border-border bg-surface shadow-md text-2xs text-text-secondary whitespace-nowrap">
              <span className="overflow-hidden text-ellipsis">{bubbleText(entry)}</span>
              {working ? (
                <span aria-hidden="true" className="inline-flex gap-0.5 shrink-0">
                  <span className="w-[3px] h-[3px] rounded-full bg-accent desk-dots" />
                  <span className="w-[3px] h-[3px] rounded-full bg-accent desk-dots [animation-delay:.2s]" />
                  <span className="w-[3px] h-[3px] rounded-full bg-accent desk-dots [animation-delay:.4s]" />
                </span>
              ) : null}
            </span>

            {/* chair */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 -translate-x-1/2 bottom-8 w-11 h-9 rounded-t-2xl bg-border z-[1]"
            />

            {/* person */}
            <span
              aria-hidden="true"
              className={`absolute left-1/2 -translate-x-1/2 bottom-9 z-[2] flex flex-col items-center ${working ? "desk-bob" : ""}`}
            >
              <span
                className="relative w-[21px] h-[21px] rounded-full"
                style={{ background: skin }}
              >
                <span
                  className="absolute -left-px -top-[3px] w-[23px] h-2.5 rounded-t-xl"
                  style={{ background: hair }}
                />
                <span className="absolute left-[5px] top-[11px] w-0.5 h-0.5 rounded-full bg-[#2a2724]" />
                <span className="absolute right-[5px] top-[11px] w-0.5 h-0.5 rounded-full bg-[#2a2724]" />
              </span>
              <span
                className="relative w-9 h-6 -mt-0.5 rounded-t-xl rounded-b-sm"
                style={{ background: shirt }}
              >
                <span
                  className={`absolute -left-[7px] top-[5px] w-[9px] h-4 rounded-sm origin-top ${working ? "desk-type-left" : ""}`}
                  style={{ background: shirt }}
                />
                <span
                  className={`absolute -right-[7px] top-[5px] w-[9px] h-4 rounded-sm origin-top ${working ? "desk-type-right" : ""}`}
                  style={{ background: shirt }}
                />
              </span>
            </span>
          </>
        ) : (
          <span className="absolute left-1/2 -translate-x-1/2 bottom-[50px] flex flex-col items-center gap-1.5">
            <span className="text-2xs text-text-muted">free desk</span>
            <span
              aria-hidden="true"
              className="grid place-items-center w-[30px] h-[30px] rounded-full border border-dashed border-border text-text-muted"
            >
              +
            </span>
          </span>
        )}

        {/* desk surface + props */}
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-3 h-8 rounded-sm border z-[3]"
          style={{
            borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
            background: selected ? "var(--color-accent-soft)" : "var(--color-surface-elevated)",
          }}
        />
        {/* Left-offset, NOT centred: the monitor sits at z-4 and the seated
            figure at z-2, so centring it hides the occupant entirely. */}
        <span
          aria-hidden="true"
          className="absolute left-2 bottom-[50px] box-border w-12 h-8 rounded-sm bg-[#24262d] z-[4] px-1.5 py-1 flex flex-col gap-[3px]"
        >
          <span
            className={`w-[72%] h-[3px] rounded-sm ${working ? "desk-screen-glow" : ""}`}
            style={{ background: working ? "var(--color-accent)" : "var(--color-border)" }}
          />
          <span className="w-[44%] h-[3px] rounded-sm bg-[#6e737d]" />
          <span className="w-[60%] h-[3px] rounded-sm bg-[#4d525b]" />
        </span>
        <span
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2 bottom-[18px] w-9 h-2 rounded-sm bg-border z-[4] opacity-70"
        />
        <span
          aria-hidden="true"
          className="absolute right-3 bottom-5 w-[9px] h-[11px] rounded-b-sm bg-accent opacity-75 z-[4]"
        />
      </span>
      <span
        className={`font-mono text-2xs max-w-full truncate ${selected ? "text-accent" : "text-text-muted"}`}
      >
        {entry ? entry.agent.name : `desk ${seat + 1}`}
      </span>
    </button>
  );
}

export function OfficeFloor({
  entries,
  selectedId,
  onSelect,
  onHire,
}: {
  entries: OfficeStatusEntry[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  onHire: () => void;
}): JSX.Element {
  const occupied = entries.slice(0, DESKS_PER_FLOOR);
  const hasFreeDesk = occupied.length < DESKS_PER_FLOOR;
  const seats = occupied.length + (hasFreeDesk ? 1 : 0);
  const working = entries.filter((e) => e.agent.status === "working").length;
  const paused = entries.filter((e) => e.agent.status === "paused").length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full bg-ok" />
          {working} working
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full bg-warn" />
          {paused} paused
        </span>
        <span className="ml-auto font-mono text-text-muted">
          {occupied.length} of {DESKS_PER_FLOOR} desks taken
        </span>
      </div>

      {/* Never hide agents silently: the floor seats ten, so anything beyond
          that is called out and stays reachable in the list view. */}
      {entries.length > DESKS_PER_FLOOR ? (
        <p className="m-0 text-xs text-warn">
          {entries.length - DESKS_PER_FLOOR} more agent
          {entries.length - DESKS_PER_FLOOR === 1 ? "" : "s"} not shown — this floor seats{" "}
          {DESKS_PER_FLOOR}. Switch to List to see all of them.
        </p>
      ) : null}

      <div
        className="rounded-xl border border-border overflow-x-auto"
        style={{
          backgroundColor: "var(--color-background)",
          backgroundImage:
            "repeating-linear-gradient(0deg,var(--color-line-soft) 0 1px,transparent 1px 52px),repeating-linear-gradient(90deg,var(--color-line-soft) 0 1px,transparent 1px 52px)",
        }}
      >
        <div className="grid grid-cols-5 gap-x-4 gap-y-3 items-end p-7 min-w-[860px]">
          {Array.from({ length: seats }, (_, seat) => {
            const entry = occupied[seat] ?? null;
            return (
              <Desk
                key={entry ? entry.agent.id : `free-${seat}`}
                entry={entry}
                seat={seat}
                selected={entry !== null && entry.agent.id === selectedId}
                onSelect={() => (entry ? onSelect(entry.agent.id) : onHire())}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
