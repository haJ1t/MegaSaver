# GUI Minimalist Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved "Editorial Workspace" redesign to the high-clutter GUI surfaces in `apps/gui`, starting with global tokens and then the session list, cockpit shell, and token-saver panel.

**Architecture:** Token-first sweep. Update `tokens.css` and `tailwind.config.js` once, then rewrite each target component with reduced text density while keeping its public props and data flow unchanged. Each component task includes a failing test update/commit pair.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest + React Testing Library, Biome.

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/gui/src/styles/tokens.css` | CSS variables for colors, typography, badge utilities. |
| `apps/gui/tailwind.config.js` | Tailwind theme mapping to CSS variables; font/radius/shadow tokens. |
| `apps/gui/src/app.tsx` | Global shell: header, nav, view switcher. |
| `apps/gui/src/views/workspace-session-list.tsx` | Grouped, live-updated session list. |
| `apps/gui/src/cockpit/session-cockpit.tsx` | Selected-session workspace shell + tab switcher. |
| `apps/gui/src/cockpit/panel-registry.ts` | Panel definitions; needs groups for dropdown tabs. |
| `apps/gui/src/views/cockpit/token-saver-panel.tsx` | Tokens-saved display and saver controls. |
| `apps/gui/DESIGN.md` | v2 design system reference. |

---

### Task 1: Update global design tokens

**Files:**
- Modify: `apps/gui/src/styles/tokens.css`
- Modify: `apps/gui/tailwind.config.js`
- Test: `apps/gui/test/styles/tokens.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/styles/tokens.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("design tokens v2", () => {
  it("exposes warm background and surface CSS variables", () => {
    const style = getComputedStyle(document.documentElement);
    expect(style.getPropertyValue("--color-background").trim()).toBe("#F7F6F3");
    expect(style.getPropertyValue("--color-surface").trim()).toBe("#FFFFFF");
  });

  it("uses a sans-serif UI font stack", () => {
    const style = getComputedStyle(document.body);
    expect(style.fontFamily).toMatch(/SF Pro Display|Geist Sans|system-ui/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @megasaver/gui test test/styles/tokens.test.ts
```

Expected: FAIL — file does not exist and variables differ.

- [ ] **Step 3: Update tokens.css and tailwind.config.js**

`tokens.css` changes:
- Replace `:root` light-mode colors with warm monochrome values (`#F7F6F3`, `#FFFFFF`, `#111111`, `#787774`, `#EAEAEA`).
- Set `html { font-family: "SF Pro Display", "Geist Sans", system-ui, sans-serif; font-size: 14px; }`.
- Keep mono font for `code, pre, kbd`.
- Add status-pastel variables: `--status-live-bg/fd`, `--status-active-bg/fd`, `--status-warn-bg/fd`, `--status-danger-bg/fd`.
- Update dark mode to warm near-black (`#0C0D0F`, `#141519`).
- Keep badge-risk/status/scope utilities unchanged.

`tailwind.config.js` changes:
- Add `fontFamily.sans` stack.
- Update `borderRadius.lg` to `0.75rem` (12px), `md` to `0.375rem` (6px).
- Update `boxShadow.sm` to `0 2px 8px rgb(0 0 0 / 0.04)`; keep `none`; remove/replace `md` if unused.
- Add `colors` entries only if new variables are introduced; otherwise reuse existing semantic names.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @megasaver/gui test test/styles/tokens.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/styles/tokens.css apps/gui/tailwind.config.js apps/gui/test/styles/tokens.test.ts
git commit -m "feat(gui): warm-monochrome token system v2

Editorial Workspace palette, sans UI font, pastel status badges."
```

---

### Task 2: Redesign app shell

**Files:**
- Modify: `apps/gui/src/app.tsx`
- Test: `apps/gui/test/components/app.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/components/app.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.js";

afterEach(cleanup);

describe("App shell", () => {
  it("renders a centered page surface", () => {
    render(<App />);
    const main = screen.getByRole("main");
    expect(main.className).toMatch(/max-w-5xl/);
    expect(main.className).toMatch(/mx-auto/);
  });

  it("marks the active nav item with aria-current", () => {
    render(<App />);
    const active = screen.getByRole("button", { name: "Claude sessions" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toMatch(/bg-text-primary/); // solid active pill
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @megasaver/gui test test/components/app.test.tsx
```

Expected: FAIL — `main` lacks classes, active pill not styled.

- [ ] **Step 3: Implement new app shell**

Edit `apps/gui/src/app.tsx`:

```tsx
import { useState } from "react";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import type { ClaudeSessionMeta } from "./lib/claude-sessions-client.js";
import { VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentOfficeView } from "./views/agent-office-view.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

const NAV_VIEWS: readonly ViewId[] = ["claude-sessions", "agent-office", "agent-setup"];

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("claude-sessions");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);

  return (
    <div className="flex flex-col min-h-screen bg-background text-text-primary font-sans">
      <header className="pt-6 pb-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="text-base font-semibold tracking-tight select-none">Mega Saver</span>
          <nav aria-label="Main navigation" className="flex items-center gap-1">
            {NAV_VIEWS.map((id) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setView(id);
                    if (id !== "claude-sessions") setSelected(null);
                  }}
                  className={[
                    "px-3 py-1.5 text-xs rounded-md transition-colors duration-150 cursor-pointer",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                    active
                      ? "bg-text-primary text-surface font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {VIEW_LABELS[id]}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 px-6 pb-8 min-h-0">
        <div className="max-w-5xl mx-auto h-full">
          {view === "agent-setup" ? (
            <AgentSetupDoctor />
          ) : view === "agent-office" ? (
            <AgentOfficeView />
          ) : selected ? (
            <SessionCockpit
              dir={selected.dir}
              id={selected.id}
              cwd={selected.projectLabel}
              title={selected.title}
              onBack={() => setSelected(null)}
            />
          ) : (
            <WorkspaceSessionList onSelect={setSelected} />
          )}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @megasaver/gui test test/components/app.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/app.tsx apps/gui/test/components/app.test.tsx
git commit -m "feat(gui): centered Editorial Workspace shell

Max-width layout, solid active nav pill, warm background."
```

---

### Task 3: Redesign session list

**Files:**
- Modify: `apps/gui/src/views/workspace-session-list.tsx`
- Test: `apps/gui/test/components/workspace-session-list.test.tsx`

- [ ] **Step 1: Write the failing test**

Update `apps/gui/test/components/workspace-session-list.test.tsx` to assert the new simplified list:

```tsx
// Add to existing describe block after existing tests
  it("wraps groups in a rounded card on a warm background", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    const { container } = render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    const card = container.querySelector("[data-testid='session-list-card']");
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/rounded-xl/);
  });

  it("hides model and archived tags by default", async () => {
    stub.sessions = [
      meta({ id: "x", title: "X", projectLabel: "/tmp/alpha", model: "claude-sonnet-4-6", isArchived: true }),
    ];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("X")).toBeDefined());
    expect(screen.queryByText(/sonnet/)).toBeNull();
    expect(screen.queryByText("archived")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @megasaver/gui test test/components/workspace-session-list.test.tsx
```

Expected: FAIL — card and hidden tags not implemented.

- [ ] **Step 3: Implement minimal session list redesign**

Edit `apps/gui/src/views/workspace-session-list.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import { type ClaudeSessionMeta, fetchClaudeSessions } from "../lib/claude-sessions-client.js";
import { groupSessionsByCwd } from "../lib/workspace-grouping.js";

const LIST_POLL_MS = 4000;
const LIVE_WINDOW_MS = 8000;

function relativeTime(mtimeMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - mtimeMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function WorkspaceSessionList({
  onSelect,
}: {
  onSelect: (session: ClaudeSessionMeta) => void;
}): JSX.Element {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const groups = groupSessionsByCwd(sessions);

  const toggleGroup = (cwd: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  };

  const loadList = useCallback((): void => {
    fetchClaudeSessions(50, 0)
      .then((list) => {
        setSessions(list);
        setListState("ready");
      })
      .catch((err: unknown) => {
        setListError(err as BridgeError);
        setListState("error");
      });
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      setNowMs(Date.now());
    }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  if (listState === "loading") return <LoadingState label="Loading Claude Code sessions…" />;
  if (listState === "error" && listError)
    return <ErrorState error={listError} onRetry={loadList} />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Claude sessions</h2>
        <span className="text-xs text-text-muted">
          {groups.length} workspace{groups.length === 1 ? "" : "s"} · {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-text-muted">No Claude Code sessions found in ~/.claude/projects.</p>
      ) : (
        <div
          data-testid="session-list-card"
          className="bg-surface border border-border rounded-xl overflow-hidden shadow-none"
        >
          {groups.map((group, groupIndex) => {
            const expanded = !collapsed.has(group.cwd);
            return (
              <div key={group.cwd} className={groupIndex > 0 ? "border-t border-border" : ""}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.cwd)}
                  aria-expanded={expanded}
                  title={group.cwd}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-left cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <span className="text-text-muted text-xs">{expanded ? "▾" : "▸"}</span>
                  <span className="truncate text-xs font-medium text-text-secondary">{group.label}</span>
                  <span className="ml-auto text-[11px] text-text-muted tabular-nums">{group.sessions.length}</span>
                </button>
                {expanded &&
                  group.sessions.map((s, index) => {
                    const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
                    return (
                      <button
                        key={`${s.dir}/${s.id}`}
                        type="button"
                        onClick={() => onSelect(s)}
                        className="group flex items-center gap-3 w-full px-4 py-3 text-left border-t border-border/50 cursor-pointer hover:bg-surface-elevated transition-colors"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${live ? "bg-ok" : "bg-border"}`}
                          aria-hidden="true"
                        />
                        <span className="flex-1 min-w-0 truncate text-sm text-text-primary">{s.title || s.id}</span>
                        <span className="flex items-center gap-2 text-[11px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                          {s.model && (
                            <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-text-secondary">
                              {shortModel(s.model)}
                            </span>
                          )}
                          {s.isArchived && (
                            <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">archived</span>
                          )}
                          <span className="tabular-nums">{relativeTime(s.mtimeMs, nowMs)}</span>
                        </span>
                        <span className="text-[11px] text-text-muted tabular-nums group-hover:hidden">{relativeTime(s.mtimeMs, nowMs)}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @megasaver/gui test test/components/workspace-session-list.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/workspace-session-list.tsx apps/gui/test/components/workspace-session-list.test.tsx
git commit -m "feat(gui): minimalist session list

Rounded card, group counters, metadata on hover, removed group live dot."
```

---

### Task 4: Group cockpit tabs

**Files:**
- Modify: `apps/gui/src/cockpit/panel-registry.ts`
- Modify: `apps/gui/src/cockpit/session-cockpit.tsx`
- Test: `apps/gui/test/components/session-cockpit.test.tsx`

- [ ] **Step 1: Write the failing test**

Update `apps/gui/test/components/session-cockpit.test.tsx`:

```tsx
// Replace the first test with these
  it("renders grouped top tabs with Transcript active by default", () => {
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "Transcript" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Memory" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Saver" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Telemetry" })).toBeNull();
  });

  it("expands the Memory group to show Memory Graph", async () => {
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Memory Graph" })).toBeDefined());
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @megasaver/gui test test/components/session-cockpit.test.tsx
```

Expected: FAIL — no grouped tabs.

- [ ] **Step 3: Implement grouped cockpit tabs**

Add to `apps/gui/src/cockpit/panel.ts` (or a new type in `panel-registry.ts`):

```ts
export type CockpitTabGroup = {
  id: string;
  label: string;
  panelIds: readonly string[];
};
```

Update `apps/gui/src/cockpit/panel-registry.ts`:

```ts
import type { CockpitPanel } from "./panel.js";
import {
  MemoryCockpitPanel,
  MemoryGraphCockpitPanel,
  TasksCockpitPanel,
  TokenSaverCockpitPanel,
} from "./panels/session-overlay-panels.js";
import { TelemetryPanel } from "./panels/telemetry-panel.js";
import { TranscriptPanel } from "./panels/transcript-panel.js";
import {
  WorkspaceContextCockpitPanel,
  WorkspaceIndexCockpitPanel,
  WorkspacePermissionsCockpitPanel,
  WorkspaceRulesCockpitPanel,
  WorkspaceToolsCockpitPanel,
} from "./panels/workspace-panels.js";

export const COCKPIT_PANELS: readonly CockpitPanel[] = [
  { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
  { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
  { id: "memory", label: "Memory", scope: "session", component: MemoryCockpitPanel },
  { id: "memory-graph", label: "Memory Graph", scope: "session", component: MemoryGraphCockpitPanel },
  { id: "tasks", label: "Tasks", scope: "session", component: TasksCockpitPanel },
  { id: "token-saver", label: "Saver", scope: "session", component: TokenSaverCockpitPanel },
  { id: "ws-index", label: "Index", scope: "workspace", component: WorkspaceIndexCockpitPanel },
  { id: "ws-context", label: "Context", scope: "workspace", component: WorkspaceContextCockpitPanel },
  { id: "ws-rules", label: "Rules", scope: "workspace", component: WorkspaceRulesCockpitPanel },
  { id: "ws-tools", label: "Tools", scope: "workspace", component: WorkspaceToolsCockpitPanel },
  { id: "ws-permissions", label: "Permissions", scope: "workspace", component: WorkspacePermissionsCockpitPanel },
];

export const COCKPIT_TAB_GROUPS: readonly CockpitTabGroup[] = [
  { id: "transcript", label: "Transcript", panelIds: ["transcript"] },
  { id: "telemetry", label: "Telemetry", panelIds: ["telemetry"] },
  { id: "memory", label: "Memory", panelIds: ["memory", "memory-graph"] },
  { id: "workspace", label: "Workspace", panelIds: ["ws-index", "ws-context", "ws-rules", "ws-tools", "ws-permissions"] },
  { id: "saver", label: "Saver", panelIds: ["token-saver"] },
  { id: "tasks", label: "Tasks", panelIds: ["tasks"] },
];

export function getPanel(id: string): CockpitPanel | undefined {
  return COCKPIT_PANELS.find((p) => p.id === id);
}
```

Update `apps/gui/src/cockpit/session-cockpit.tsx`:

```tsx
import { useMemo, useState } from "react";
import { COCKPIT_TAB_GROUPS, getPanel } from "./panel-registry.js";

export function SessionCockpit({ dir, id, cwd, title, onBack }: { ... }) {
  const [activePanelId, setActivePanelId] = useState<string>("transcript");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const active = getPanel(activePanelId);
  const Body = active?.component;

  const activeGroupId = useMemo(
    () => COCKPIT_TAB_GROUPS.find((g) => g.panelIds.includes(activePanelId))?.id ?? null,
    [activePanelId],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-start gap-4 px-5 py-4 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="mt-1 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          ← Back
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-lg font-semibold tracking-tight text-text-primary truncate">{title || id}</span>
          <span className="text-xs text-text-muted truncate" title={cwd}>{cwd}</span>
        </div>
      </header>

      <nav aria-label="Cockpit panels" className="flex items-center gap-6 px-5 border-b border-border shrink-0">
        {COCKPIT_TAB_GROUPS.map((group) => {
          const inGroup = activeGroupId === group.id;
          const expanded = openGroup === group.id;
          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                aria-current={inGroup ? "page" : undefined}
                aria-expanded={group.panelIds.length > 1 ? expanded : undefined}
                onClick={() => {
                  if (group.panelIds.length === 1) {
                    setActivePanelId(group.panelIds[0]);
                    setOpenGroup(null);
                  } else {
                    setOpenGroup(expanded ? null : group.id);
                  }
                }}
                className={[
                  "px-1 py-3 text-xs transition-colors duration-150 cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  inGroup ? "text-text-primary font-medium border-b-2 border-text-primary" : "text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {group.label}
                {group.panelIds.length > 1 && <span className="ml-0.5 text-[10px]">▾</span>}
              </button>
              {expanded && (
                <div className="absolute top-full left-0 mt-1 py-1 bg-surface border border-border rounded-md shadow-sm min-w-[140px] z-10">
                  {group.panelIds.map((pid) => {
                    const panel = getPanel(pid);
                    if (!panel) return null;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => {
                          setActivePanelId(pid);
                          setOpenGroup(null);
                        }}
                        className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                      >
                        {panel.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {Body && <Body dir={dir} id={id} cwd={cwd} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @megasaver/gui test test/components/session-cockpit.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/cockpit/panel.ts apps/gui/src/cockpit/panel-registry.ts apps/gui/src/cockpit/session-cockpit.tsx apps/gui/test/components/session-cockpit.test.tsx
git commit -m "feat(gui): grouped cockpit tabs

11 tabs collapsed into 6 groups; active group underlined; dropdown for multi-panel groups."
```

---

### Task 5: Redesign token saver panel

**Files:**
- Modify: `apps/gui/src/views/cockpit/token-saver-panel.tsx`
- Modify: `apps/gui/src/views/cockpit/hook-connection.tsx` (heading + prose trim)
- Modify: `apps/gui/src/views/cockpit/saver-mode-activation.tsx` (heading + prose trim)
- Modify: `apps/gui/src/views/cockpit/daemon-status.tsx` (collapse under Advanced)
- Test: `apps/gui/test/components/token-saver-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Update `apps/gui/test/components/token-saver-panel.test.tsx`:

```tsx
// Replace the existing mini-table describe block

describe("TokenSaverPanel", () => {
  it("shows a hero token-saved metric", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("200")).toBeDefined());
    expect(screen.getByText("tokens saved")).toBeDefined();
  });

  it("shows status badges and hides byte-level table labels", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("tokens saved")).toBeDefined());
    expect(screen.queryByText("Would have used")).toBeNull();
    expect(screen.queryByText("Actually used")).toBeNull();
    expect(screen.queryByText("Saved %")).toBeNull();
    expect(screen.queryByText("Bytes saved")).toBeNull();
  });

  it("shows the empty message when no proxy activity", async () => {
    stub.saver = () => Promise.resolve({ ...SAVER, enabled: false });
    stub.stats = () => Promise.resolve(null);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText(/No proxy activity/i)).toBeDefined());
  });

  it("live-updates the saved tokens on the poll interval", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      stub.saver = () => Promise.resolve(SAVER);
      stub.stats = () => Promise.resolve({ ...STATS, returnedBytesTotal: n++ === 0 ? 200 : 100 });
      render(<TokenSaverPanel dir="d" id="i" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText("200")).toBeDefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.getByText("225")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @megasaver/gui test test/components/token-saver-panel.test.tsx
```

Expected: FAIL — hero metric not present.

- [ ] **Step 3: Implement token saver redesign**

Edit `apps/gui/src/views/cockpit/token-saver-panel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type OverlaySessionTokenSaverStats, fetchSessionTokenSaverStats } from "../../lib/claude-sessions-client.js";
import { DaemonStatusPanel } from "./daemon-status.js";
import { HookConnection } from "./hook-connection.js";
import { SaverModeActivation } from "./saver-mode-activation.js";

const POLL_MS = 2_000;

export function TokenSaverPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const fetchData = useCallback(async (silent: boolean) => {
    if (!silent) { setState("loading"); setError(null); }
    try {
      const s = await fetchSessionTokenSaverStats(dir, id);
      setStats(s);
      setState("ready");
    } catch (err) {
      if (!silent) { setError(err as BridgeError); setState("error"); }
    }
  }, [dir, id]);

  useEffect(() => {
    void fetchData(false);
    const timer = setInterval(() => void fetchData(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  return (
    <section aria-label="Session token saver" className="flex flex-col gap-6 px-6 py-6 overflow-y-auto flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">Token saver</h2>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          live
        </span>
      </div>

      {state === "loading" && <LoadingState label="Loading token-saver stats…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={() => void fetchData(false)} />}
      {state === "ready" && (
        stats === null ? (
          <p className="text-sm text-text-muted">No proxy activity recorded for this session.</p>
        ) : (
          <div className="bg-surface border border-border rounded-xl p-6">
            <HeroMetric stats={stats} />
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge tone="ok">Hook on</StatusBadge>
              <StatusBadge tone="active">Saver active</StatusBadge>
              <StatusBadge tone="muted">Daemon live</StatusBadge>
            </div>
          </div>
        )
      )}

      <details className="group">
        <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary transition-colors">Advanced</summary>
        <div className="mt-4 flex flex-col gap-6">
          <HookConnection />
          <SaverModeActivation dir={dir} id={id} />
          <DaemonStatusPanel />
        </div>
      </details>
    </section>
  );
}

function HeroMetric({ stats }: { stats: OverlaySessionTokenSaverStats }): JSX.Element {
  const would = tokensFromBytes(stats.rawBytesTotal);
  const used = tokensFromBytes(stats.returnedBytesTotal);
  const saved = Math.max(0, would - used);
  const pct = would === 0 ? 0 : Math.round((saved / would) * 100);
  return (
    <div>
      <div className="text-4xl font-semibold tracking-tight text-text-primary tabular-nums">{saved.toLocaleString()}</div>
      <div className="text-sm text-text-secondary">tokens saved</div>
      <div className="mt-1 text-xs text-text-muted">{pct}% vs. raw output · {would.toLocaleString()} would-have-used</div>
    </div>
  );
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: "ok" | "active" | "muted" | "warn" | "danger" }): JSX.Element {
  const styles: Record<string, string> = {
    ok: "bg-[var(--status-live-bg)] text-[var(--status-live-fg)]",
    active: "bg-[var(--status-active-bg)] text-[var(--status-active-fg)]",
    muted: "bg-surface-elevated text-text-secondary",
    warn: "bg-[var(--status-warn-bg)] text-[var(--status-warn-fg)]",
    danger: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wide ${styles[tone]}`}>
      {children}
    </span>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}
```

Trim sub-component headings:

`hook-connection.tsx`: change `Saver hook` heading class to `text-sm font-medium text-text-primary`; remove the explanatory paragraph.

`saver-mode-activation.tsx`: change `Saver Mode` heading class; remove explanatory paragraph; keep toggle + mode select.

`daemon-status.tsx`: change heading class; remove paragraph.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @megasaver/gui test test/components/token-saver-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/cockpit/token-saver-panel.tsx apps/gui/src/views/cockpit/hook-connection.tsx apps/gui/src/views/cockpit/saver-mode-activation.tsx apps/gui/src/views/cockpit/daemon-status.tsx apps/gui/test/components/token-saver-panel.test.tsx
git commit -m "feat(gui): metric-first token saver panel

Hero saved-tokens number, pastel badges, controls under Advanced."
```

---

### Task 6: Update DESIGN.md and add changeset

**Files:**
- Modify: `apps/gui/DESIGN.md`
- Create: `.changeset/gui-minimalist-redesign.md`

- [ ] **Step 1: Update DESIGN.md**

Rewrite `apps/gui/DESIGN.md` to describe v2 tokens: warm monochrome palette, sans UI font, spot-pastel badges, grouped cockpit tabs, and metric-first token saver. Preserve accessibility commitments.

- [ ] **Step 2: Add changeset**

Create `.changeset/gui-minimalist-redesign.md`:

```md
---
"@megasaver/gui": minor
---

Redesign high-clutter GUI surfaces with a warm-monochrome Editorial Workspace aesthetic. Tokens, app shell, session list, cockpit tab groups, and token-saver panel updated.
```

- [ ] **Step 3: Run full GUI verify**

```bash
pnpm --filter @megasaver/gui verify
```

Expected: lint, typecheck, tests all green.

- [ ] **Step 4: Commit**

```bash
git add apps/gui/DESIGN.md .changeset/gui-minimalist-redesign.md
git commit -m "docs(gui): v2 design system and changeset

Document Editorial Workspace tokens and add minor changeset."
```

---

## Self-review

**Spec coverage:**
- Tokens (warm monochrome + pastels) → Task 1.
- App shell centered layout → Task 2.
- Session list simplification → Task 3.
- Cockpit tab grouping → Task 4.
- Token saver hero metric → Task 5.
- DESIGN.md update + changeset → Task 6.

**Placeholder scan:** No TBD/TODO; each step includes exact file paths, code, and commands.

**Type consistency:** `COCKPIT_TAB_GROUPS` uses panel IDs that exist in `COCKPIT_PANELS`; `SessionCockpit` state remains `string` panel id.

---

**Plan saved to:** `docs/superpowers/plans/2026-06-26-gui-minimalist-redesign-plan.md`

**Execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach do you want?
