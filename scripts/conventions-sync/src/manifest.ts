// Order: launch order (mode is enum-canonical for --help text).
// Do not reorder; pinned by manifest.test-d.ts.
export const MODES = ["check", "write", "list"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

export type BlockSpec = {
  readonly id: string;
  readonly source: string;
  readonly fragment?: string;
};

export type ConsumerSpec = {
  readonly id: string;
  readonly path: string;
  readonly blocks: readonly BlockSpec[];
};

// Order: claude-md first (canonical full reference), then AGENTS.md,
// then .cursor/rules/*.mdc. Matches the connector KNOWN_TARGETS
// launch-order precedent (claude-code leads). Pinned by
// manifest.test-d.ts. Do not reorder.
export const CONSUMERS = [
  {
    id: "claude-md",
    path: "CLAUDE.md",
    blocks: [
      { id: "wiki-first", source: "wiki-first.md" },
      { id: "mission", source: "mission.md" },
      { id: "repo-layout", source: "repo-layout.md" },
      { id: "stack-and-commands", source: "stack-and-commands.md" },
      { id: "process-discipline", source: "process-discipline.md" },
      { id: "skill-routing", source: "skill-routing.md" },
      { id: "agent-routing", source: "agent-routing.md" },
      { id: "multi-agent-dogfood", source: "multi-agent-dogfood.md" },
      { id: "code-conventions", source: "code-conventions.md" },
      { id: "definition-of-done", source: "definition-of-done.md" },
      { id: "git-and-commits", source: "git-and-commits.md" },
      { id: "language", source: "language.md" },
      { id: "risk-modes", source: "risk-modes.md" },
      { id: "anti-patterns", source: "anti-patterns.md" },
    ],
  },
  {
    id: "agents-md",
    path: "AGENTS.md",
    blocks: [
      { id: "mission", source: "mission.md" },
      { id: "stack-and-commands", source: "stack-and-commands.md" },
      { id: "process-discipline", source: "process-discipline.md" },
      { id: "code-conventions", source: "code-conventions.md" },
      { id: "git-and-commits", source: "git-and-commits.md" },
      { id: "risk-modes", source: "risk-modes.md" },
      { id: "multi-agent-dogfood", source: "multi-agent-dogfood.md" },
      { id: "anti-patterns", source: "anti-patterns.md" },
    ],
  },
  {
    id: "cursor-context",
    path: ".cursor/rules/mega-context.mdc",
    blocks: [
      { id: "mission", source: "mission.md" },
      { id: "repo-layout", source: "repo-layout.md" },
      { id: "stack-and-commands", source: "stack-and-commands.md" },
      { id: "multi-agent-dogfood", source: "multi-agent-dogfood.md" },
    ],
  },
  {
    id: "cursor-conventions",
    path: ".cursor/rules/mega-conventions.mdc",
    blocks: [
      { id: "code-conventions", source: "code-conventions.md" },
      { id: "language", source: "language.md" },
      { id: "git-and-commits", source: "git-and-commits.md" },
      { id: "anti-patterns", source: "anti-patterns.md" },
    ],
  },
  {
    id: "cursor-discipline",
    path: ".cursor/rules/mega-discipline.mdc",
    blocks: [
      { id: "process-discipline", source: "process-discipline.md" },
      { id: "definition-of-done", source: "definition-of-done.md" },
      { id: "risk-modes", source: "risk-modes.md" },
      { id: "skill-routing", source: "skill-routing.md" },
    ],
  },
] as const satisfies readonly ConsumerSpec[];

export type ConsumerId = (typeof CONSUMERS)[number]["id"];

export const CONSUMER_IDS: readonly string[] = CONSUMERS.map((c) => c.id);

export function isConsumerId(value: string): value is ConsumerId {
  return (CONSUMER_IDS as readonly string[]).includes(value);
}
