// Single-family 16px stroke icon set (spec section 4b). Every icon shares
// one language: 16x16 viewBox, 1.5px stroke, round caps/joins, currentColor
// so active/passive tint keeps working through the parent's text color.
// Unicode glyphs and emoji are never icons; when no icon fits, text stands
// alone with no placeholder glyph.

export const ICON_NAMES = [
  "overview",
  "sessions",
  "token-saver",
  "memory",
  "workspace",
  "planner",
  "agent-office",
  "agent-setup",
  "chevron-down",
  "check",
  "warn",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, React.ReactNode> = {
  // Four-diamond spark: at-a-glance status.
  overview: <path d="M8 2l1.8 4.2L14 8l-4.2 1.8L8 14l-1.8-4.2L2 8l4.2-1.8z" />,
  // Stacked session rows.
  sessions: (
    <>
      <path d="M2.5 4h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 12h7" />
    </>
  ),
  // Falling bolt: spend dropping.
  "token-saver": <path d="M8.8 1.8L3.5 9h3.7l-.9 5.2L11.6 7H7.9z" />,
  // Orbital memory node.
  memory: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <ellipse cx="8" cy="8" rx="5.8" ry="2.4" transform="rotate(-24 8 8)" />
    </>
  ),
  // Windowed workspace grid.
  workspace: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 6h11" />
      <path d="M6 6v7.5" />
    </>
  ),
  // Planner board with a placed card.
  planner: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 6.5h5" />
      <path d="M5.5 9.5h3" />
    </>
  ),
  // Hex cell: one agent on the floor.
  "agent-office": <path d="M8 1.8l4.9 2.8v5.8L8 13.2l-4.9-2.8V4.6z" />,
  // Setup gear, drawn minimal.
  "agent-setup": (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </>
  ),
  // Disclosure chevron.
  "chevron-down": <path d="M4 6l4 4 4-4" />,
  // Task check.
  check: <path d="M3 8.5l3.2 3.2L13 5" />,
  // Warning triangle with a stem.
  warn: (
    <>
      <path d="M8 2.2L14 13H2z" />
      <path d="M8 6.5v3.2" />
      <path d="M8 11.6v.1" />
    </>
  ),
};

export function Icon({
  name,
  className,
  label,
}: {
  name: IconName;
  className?: string;
  label?: string;
}): JSX.Element {
  const labelled = label !== undefined;
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={labelled ? undefined : "true"}
      aria-label={labelled ? label : undefined}
      role={labelled ? "img" : undefined}
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
