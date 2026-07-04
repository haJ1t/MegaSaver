# GUI Redesign v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `@megasaver/gui` app shell as a six-page amber-accented sidebar console with a slim session cockpit, relocating workspace/global panels out of the overloaded cockpit — frontend-only, no bridge/Core change.

**Architecture:** A persistent left `Sidebar` replaces the top-nav. `app.tsx` holds three lifted states: `view` (`ViewId`, six members), `selected` (session for the cockpit), and `activeWorkspace` (derived from the session list). Three new page shells (Token Saver, Memory, Workspace) compose *existing* panel components. Because Memory + saver-activation are session-anchored at the bridge, a frontend `workspace-context` seam resolves the active workspace → its most-recent session `(dir,id)`. The cockpit shrinks to session-scoped panels (transcript, telemetry, tasks) plus a right rail carrying the per-session savings stats.

**Tech Stack:** Vite + React 18 + Tailwind v3 (CSS-variable tokens) + tiny node:http bridge (untouched). Tests: Vitest + @testing-library/react (jsdom). No new dependency.

**Spec:** `docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md`
**Branch:** `feat/gui-redesign-v3` (already created off `main`).

---

## File Structure

All paths under `apps/gui/`.

**New files:**
- `src/lib/workspace-context.ts` — `WorkspaceOption` type + `deriveWorkspaceOptions(sessions)`.
- `src/components/workspace-picker.tsx` — shared active-workspace `<select>`.
- `src/components/sidebar.tsx` — persistent nav (six items + daemon footer).
- `src/views/workspace-page.tsx` — composes the 5 workspace panels for `activeWorkspace.key`.
- `src/views/memory-page.tsx` — composes `MemoryPanel` + `MemoryGraphPanel` for `activeWorkspace.rep`.
- `src/views/token-saver-page.tsx` — composes global controls + `SaverModeActivation` for `activeWorkspace.rep`.
- `src/cockpit/panels/session-saver-stats.tsx` — the per-session savings table extracted for the cockpit rail.

**Modified files:**
- `src/view-id.ts` — `VIEW_IDS` 3 → 6 (alphabetic), `VIEW_LABELS`, `claude-sessions`→`sessions`.
- `src/app.tsx` — sidebar shell, six-view switch, `activeWorkspace` state.
- `src/styles/tokens.css` — amber `--color-accent` / `--color-accent-fg` (light + dark).
- `src/cockpit/session-cockpit.tsx` — right-rail layout, reduced nav.
- `src/cockpit/panel-registry.ts` — reduce to session-scoped set.
- `src/cockpit/panels/session-overlay-panels.tsx` — drop the now-unused Memory/MemoryGraph/TokenSaver cockpit adapters (keep Tasks).
- `src/views/workspace-session-list.tsx` — home summary strip (Task K).
- `apps/gui/DESIGN.md` — v3 update.
- `wiki/entities/gui.md` + `wiki/log.md` — record the redesign.

**Deleted files (orphaned by this change):**
- `src/cockpit/panels/workspace-panels.tsx` (its five adapters are replaced by the Workspace page's direct `workspaceKey` usage).
- `src/views/cockpit/token-saver-panel.tsx` (split into `session-saver-stats.tsx` rail + the Token Saver page controls).

**Test files touched:** `test/view-id.test-d.ts`, `test/components/app.test.tsx`, `test/components/session-cockpit.test.tsx`, `test/components/cockpit-panel-registry.test.tsx`, `test/views/workspace-panels.test.tsx`, `test/views/session-overlay-panels.test.tsx`, `test/components/token-saver-panel.test.tsx`, `test/styles/tokens.test.ts`, plus new test files per task below.

**Ordering rationale:** Tasks A–H are additive (repo stays green). Task I reduces the cockpit. Task J flips `app.tsx` + the enum, making the new shell live. Task K adds the home summary strip (additive). Task L is docs. Note the one deliberate typecheck gap between H and J (see Task H, Step 3) — run `pnpm verify` after Task J, not between H and J.

Run the whole suite from repo root with `pnpm --filter @megasaver/gui test`. Run one file with `pnpm --filter @megasaver/gui test <path>`.

---

## Task A: Amber accent tokens

**Files:**
- Modify: `apps/gui/src/styles/tokens.css` (light `:root` accent lines; dark `@media` accent lines)
- Test: `apps/gui/test/styles/accent-contrast.test.ts` (new)

- [ ] **Step 1: Write the failing contrast test**

Create `apps/gui/test/styles/accent-contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import tokens from "../../src/styles/tokens.css?raw";

// Minimal WCAG 2.1 relative-luminance + contrast, no dependency.
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Pull a hex value out of the CSS for a given variable, scoped to a block.
function readVar(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

const light = tokens.slice(tokens.indexOf(":root"), tokens.indexOf("@media"));
const dark = tokens.slice(tokens.indexOf("@media"));

describe("amber accent contrast (WCAG AA ≥ 4.5:1)", () => {
  it("light: accent text on background and surface", () => {
    const accent = readVar(light, "--color-accent");
    expect(contrast(accent, readVar(light, "--color-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accent, readVar(light, "--color-surface"))).toBeGreaterThanOrEqual(4.5);
  });
  it("light: accent-fg on the accent fill", () => {
    expect(
      contrast(readVar(light, "--color-accent-fg"), readVar(light, "--color-accent")),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("dark: accent text on background, and accent-fg on the accent fill", () => {
    const accent = readVar(dark, "--color-accent");
    expect(contrast(accent, readVar(dark, "--color-background"))).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(readVar(dark, "--color-accent-fg"), accent),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @megasaver/gui test test/styles/accent-contrast.test.ts`
Expected: FAIL — light accent is currently `#111111` (accent-fg `#ffffff`): `accent-fg on accent` contrast ≈ 18 (passes), but `accent on background` ≈ 18 too… so the *black* accent actually passes contrast. **The test will PASS with black.** To make it a real red first, temporarily assert the accent is amber:

Add this assertion at the top of the `describe`:

```ts
  it("accent is amber, not the old black", () => {
    expect(readVar(light, "--color-accent").toLowerCase()).not.toBe("#111111");
  });
```

Run again — Expected: FAIL on "accent is amber, not the old black".

- [ ] **Step 3: Change the accent tokens**

In `apps/gui/src/styles/tokens.css`, light `:root` block, replace:

```css
  /* Accent — near-black for primary actions; high contrast without color noise */
  --color-accent: #111111;
  --color-accent-fg: #ffffff;
```
with:
```css
  /* Accent — amber; warm-palette primary. Contrast-pinned ≥4.5:1 (accent-contrast.test.ts). */
  --color-accent: #b45309;
  --color-accent-fg: #fff7ed;
```

In the dark `@media (prefers-color-scheme: dark)` block, replace:

```css
    /* Accent */
    --color-accent: #f0f1f3;
    --color-accent-fg: #0c0d0f;
```
with:
```css
    /* Accent — brightened amber for the dark canvas. */
    --color-accent: #f59e0b;
    --color-accent-fg: #0c0d0f;
```

> If Step 4 shows the light `accent on background` check under 4.5 on any run (it computes ≈4.65, thin margin), darken the light accent to `#92400e` (amber-800) and re-run.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/gui test test/styles/accent-contrast.test.ts`
Expected: PASS (all four contrast checks + the amber guard).

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/styles/tokens.css apps/gui/test/styles/accent-contrast.test.ts
git commit -m "feat(gui): amber accent tokens, contrast-pinned"
```

---

## Task B: workspace-context lib

Pure derivation: the session list → selectable workspace options, each carrying a representative session for the session-anchored routes.

**Files:**
- Create: `apps/gui/src/lib/workspace-context.ts`
- Test: `apps/gui/test/lib/workspace-context.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/lib/workspace-context.test.ts`:

```ts
import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { ClaudeSessionMeta } from "../../src/lib/claude-sessions-client.js";
import { deriveWorkspaceOptions } from "../../src/lib/workspace-context.js";

function session(over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta {
  return {
    dir: "d", id: "i", mtimeMs: 0, size: 0, title: "t", projectLabel: "/ws/a",
    isArchived: false, model: "m", permissionMode: "p", lastActivityAt: 0, ...over,
  };
}

describe("deriveWorkspaceOptions", () => {
  it("returns one option per cwd, keyed by encodeWorkspaceKey, newest-first", () => {
    const opts = deriveWorkspaceOptions([
      session({ dir: "d1", id: "s1", projectLabel: "/ws/a", mtimeMs: 10 }),
      session({ dir: "d2", id: "s2", projectLabel: "/ws/b", mtimeMs: 30 }),
      session({ dir: "d3", id: "s3", projectLabel: "/ws/a", mtimeMs: 20 }),
    ]);
    expect(opts.map((o) => o.cwd)).toEqual(["/ws/b", "/ws/a"]); // b is newer
    const a = opts.find((o) => o.cwd === "/ws/a");
    expect(a?.key).toBe(encodeWorkspaceKey("/ws/a"));
    expect(a?.label).toBe("a");
    expect(a?.rep).toEqual({ dir: "d3", id: "s3" }); // newest session in /ws/a
  });

  it("returns [] for no sessions", () => {
    expect(deriveWorkspaceOptions([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/gui test test/lib/workspace-context.test.ts`
Expected: FAIL — "Failed to resolve import ... workspace-context".

- [ ] **Step 3: Implement**

Create `apps/gui/src/lib/workspace-context.ts`:

```ts
import { encodeWorkspaceKey } from "@megasaver/shared";
import type { ClaudeSessionMeta } from "./claude-sessions-client.js";
import { groupSessionsByCwd } from "./workspace-grouping.js";

export type WorkspaceOption = {
  key: string;
  cwd: string;
  label: string;
  rep: { dir: string; id: string };
};

// ponytail: single-sourced from the recent-session list. A workspace with no
// session in the fetched window won't appear — fine for a single-dev tool;
// widen to fetchWorkspaces() only if that gap bites.
export function deriveWorkspaceOptions(sessions: ClaudeSessionMeta[]): WorkspaceOption[] {
  return groupSessionsByCwd(sessions).map((g) => {
    const rep = g.sessions[0];
    return {
      key: encodeWorkspaceKey(g.cwd),
      cwd: g.cwd,
      label: g.label,
      rep: { dir: rep.dir, id: rep.id },
    };
  });
}
```

> `groupSessionsByCwd` already sorts groups newest-first and each group's `sessions` newest-first, so `g.sessions[0]` is the representative. `noUncheckedIndexedAccess` is on: `rep` is `ClaudeSessionMeta | undefined`. Guard it:

Replace the `.map` body with:
```ts
  return groupSessionsByCwd(sessions).flatMap((g) => {
    const rep = g.sessions[0];
    if (!rep) return [];
    return [{ key: encodeWorkspaceKey(g.cwd), cwd: g.cwd, label: g.label, rep: { dir: rep.dir, id: rep.id } }];
  });
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/gui test test/lib/workspace-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/lib/workspace-context.ts apps/gui/test/lib/workspace-context.test.ts
git commit -m "feat(gui): workspace-context derivation from session list"
```

---

## Task C: WorkspacePicker component

**Files:**
- Create: `apps/gui/src/components/workspace-picker.tsx`
- Test: `apps/gui/test/components/workspace-picker.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/components/workspace-picker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "../../src/components/workspace-picker.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(cleanup);

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
  { key: "k2", cwd: "/ws/b", label: "b", rep: { dir: "d2", id: "s2" } },
];

describe("WorkspacePicker", () => {
  it("renders options and reports the selected key on change", () => {
    const onChange = vi.fn();
    render(<WorkspacePicker options={OPTS} activeKey="k1" onChange={onChange} />);
    const select = screen.getByLabelText("Active workspace") as HTMLSelectElement;
    expect(select.value).toBe("k1");
    fireEvent.change(select, { target: { value: "k2" } });
    expect(onChange).toHaveBeenCalledWith("k2");
  });

  it("renders nothing useful when empty (no crash)", () => {
    render(<WorkspacePicker options={[]} activeKey={null} onChange={() => {}} />);
    expect(screen.getByText(/no workspaces/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (missing import)

Run: `pnpm --filter @megasaver/gui test test/components/workspace-picker.test.tsx`

- [ ] **Step 3: Implement**

Create `apps/gui/src/components/workspace-picker.tsx`:

```tsx
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function WorkspacePicker({
  options,
  activeKey,
  onChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onChange: (key: string) => void;
}): JSX.Element {
  if (options.length === 0) {
    return <p className="text-sm text-text-muted">No workspaces found.</p>;
  }
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="sr-only">Active workspace</span>
      <select
        aria-label="Active workspace"
        value={activeKey ?? options[0]?.key ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

> The empty-state test expects the text "No workspaces found." — matches the `p` above (`/no workspaces/i`).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/components/workspace-picker.tsx apps/gui/test/components/workspace-picker.test.tsx
git commit -m "feat(gui): shared workspace picker"
```

---

## Task D: Workspace page

Composes the five workspace panels for a `workspaceKey`, with the picker on top. Uses the underlying panels directly (not the cockpit adapters).

**Files:**
- Create: `apps/gui/src/views/workspace-page.tsx`
- Test: `apps/gui/test/views/workspace-page.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/views/workspace-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "../../src/views/workspace-page.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "0123456789abcdef", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("WorkspacePage", () => {
  it("renders the picker and the workspace panels for the active key", () => {
    // Panels fetch on mount; stub fetch to a benign empty payload.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
    );
    render(<WorkspacePage options={OPTS} activeKey="0123456789abcdef" onWorkspaceChange={() => {}} />);
    expect(screen.getByLabelText("Active workspace")).toBeTruthy();
    // Assert the page's own heading (robust; not coupled to child-panel markup).
    expect(screen.getByRole("heading", { name: /workspace/i })).toBeTruthy();
  });
});
```

> The smoke test asserts only the page-owned heading + picker, so it does not depend on the child panels' fetch payloads. The `fetch` stub above merely prevents unhandled network errors from the child panels mounting.

- [ ] **Step 2: Run — expect FAIL** (missing import)

- [ ] **Step 3: Implement**

Create `apps/gui/src/views/workspace-page.tsx`:

```tsx
import { WorkspaceContextPanel } from "./cockpit/workspace-context-panel.js";
import { WorkspaceIndexPanel } from "./cockpit/workspace-index-panel.js";
import { WorkspacePermissionsPanel } from "./cockpit/workspace-permissions-panel.js";
import { WorkspaceRulesPanel } from "./cockpit/workspace-rules-panel.js";
import { WorkspaceToolsPanel } from "./cockpit/workspace-tools-panel.js";
import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function WorkspacePage({
  options,
  activeKey,
  onWorkspaceChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Workspace</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      {key === null ? (
        <p className="text-sm text-text-muted">Select a workspace to inspect.</p>
      ) : (
        <div className="flex flex-col gap-6 overflow-y-auto min-h-0">
          <WorkspaceIndexPanel workspaceKey={key} />
          <WorkspaceContextPanel workspaceKey={key} />
          <WorkspaceRulesPanel workspaceKey={key} />
          <WorkspaceToolsPanel workspaceKey={key} />
          <WorkspacePermissionsPanel workspaceKey={key} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/workspace-page.tsx apps/gui/test/views/workspace-page.test.tsx
git commit -m "feat(gui): workspace page composes ws panels by key"
```

---

## Task E: Memory page

Composes `MemoryPanel` + `MemoryGraphPanel` against the active workspace's representative session.

**Files:**
- Create: `apps/gui/src/views/memory-page.tsx`
- Test: `apps/gui/test/views/memory-page.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/views/memory-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPage } from "../../src/views/memory-page.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("MemoryPage", () => {
  it("renders the picker and memory panel for the representative session", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })),
    );
    render(<MemoryPage options={OPTS} activeKey="k1" onWorkspaceChange={() => {}} />);
    expect(screen.getByLabelText("Active workspace")).toBeTruthy();
    // Page-owned heading (robust; child panels may still be loading).
    expect(screen.getByRole("heading", { name: /memory/i })).toBeTruthy();
  });

  it("prompts to select when there is no active workspace", () => {
    render(<MemoryPage options={[]} activeKey={null} onWorkspaceChange={() => {}} />);
    expect(screen.getByText(/select a workspace/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Create `apps/gui/src/views/memory-page.tsx`:

```tsx
import { MemoryGraphPanel } from "./cockpit/memory-graph-panel.js";
import { MemoryPanel } from "./cockpit/memory-panel.js";
import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function MemoryPage({
  options,
  activeKey,
  onWorkspaceChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Memory</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      {active === null ? (
        <p className="text-sm text-text-muted">Select a workspace to view its memory.</p>
      ) : (
        <div className="flex flex-col gap-6 overflow-y-auto min-h-0">
          <MemoryPanel dir={active.rep.dir} id={active.rep.id} />
          <MemoryGraphPanel dir={active.rep.dir} id={active.rep.id} />
        </div>
      )}
    </div>
  );
}
```

> Confirm `MemoryGraphPanel`'s prop shape at `src/views/cockpit/memory-graph-panel.tsx:210` is `{ dir, id }` (it is called that way today in `session-overlay-panels.tsx`). If it also requires a `workspaceKey`, pass `active.key`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/memory-page.tsx apps/gui/test/views/memory-page.test.tsx
git commit -m "feat(gui): memory page over representative session"
```

---

## Task F: Token Saver page

Global controls (hook, proxy, daemon) + per-workspace saver activation. **No** per-session stats table here (that goes to the cockpit rail in Task G).

**Files:**
- Create: `apps/gui/src/views/token-saver-page.tsx`
- Test: `apps/gui/test/views/token-saver-page.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/views/token-saver-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenSaverPage } from "../../src/views/token-saver-page.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("TokenSaverPage", () => {
  it("renders global controls plus saver activation for the active workspace", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
    );
    render(<TokenSaverPage options={OPTS} activeKey="k1" onWorkspaceChange={() => {}} />);
    expect(screen.getByLabelText("Active workspace")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /token saver/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Create `apps/gui/src/views/token-saver-page.tsx`:

```tsx
import { DaemonStatusPanel } from "./cockpit/daemon-status.js";
import { HookConnection } from "./cockpit/hook-connection.js";
import { ProxyActivation } from "./cockpit/proxy-activation.js";
import { SaverModeActivation } from "./cockpit/saver-mode-activation.js";
import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function TokenSaverPage({
  options,
  activeKey,
  onWorkspaceChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 overflow-y-auto">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Token saver</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      <HookConnection />
      <ProxyActivation />
      {active === null ? (
        <p className="text-sm text-text-muted">Select a workspace to configure saver mode.</p>
      ) : (
        <SaverModeActivation dir={active.rep.dir} id={active.rep.id} />
      )}
      <DaemonStatusPanel />
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/token-saver-page.tsx apps/gui/test/views/token-saver-page.test.tsx
git commit -m "feat(gui): token-saver page — global controls + saver activation"
```

---

## Task G: Session saver-stats rail component

Extract the per-session savings table from `token-saver-panel.tsx` into a small rail component for the cockpit. Additive (does not yet remove the old panel).

**Files:**
- Create: `apps/gui/src/cockpit/panels/session-saver-stats.tsx`
- Test: `apps/gui/test/components/session-saver-stats.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/components/session-saver-stats.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSaverStats } from "../../src/cockpit/panels/session-saver-stats.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATS = {
  liveSessionId: "s1", eventsTotal: 3, rawBytesTotal: 40000, returnedBytesTotal: 16000,
  bytesSavedTotal: 24000, savingRatio: 0.6, secretsRedactedTotal: 0, chunksStoredTotal: 2,
  updatedAt: "2026-07-03T00:00:00.000Z",
};

describe("SessionSaverStats", () => {
  it("shows the tokens-saved figure once stats load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(STATS), { status: 200, headers: { "content-type": "application/json" } })),
    );
    render(<SessionSaverStats dir="d1" id="s1" />);
    // (40000-16000)/4 = 6000 tokens saved.
    await waitFor(() => expect(screen.getByText(/6,000/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Create `apps/gui/src/cockpit/panels/session-saver-stats.tsx` by lifting the stats-table portion of `src/views/cockpit/token-saver-panel.tsx` (the polling `useEffect` over `fetchSessionTokenSaverStats`, the `TokenSavedValue`, and the four-row table) — **drop** the `<details>Advanced` controls (those now live on the Token Saver page):

```tsx
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
  fetchSessionTokenSaverStats,
} from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

export function SessionSaverStats({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    let latest = nonce;
    const tick = (silent: boolean): void => {
      const requestId = ++latest;
      if (!silent) { setState("loading"); setError(null); }
      fetchSessionTokenSaverStats(dir, id)
        .then((s) => { if (live && requestId === latest) { setStats(s); setState("ready"); } })
        .catch((err: unknown) => {
          if (live && requestId === latest && !silent) { setError(err as BridgeError); setState("error"); }
        });
    };
    tick(false);
    const t = setInterval(() => tick(true), POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [dir, id, nonce]);

  return (
    <section aria-label="Session savings" className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-widest text-text-muted">Savings</h3>
      {state === "loading" && <LoadingState label="Loading savings…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} />}
      {state === "ready" && (stats === null ? (
        <p className="text-sm text-text-muted">No proxy activity this session.</p>
      ) : (
        <dl className="text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-text-secondary">Tokens saved</dt>
            <dd className="tabular-nums font-medium text-accent">{savedTokens(stats).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-text-secondary">Reduction</dt>
            <dd className="tabular-nums text-text-primary">{savedPct(stats)}%</dd>
          </div>
        </dl>
      ))}
    </section>
  );
}

function tokensFromBytes(bytes: number): number { return Math.ceil(bytes / 4); }
function savedTokens(s: OverlaySessionTokenSaverStats): number {
  return Math.max(0, tokensFromBytes(s.rawBytesTotal) - tokensFromBytes(s.returnedBytesTotal));
}
function savedPct(s: OverlaySessionTokenSaverStats): number {
  const would = tokensFromBytes(s.rawBytesTotal);
  return would === 0 ? 0 : Math.round((savedTokens(s) / would) * 100);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/cockpit/panels/session-saver-stats.tsx apps/gui/test/components/session-saver-stats.test.tsx
git commit -m "feat(gui): session saver-stats rail component"
```

---

## Task H: Sidebar component

> **EXECUTION CORRECTION (2026-07-03):** the gui Vitest run evaluates runtime
> values — the sidebar renders `VIEW_LABELS[id]`, and `VIEW_LABELS` only has
> the six entries after Task J's enum change. So the sidebar's own test cannot
> be green standalone (missing labels → empty button text → assertion fails),
> and Task J's `claude-sessions`→`sessions` rename breaks the current
> `app.tsx`. **Implement Task H and Task J TOGETHER as ONE atomic task with a
> single commit**, in this order: (1) expand the enum + labels (Task J Steps 1–4),
> (2) create the sidebar (this task), (3) rewrite `app.tsx` + `app.test.tsx`
> (Task J Steps 5–6), (4) run the full suite once — expect GREEN, (5) commit
> once (`feat(gui): live sidebar shell + six-view routing`). Ignore this task's
> Step 3 note about a deliberate typecheck gap — there is no green intermediate
> state, so do not commit between H and J. Run Task I (cockpit slim) BEFORE
> this merged task; it is independent of the enum.

**Files:**
- Create: `apps/gui/src/components/sidebar.tsx`
- Test: `apps/gui/test/components/sidebar.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/gui/test/components/sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/components/sidebar.js";

afterEach(cleanup);

describe("Sidebar", () => {
  it("renders six nav items in display order and marks the active one", () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    const nav = screen.getByRole("navigation", { name: /main/i });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(6);
    expect(buttons[0].textContent).toBe("Sessions");
    expect(screen.getByRole("button", { name: "Sessions" }).getAttribute("aria-current")).toBe("page");
  });

  it("reports the clicked view", () => {
    const onNavigate = vi.fn();
    render(<Sidebar active="sessions" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(onNavigate).toHaveBeenCalledWith("memory");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Create `apps/gui/src/components/sidebar.tsx`:

```tsx
import { VIEW_LABELS, type ViewId } from "../view-id.js";

// Display order (logical), independent of the alphabetic VIEW_IDS type pin.
const NAV_ORDER: readonly ViewId[] = [
  "sessions", "token-saver", "memory", "workspace", "agent-office", "agent-setup",
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
}): JSX.Element {
  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r border-border bg-surface">
      <div className="px-5 pt-6 pb-4 text-base font-semibold tracking-tight select-none">
        Mega Saver
      </div>
      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3">
        {NAV_ORDER.map((id) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(id)}
              className={[
                "px-3 py-2 text-sm text-left rounded-lg transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                isActive
                  ? "bg-accent text-accent-fg font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
              ].join(" ")}
            >
              {VIEW_LABELS[id]}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
```

> This imports `VIEW_LABELS`/`ViewId` which still have the *old* three members until Task J. The `NAV_ORDER` array references `"sessions"`, `"token-saver"`, etc. — these are not yet in `ViewId`, so **this file will not typecheck until Task J lands the enum.** To keep the repo green, the sidebar test in Step 2/4 runs (Vitest transpiles per-file, no project typecheck), but `pnpm typecheck` will fail between Task H and Task J. **Therefore: do not run `pnpm verify` (which includes typecheck) between H and J; run it after J.** Each of H/I commits still runs its own vitest file green. This is the one deliberate multi-task typecheck gap; J closes it.

- [ ] **Step 4: Run the sidebar test — expect PASS**

Run: `pnpm --filter @megasaver/gui test test/components/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/components/sidebar.tsx apps/gui/test/components/sidebar.test.tsx
git commit -m "feat(gui): sidebar nav component"
```

---

## Task I: Slim the cockpit — reduce registry + right rail

Reduce `COCKPIT_PANELS`/`COCKPIT_TAB_GROUPS` to the session-scoped set (`transcript`, `telemetry`, `tasks`), lay the cockpit out as transcript + right rail (telemetry + `SessionSaverStats` + tasks), and delete the orphaned adapters/panel.

**Files:**
- Modify: `apps/gui/src/cockpit/panel-registry.ts`
- Modify: `apps/gui/src/cockpit/panels/session-overlay-panels.tsx`
- Delete: `apps/gui/src/cockpit/panels/workspace-panels.tsx`
- Delete: `apps/gui/src/views/cockpit/token-saver-panel.tsx`
- Modify: `apps/gui/src/cockpit/session-cockpit.tsx`
- Modify: `apps/gui/test/components/cockpit-panel-registry.test.tsx`
- Modify: `apps/gui/test/components/session-cockpit.test.tsx`
- Modify/Delete: `apps/gui/test/views/workspace-panels.test.tsx`, `apps/gui/test/views/session-overlay-panels.test.tsx`, `apps/gui/test/components/token-saver-panel.test.tsx`

- [ ] **Step 1: Update the registry test to the reduced set (RED)**

In `apps/gui/test/components/cockpit-panel-registry.test.tsx`, replace the expected panel-id list with the reduced set. Set the assertion to:

```ts
expect(COCKPIT_PANELS.map((p) => p.id)).toEqual(["transcript", "telemetry", "tasks"]);
expect(COCKPIT_TAB_GROUPS.map((g) => g.id)).toEqual(["transcript", "telemetry", "tasks"]);
```

(Open the file first to match its existing import + describe shape; change only the expected arrays.)

- [ ] **Step 2: Run — expect FAIL** (registry still has 11 panels)

Run: `pnpm --filter @megasaver/gui test test/components/cockpit-panel-registry.test.tsx`

- [ ] **Step 3: Reduce the registry**

Replace `apps/gui/src/cockpit/panel-registry.ts` with:

```ts
import type { CockpitPanel, CockpitTabGroup } from "./panel.js";
import { TasksCockpitPanel } from "./panels/session-overlay-panels.js";
import { TelemetryPanel } from "./panels/telemetry-panel.js";
import { TranscriptPanel } from "./panels/transcript-panel.js";

export const COCKPIT_PANELS: readonly CockpitPanel[] = [
  { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
  { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
  { id: "tasks", label: "Tasks", scope: "session", component: TasksCockpitPanel },
];

export const COCKPIT_TAB_GROUPS: readonly CockpitTabGroup[] = [
  { id: "transcript", label: "Transcript", panelIds: ["transcript"] },
  { id: "telemetry", label: "Telemetry", panelIds: ["telemetry"] },
  { id: "tasks", label: "Tasks", panelIds: ["tasks"] },
];

export function getPanel(id: string): CockpitPanel | undefined {
  return COCKPIT_PANELS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Delete the orphaned adapters + panel**

Trim `apps/gui/src/cockpit/panels/session-overlay-panels.tsx` to only the still-used `TasksCockpitPanel`:

```tsx
import { TasksPanel } from "../../views/cockpit/tasks-panel.js";
import type { CockpitPanelProps } from "../panel.js";

export function TasksCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <TasksPanel dir={dir} id={id} />;
}
```

Delete the files whose exports are now unused:

```bash
git rm apps/gui/src/cockpit/panels/workspace-panels.tsx
git rm apps/gui/src/views/cockpit/token-saver-panel.tsx
```

> `MemoryPanel` / `MemoryGraphPanel` / `TasksPanel` / the five `Workspace*Panel`s and the saver controls remain — only the cockpit *adapters* and the composite `token-saver-panel.tsx` go. The Memory/Workspace/Token-Saver *pages* (Tasks D–F) already import the underlying panels directly.

- [ ] **Step 5: Delete/trim the orphaned adapter tests**

```bash
git rm apps/gui/test/views/workspace-panels.test.tsx
git rm apps/gui/test/components/token-saver-panel.test.tsx
```

In `apps/gui/test/views/session-overlay-panels.test.tsx`, remove the `describe` blocks for `MemoryCockpitPanel`, `MemoryGraphCockpitPanel`, and `TokenSaverCockpitPanel` (keep any `TasksCockpitPanel` coverage). If the file only covered the removed adapters, `git rm` it instead.

- [ ] **Step 6: Add the right-rail layout to the cockpit**

In `apps/gui/src/cockpit/session-cockpit.tsx`, change the `<main>` region so the active panel sits beside a fixed rail holding telemetry + `SessionSaverStats`. Replace the `<main>` block (lines ~132-134) with:

```tsx
      <div className="flex flex-1 min-h-0 overflow-hidden max-lg:flex-col">
        <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {Body && <Body dir={dir} id={id} cwd={cwd} />}
        </main>
        <aside className="w-[26%] max-lg:w-full shrink-0 border-l max-lg:border-l-0 max-lg:border-t border-border p-4 overflow-y-auto flex flex-col gap-6">
          <SessionSaverStats dir={dir} id={id} />
        </aside>
      </div>
```

Add the import at the top of the file:

```tsx
import { SessionSaverStats } from "./panels/session-saver-stats.js";
```

> Telemetry already reachable via the cockpit nav; the rail specifically surfaces the always-on savings figure. Leaving telemetry as a nav panel + rail savings keeps the change minimal. (If you want telemetry pinned in the rail too, add `<TelemetryPanel dir={dir} id={id} />` under `SessionSaverStats` — optional, YAGNI-defer unless asked.)

- [ ] **Step 7: Fix the cockpit test**

`apps/gui/test/components/session-cockpit.test.tsx` may assert on the old nav groups (Workspace/Memory/Saver dropdowns). Update its expectations to the three-group nav (`Transcript`, `Telemetry`, `Tasks`) and add an assertion that the rail region `getByRole("region", { name: /savings/i })` is present. Stub `fetch` as the other cockpit tests do.

- [ ] **Step 8: Run the touched tests — expect PASS**

Run:
```bash
pnpm --filter @megasaver/gui test test/components/cockpit-panel-registry.test.tsx test/components/session-cockpit.test.tsx test/views/session-overlay-panels.test.tsx
```
Expected: PASS. (Do NOT run `pnpm typecheck` yet — sidebar.tsx enum gap closes in Task J.)

- [ ] **Step 9: Commit**

```bash
git add -A apps/gui/src/cockpit apps/gui/test/components apps/gui/test/views
git commit -m "refactor(gui): slim cockpit to session scope + savings rail"
```

---

## Task J: Flip the shell — sidebar + six-view enum

> **FOLDED INTO TASK H (2026-07-03):** implement this together with Task H as
> one atomic commit — see the correction note under Task H. The steps below
> are still the source for the enum + `app.tsx` + `app.test.tsx` code; execute
> them as part of the merged task, not as a separate commit.

The live flip: expand `ViewId`, swap the top-nav header for `Sidebar`, wire `activeWorkspace` + the three pages. Closes the typecheck gap from Tasks H–I.

**Files:**
- Modify: `apps/gui/src/view-id.ts`
- Modify: `apps/gui/test/view-id.test-d.ts`
- Modify: `apps/gui/src/app.tsx`
- Modify: `apps/gui/test/components/app.test.tsx`

- [ ] **Step 1: Update the type pin (RED)**

Replace `apps/gui/test/view-id.test-d.ts` body with:

```ts
import { describe, expectTypeOf, it } from "vitest";
import type { VIEW_IDS, ViewId } from "../src/view-id.js";

describe("ViewId tuple ordering", () => {
  it("pins alphabetic order", () => {
    expectTypeOf<typeof VIEW_IDS>().toEqualTypeOf<
      readonly ["agent-office", "agent-setup", "memory", "sessions", "token-saver", "workspace"]
    >();
  });

  it("ViewId is the union of the tuple members", () => {
    expectTypeOf<ViewId>().toEqualTypeOf<
      "agent-office" | "agent-setup" | "memory" | "sessions" | "token-saver" | "workspace"
    >();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/gui test test/view-id.test-d.ts`
Expected: FAIL (type mismatch — enum still 3 members).

- [ ] **Step 3: Expand the enum**

Replace `apps/gui/src/view-id.ts` with:

```ts
// Order: alphabetic (AA3 convention for human-facing closed enums).
// Nav display order lives in NAV_ORDER (components/sidebar.tsx), decoupled
// from this pinned tuple.
export const VIEW_IDS = [
  "agent-office",
  "agent-setup",
  "memory",
  "sessions",
  "token-saver",
  "workspace",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-office": "Agent office",
  "agent-setup": "Agent setup",
  memory: "Memory",
  sessions: "Sessions",
  "token-saver": "Token saver",
  workspace: "Workspace",
};
```

- [ ] **Step 4: Run the type pin — expect PASS**

Run: `pnpm --filter @megasaver/gui test test/view-id.test-d.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `app.tsx`**

Replace `apps/gui/src/app.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Sidebar } from "./components/sidebar.js";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import { type ClaudeSessionMeta, fetchClaudeSessions } from "./lib/claude-sessions-client.js";
import { type WorkspaceOption, deriveWorkspaceOptions } from "./lib/workspace-context.js";
import type { ViewId } from "./view-id.js";
import { AgentOfficeView } from "./views/agent-office-view.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { MemoryPage } from "./views/memory-page.js";
import { TokenSaverPage } from "./views/token-saver-page.js";
import { WorkspacePage } from "./views/workspace-page.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("sessions");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Derive the workspace options once for the picker-backed pages.
  useEffect(() => {
    let live = true;
    fetchClaudeSessions(50, 0)
      .then((list) => {
        if (!live) return;
        const opts = deriveWorkspaceOptions(list);
        setWorkspaces(opts);
        setActiveKey((k) => k ?? opts[0]?.key ?? null);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const navigate = (next: ViewId): void => {
    setView(next);
    if (next !== "sessions") setSelected(null);
  };

  return (
    <div className="flex min-h-screen bg-background text-text-primary font-sans">
      <Sidebar active={view} onNavigate={navigate} />
      <main className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <div data-testid="page-container" className="flex flex-col flex-1 min-h-0 w-full">
          {view === "agent-setup" ? (
            <AgentSetupDoctor />
          ) : view === "agent-office" ? (
            <AgentOfficeView />
          ) : view === "token-saver" ? (
            <TokenSaverPage options={workspaces} activeKey={activeKey} onWorkspaceChange={setActiveKey} />
          ) : view === "memory" ? (
            <MemoryPage options={workspaces} activeKey={activeKey} onWorkspaceChange={setActiveKey} />
          ) : view === "workspace" ? (
            <WorkspacePage options={workspaces} activeKey={activeKey} onWorkspaceChange={setActiveKey} />
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

- [ ] **Step 6: Update `app.test.tsx`**

Open `apps/gui/test/components/app.test.tsx`. It currently asserts the top-nav's three items and default view. Update it to:
- stub `fetch` (the new `useEffect` calls `/api/claude-sessions`) — return `[]`.
- assert the `Sidebar` renders (`getByRole("navigation", { name: /main/i })`) with six buttons.
- assert clicking "Token saver" swaps the page to the Token Saver heading.
- keep/adjust the default-view assertion (default is `sessions` → `WorkspaceSessionList`).

Concretely, the core cases:

```tsx
vi.stubGlobal("fetch", vi.fn(async () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));

it("defaults to the Sessions view with a six-item sidebar", async () => {
  render(<App />);
  const nav = screen.getByRole("navigation", { name: /main/i });
  expect(nav.querySelectorAll("button").length).toBe(6);
});

it("navigates to Token saver", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Token saver" }));
  expect(await screen.findByRole("heading", { name: /token saver/i })).toBeTruthy();
});
```

(Preserve the file's existing imports/`afterEach(cleanup)`; replace only the stale top-nav assertions.)

- [ ] **Step 7: Full verify — expect PASS**

Run: `pnpm --filter @megasaver/gui verify` (or from root `pnpm verify`)
Expected: biome + tsc + vitest all green. The typecheck gap from Tasks H–I is now closed (enum has the six members `sidebar.tsx`/pages reference).

Fix any residual type/lint errors surfaced here (e.g. an unused import left by the flip).

- [ ] **Step 8: Commit**

```bash
git add apps/gui/src/view-id.ts apps/gui/src/app.tsx apps/gui/test/view-id.test-d.ts apps/gui/test/components/app.test.tsx
git commit -m "feat(gui): live sidebar shell + six-view routing"
```

---

## Task K: Sessions home summary strip

Add a three-stat strip (Workspaces / Sessions / Live) to the home list, from the already-fetched session list — no new fetch, no aggregate endpoint. (The token-saved daily total is deferred per the spec; the per-session figure lives in the cockpit rail.)

**Files:**
- Modify: `apps/gui/src/views/workspace-session-list.tsx`
- Modify: `apps/gui/test/components/workspace-session-list.test.tsx`

- [ ] **Step 1: Update the test (RED)**

Open `apps/gui/test/components/workspace-session-list.test.tsx`. It currently renders the list and likely asserts the heading text `"Claude sessions"` and/or the `"N workspaces · M sessions"` string. Change the heading assertion to `"Sessions"` and add a case asserting the three summary labels + counts. Using the file's existing fetch-stub + session fixtures, add:

```tsx
it("shows a Workspaces / Sessions / Live summary strip", async () => {
  // (reuse the file's existing successful-list stub returning >=1 session)
  render(<WorkspaceSessionList onSelect={() => {}} />);
  expect(await screen.findByText("Workspaces")).toBeTruthy();
  expect(screen.getByText("Sessions")).toBeTruthy();
  expect(screen.getByText("Live")).toBeTruthy();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/gui test test/components/workspace-session-list.test.tsx`
Expected: FAIL (heading is still "Claude sessions"; no "Workspaces"/"Live" labels).

- [ ] **Step 3: Implement the strip**

In `apps/gui/src/views/workspace-session-list.tsx`:

Compute a live count near the existing `groups` line:

```tsx
  const groups = groupSessionsByCwd(sessions);
  const liveCount = sessions.filter((s) => nowMs - s.mtimeMs < LIVE_WINDOW_MS).length;
```

Replace the current header block:

```tsx
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Claude sessions</h2>
        <span className="text-xs text-text-muted">
          {groups.length} workspace{groups.length === 1 ? "" : "s"} · {sessions.length} session
          {sessions.length === 1 ? "" : "s"}
        </span>
      </div>
```

with:

```tsx
      <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-4">Sessions</h2>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Workspaces" value={groups.length} />
        <SummaryCard label="Sessions" value={sessions.length} />
        <SummaryCard label="Live" value={liveCount} />
      </div>
```

Add the helper at the bottom of the file (outside the component):

```tsx
function SummaryCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/gui test test/components/workspace-session-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/workspace-session-list.tsx apps/gui/test/components/workspace-session-list.test.tsx
git commit -m "feat(gui): sessions home summary strip"
```

---

## Task L: Docs — DESIGN.md v3 + wiki

**Files:**
- Modify: `apps/gui/DESIGN.md`
- Modify: `wiki/entities/gui.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Update `DESIGN.md`**

Reflect the shipped v3 in `apps/gui/DESIGN.md`:
- Accent: black → amber (`#b45309` light / `#f59e0b` dark; `accent-fg` `#fff7ed` / `#0c0d0f`); note contrast-pinned by `test/styles/accent-contrast.test.ts`.
- Navigation: top-nav pill → persistent left `Sidebar` (six items, amber active pill, daemon footer); display order in `NAV_ORDER`, decoupled from the alphabetic `VIEW_IDS` pin.
- Information architecture: six pages (Sessions, Token Saver, Memory, Workspace, Agent Office, Setup); the workspace-context seam (active workspace → representative session) for the session-anchored Memory/saver routes.
- Cockpit: slim — transcript + right rail (`SessionSaverStats`), session-scoped nav (Transcript/Telemetry/Tasks).
- Update the "Migration from v1" section to a "Migration from v2" note.

- [ ] **Step 2: Update the wiki entity + log**

In `wiki/entities/gui.md`, append a `## GUI Redesign v3 (2026-07-03)` section summarising: sidebar shell, six pages, amber accent, workspace-context seam (frontend-only, no bridge route), slim cockpit + savings rail. Cite the spec + plan paths.

Append to `wiki/log.md`:
```markdown
## [2026-07-03] feature | gui-redesign-v3
Sidebar shell + amber editorial redesign. Six pages (Sessions/Token Saver/
Memory/Workspace/Agent Office/Setup). Frontend-only workspace-context seam
resolves active workspace → representative session for the session-anchored
Memory/saver routes (no bridge change). Slim cockpit: transcript + savings
rail. Spec: docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md.
Plan: docs/superpowers/plans/2026-07-03-gui-redesign-v3.md.
```

- [ ] **Step 3: Final full verify**

Run: `pnpm --filter @megasaver/gui verify`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/gui/DESIGN.md wiki/entities/gui.md wiki/log.md
git commit -m "docs(gui): record v3 redesign in DESIGN.md + wiki"
```

---

## Verification evidence (Definition of Done)

Before claiming done (per `docs/conventions/definition-of-done.md`):

1. `pnpm --filter @megasaver/gui verify` green (biome + tsc + vitest) — capture output.
2. Smoke run: `pnpm --filter @megasaver/gui dev`, then via the preview tools confirm: sidebar renders six items; each page loads without console errors; a session opens the slim cockpit with the savings rail; the amber active pill shows on the current page; dark mode (emulate `prefers-color-scheme: dark`) shows the brightened amber. Capture a screenshot.
3. External review: dispatch `code-reviewer` in a fresh context on the branch diff (author ≠ reviewer).
4. Zero pending TodoWrite items.
5. No changeset needed — `@megasaver/gui` is `private: true` (no public API surface change).

## Notes / deliberate simplifications

- **ponytail:** the workspace picker single-sources from the recent-session list (Task B comment). A workspace with no recent session won't appear; acceptable for a single-dev tool. Upgrade path: back the picker with `fetchWorkspaces()` and resolve `rep` lazily.
- **ponytail:** the cockpit rail carries savings only; telemetry stays a nav panel. Add `<TelemetryPanel>` to the rail only if the always-visible telemetry is requested.
- **Pre-existing, not touched:** `src/views/claude-sessions-view.tsx` + its test appear to be legacy (not imported by `app.tsx`). Left as-is — flag for a separate cleanup, do not delete under this change.
