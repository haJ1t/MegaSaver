# conventions:sync → CLAUDE.md (full reconciliation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CLAUDE.md` a managed consumer of `pnpm conventions:sync`, reconciling the bidirectional CLAUDE↔`docs/conventions` drift so all agent files regenerate from one source.

**Architecture:** Reuse the existing verbatim-sentinel-block engine unchanged; add a `claude-md` consumer to the manifest (pure data). Reconcile each section's content into canonical `docs/conventions/*.md` via a 3-way sort (shared→source, agent-specific→CLAUDE hand-zone, conflict→human). Bootstrap CLAUDE.md with 14 sentinel pairs, then `--write` fills them.

**Tech Stack:** Node `--experimental-strip-types`, Vitest, Biome, the existing `scripts/conventions-sync` engine.

Spec: `docs/superpowers/specs/2026-06-11-conventions-sync-claude-md-design.md`.

---

## File structure

- `scripts/conventions-sync/src/manifest.ts` — add `claude-md` ConsumerSpec (14 blocks), placed first.
- `scripts/conventions-sync/test/manifest.test.ts` + `manifest.test-d.ts` — update frozen-order / union assertions.
- `docs/conventions/wiki-first.md` — NEW canonical source (§0).
- `docs/conventions/{skill-routing,agent-routing,language,anti-patterns,…}.md` — enriched where CLAUDE led.
- `CLAUDE.md` — bootstrap sentinels; agent-specific content kept outside blocks.
- `AGENTS.md`, `.cursor/rules/*.mdc` — re-`--write` (content follows enriched sources).

---

## Phase 0: Worktree deps

### Task 0: Install deps in the worktree

**Files:** none (env only)

- [ ] **Step 1:** Run `pnpm install` in the worktree root.
  Run: `cd <worktree> && pnpm install`
  Expected: completes; `node_modules/` present.
- [ ] **Step 2:** Sanity-run the existing suite green BEFORE changes.
  Run: `pnpm conventions:test`
  Expected: PASS (baseline).

---

## Phase 1: Mechanism (TDD) — add the `claude-md` consumer

### Task 1: Manifest consumer + tests

**Files:**
- Modify: `scripts/conventions-sync/src/manifest.ts`
- Test: `scripts/conventions-sync/test/manifest.test.ts`, `manifest.test-d.ts`

- [ ] **Step 1: Write the failing tests.** Update `manifest.test.ts` frozen assertions to expect `claude-md` first, and the new path/union. Add to the three affected `it()` blocks:

```ts
// CONSUMERS launch-order is frozen
expect(CONSUMERS.map((c) => c.id)).toEqual([
  "claude-md",
  "agents-md",
  "cursor-context",
  "cursor-conventions",
  "cursor-discipline",
]);

// CONSUMERS paths map to the real consumer files
expect(CONSUMERS.map((c) => c.path)).toEqual([
  "CLAUDE.md",
  "AGENTS.md",
  ".cursor/rules/mega-context.mdc",
  ".cursor/rules/mega-conventions.mdc",
  ".cursor/rules/mega-discipline.mdc",
]);

// ConsumerId union
expectTypeOf<ConsumerId>().toEqualTypeOf<
  "claude-md" | "agents-md" | "cursor-context" | "cursor-conventions" | "cursor-discipline"
>();
```

Add a `claude-md` block-count assertion:

```ts
it("claude-md consumer declares the 14 §0–§13 blocks in document order", () => {
  const claude = CONSUMERS.find((c) => c.id === "claude-md");
  expect(claude?.path).toBe("CLAUDE.md");
  expect(claude?.blocks.map((b) => b.id)).toEqual([
    "wiki-first", "mission", "repo-layout", "stack-and-commands",
    "process-discipline", "skill-routing", "agent-routing",
    "multi-agent-dogfood", "code-conventions", "definition-of-done",
    "git-and-commits", "language", "risk-modes", "anti-patterns",
  ]);
  expect(claude?.blocks.map((b) => b.source)).toEqual([
    "wiki-first.md", "mission.md", "repo-layout.md", "stack-and-commands.md",
    "process-discipline.md", "skill-routing.md", "agent-routing.md",
    "multi-agent-dogfood.md", "code-conventions.md", "definition-of-done.md",
    "git-and-commits.md", "language.md", "risk-modes.md", "anti-patterns.md",
  ]);
});
```

And in `manifest.test-d.ts` add `const e: ConsumerId = "claude-md"; void e;`.

- [ ] **Step 2: Run to verify FAIL.**
  Run: `pnpm conventions:test -t manifest`
  Expected: FAIL (claude-md absent / order mismatch).

- [ ] **Step 3: Implement.** In `manifest.ts`, prepend the `claude-md` ConsumerSpec to `CONSUMERS` and update the ordering comment to "claude-md first (canonical full reference), then AGENTS.md, then .cursor/rules":

```ts
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
```

- [ ] **Step 4: Run to verify PASS.**
  Run: `pnpm conventions:test -t manifest`
  Expected: PASS.

- [ ] **Step 5: Commit.**
  `git add -A && git commit -m "feat(conventions): add claude-md consumer (manifest)"`

---

## Phase 2: Reconciliation — canonical sources

For each of the 14 sections, produce the canonical source body by the spec's **3-way classification** (shared→source, agent-specific→hand-zone list, conflict→FLAG). Inputs per section: current `CLAUDE.md §N`, current `docs/conventions/<src>.md`, current `AGENTS.md` block (= source). Output per section: (a) updated `docs/conventions/<src>.md`; (b) a recorded list of CLAUDE-only agent-specific lines to keep in CLAUDE's hand-zone in Phase 3; (c) any conflict flags.

**Acceptance per section (HIGH-risk gate):** an independent verifier confirms **no normative claim from either input was dropped or altered** — only re-bucketed. Agent-neutral phrasing: `## H2` sub-headings, no "this file"/Claude-only tool names in the source.

Section leads (from the similarity scan — guidance, not a shortcut):
- Source already richer (enrich CLAUDE side via source on `--write`; source likely needs little/no change): §1 mission, §2 repo-layout, §3 stack, §4 process, §7 dogfood, §8 code-conv, §9 DoD, §10 git, §12 risk-modes.
- CLAUDE richer (lift shared parts INTO source; keep Claude-only parts in hand-zone): §5 skill-routing (keep §5c OMC roster + §5a–d numbering in hand-zone), §6 agent-routing (keep specific agent names if Claude-only), §11 language, §13 anti-patterns.
- New: §0 wiki-first → `docs/conventions/wiki-first.md`, agent-neutral (drop "right pane: Claude Code"; tmux/MCP-bridge specifics → hand-zone).

### Task 2.{0..13}: Reconcile each section

**Files:** `docs/conventions/<src>.md` (one per task)

- [ ] **Step 1:** Read both inputs for the section.
- [ ] **Step 2:** Classify every claim (shared / agent-specific / conflict). Write the merged agent-neutral superset to `docs/conventions/<src>.md`. Record agent-specific CLAUDE-only lines for Phase 3. Flag conflicts.
- [ ] **Step 3 (verify):** Independent check — diff merged source against both inputs; assert no shared claim lost, no agent-specific leak into source. Fix until clean.
- [ ] **Step 4:** Commit per logical batch: `git add docs/conventions && git commit -m "docs(conventions): reconcile §N <name> into canonical source"`

> Conflict flags, if any, are surfaced to the user before Phase 3 `--write`. Do not invent a resolution.

---

## Phase 3: Bootstrap CLAUDE.md + sync

### Task 3: Insert sentinels and fill from source

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1:** For each §0–§13, wrap the section body in
  `<!-- conventions:start id="<id>" source="<src>.md" -->` … `<!-- conventions:end id="<id>" -->`, keeping the `## §N Title` heading and trailing `Source:` link OUTSIDE the block. Place each section's recorded agent-specific hand-zone lines OUTSIDE the block (below it, above the `Source:` link). Add §0 from `wiki-first` (new).
- [ ] **Step 2: Fill blocks from source.**
  Run: `pnpm conventions:sync`  (write mode)
  Expected: `CLAUDE.md` block bodies replaced verbatim with sources; status `wrote`.
- [ ] **Step 3: Verify clean.**
  Run: `pnpm conventions:check`
  Expected: exit 0, no drift on any consumer.
- [ ] **Step 4: Inspect the CLAUDE.md diff.** Confirm only (a) sub-heading cosmetic changes, (b) intended enrichment, (c) preserved hand-zone agent-specific content. No unexpected content loss.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(conventions): manage CLAUDE.md via sync (bootstrap + wiki-first §0)"`

---

## Phase 4: Regenerate AGENTS.md / .mdc

### Task 4: Propagate enriched sources

**Files:** `AGENTS.md`, `.cursor/rules/*.mdc` (engine-written)

- [ ] **Step 1:** `pnpm conventions:sync` already wrote all consumers in Phase 3; confirm with `git status`.
- [ ] **Step 2:** Add the `wiki-first` block to the `agents-md` consumer in `manifest.ts` (AGENTS.md gets §0 too) + a manifest test assertion; re-run `pnpm conventions:test -t manifest` green; `pnpm conventions:sync`; `pnpm conventions:check` green.
- [ ] **Step 3:** Review AGENTS/.mdc diffs — content changes follow the shared merge (expected; closes the prior AGENTS↔CLAUDE disagreement).
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(conventions): wiki-first block in AGENTS.md + regenerate consumers"`

---

## Phase 5: Verify + review

### Task 5: DoD gate

- [ ] **Step 1:** `pnpm conventions:test` → PASS.
- [ ] **Step 2:** `pnpm verify` (lint + typecheck + test) → green. (`conventions:check` is folded in → guards CLAUDE.md drift now.)
- [ ] **Step 3:** Capture evidence (command outputs).
- [ ] **Step 4:** Critic review (HIGH risk per §12) — author ≠ reviewer. Focus: no governance claim dropped, no agent-specific leak into shared sources, conflict flags resolved.
- [ ] **Step 5:** DoD item 10 (agent files changed) — note in PR. No changeset (no published-package public-API change; `scripts/` + docs only).
- [ ] **Step 6:** `superpowers:finishing-a-development-branch` → PR.

---

## Self-review notes

- Spec coverage: mechanism (Task 1) ✓, reconciliation method (Task 2.x) ✓, §0 B1 ✓, bootstrap/insert-not-supported handling (Task 3) ✓, AGENTS/.mdc regen (Task 4) ✓, HIGH-risk content-preservation gate (Task 2 Step 3 + Task 5 critic) ✓, worktree deps (Task 0) ✓.
- Type consistency: block ids/sources identical between Task 1 manifest and Task 3 sentinels.
- Open risk: conflict-bucket items are surfaced, not auto-resolved (spec rule).
