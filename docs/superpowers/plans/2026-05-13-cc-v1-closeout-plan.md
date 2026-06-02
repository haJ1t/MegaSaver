# Mega Saver v1.0 CLOSEOUT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "all AA1 BB sub-PRs merged" into a tagged, shippable `v1.0.0` — prove the AA1 §1 done-list end-to-end, fill release gaps (docs, version bump, tag), and record the §2a extraction outcome.

**Architecture:** This is the **capstone** PR. It assumes BB7b/BB8/BB10/BB11 are merged (so `apps/cli/src/commands/mcp/`, the real `@megasaver/mcp-bridge`, the GUI `token-saver-*`/`agent-setup-*` components + bridge routes, and `packages/connectors/shared/src/context-gate-block.ts` all exist). It writes ONE end-to-end test, ONE enum-pin-audit test, README + wiki docs, ONE coordinated `major` changeset, then version-bumps and tags. Risk **MEDIUM** — integration only; the CRITICAL spawn surface already shipped and was reviewed in BB7b/BB8.

**Tech Stack:** Node 22, TypeScript strict ESM, Vitest, pnpm workspaces, Turborepo, Changesets, Citty CLI. Spec: `docs/superpowers/specs/2026-05-13-cc-v1-closeout-design.md`.

---

## File / area map

**Create:**
- `apps/cli/test/e2e/v1-closeout-flow.test.ts` — the end-to-end acceptance test (Task 1).
- `apps/cli/test/enum-pin-audit.test.ts` — the AA1 §17 enum-pin structural audit (Task 2).
- `.changeset/cc-v1-release.md` — the coordinated `major` changeset for all 14 packages (Task 5).
- `wiki/entities/{policy,content-store,output-filter,retrieval,stats,mcp-bridge}.md` — entity pages for the 6 packages lacking one (Task 4).
- `wiki/decisions/context-gate-extraction.md` — §2a folded-vs-extracted record (Task 8).
- `docs/superpowers/RELEASE-NOTES-v1.0.0.md` — release notes (Task 7).

**Modify:**
- `README.md` — add "Mega Saver Mode" section; fold `mcp-bridge` out of "Future packages" (Task 3).
- `wiki/index.md` — add v1.0 Status entry + link the 6 new entity pages (Task 4 + 8).
- `wiki/log.md` — append the v1.0 close-out log entry (Task 4) + the §2a record entry (Task 8).
- `wiki/entities/{core,gui,cli,connectors-shared}.md` — note the AA1 additions (Task 4).
- every workspace `package.json` (14 packages) — `version: 1.0.0` (Task 6, via `changeset version` — NOT hand-edited).

**Run-only (no file authored):** `pnpm build`, `pnpm version-packages`, `pnpm install`, `pnpm verify`, `git tag` (Tasks 6, 9).

**Verified repo facts (do NOT re-derive):**
- `mega` bin = `apps/cli/dist/cli.js` (built by `pnpm build`).
- `session create` takes a POSITIONAL `projectName` + `--agent` (required) + `--title` + `--store` + `--json`.
- `output exec`/`file` take a POSITIONAL `sessionId`, `--intent`, `--store`, `--json`; `exec` takes `-- <cmd> [args…]`.
- `session saver enable` takes a POSITIONAL `sessionId`, `--mode`, `--store`, `--json`.
- Store resolution honors `--store`, else `XDG_DATA_HOME`, else `HOME`. The e2e passes `--store <tmp>` to EVERY leg for hermeticity.
- GUI bridge smoke pattern: `createBridgeHandler({ registry, … })` + `node:http` `createServer` + `fetch` (see `apps/gui/test/smoke/boot.test.ts`).
- `output exec` JSON envelope: `{ sessionId, result: { summary, excerpts, rawBytes, returnedBytes, bytesSaved, savingRatio, chunkSetId? } }`.
- Release = **Changesets**: `pnpm version-packages` = `changeset version`; all 14 pkgs `private:true` + `version:"0.0.0"`.

---

## Task 1: End-to-end acceptance test (the v1.0 flow)

Walks plan L1672–L1702 (AA1 §1 done-list → observables). This is TDD-style at the integration level: we write the expected observables, run against the REAL built binary + in-process bridge, and confirm real output. Build the CLI first so `dist/cli.js` exists.

**Files:**
- Create: `apps/cli/test/e2e/v1-closeout-flow.test.ts`

- [ ] **Step 1: Build the CLI so the real binary exists**

Run: `pnpm --filter @megasaver/cli build`
Expected: exit 0; `apps/cli/dist/cli.js` present (`ls apps/cli/dist/cli.js`).

- [ ] **Step 2: Write the failing e2e test**

Create `apps/cli/test/e2e/v1-closeout-flow.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../../../apps/gui/bridge/handler.js";

// Real built binary (Task 1 Step 1 builds it).
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function mega(args: string[], store: string): { stdout: string } {
  // Hermetic env: pin HOME/XDG to the temp store so no real store is touched.
  const stdout = execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: store, XDG_DATA_HOME: store, NODE_ENV: "production" },
  });
  return { stdout };
}

describe("v1.0 closeout end-to-end flow (plan L1672–L1702)", () => {
  let store: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    store = mkdtempSync(join(tmpdir(), "ms-e2e-"));
    // GUI bridge over the SAME on-disk store the CLI writes to (AA1 §10/§13 paths).
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const handler = createBridgeHandler({ registry });
    server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(store, { recursive: true, force: true });
  });

  it("[A1+A2] seeds a project+session, enables Balanced, persists tokenSaver", () => {
    // Plan 1–3: create project + session (projectName is POSITIONAL).
    mega(["project", "create", "demo", "--store", store], store);
    const created = JSON.parse(
      mega(["session", "create", "demo", "--agent", "claude-code", "--title", "first session", "--store", store, "--json"], store).stdout,
    ) as { id: string; tokenSaver?: unknown };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.tokenSaver).toBeUndefined(); // pre-enable

    // Plan 4–5: enable Mega Saver Mode → Balanced.
    const enabled = JSON.parse(
      mega(["session", "saver", "enable", created.id, "--mode", "balanced", "--store", store, "--json"], store).stdout,
    ) as { sessionId: string; tokenSaver: { enabled: boolean; mode: string; maxReturnedBytes: number } };
    expect(enabled.tokenSaver.enabled).toBe(true);
    expect(enabled.tokenSaver.mode).toBe("balanced");
    expect(enabled.tokenSaver.maxReturnedBytes).toBe(12_000); // modeToBudget("balanced"), AA1 §4a
  });

  it("[A3+A5] output exec spawns a gated child, returns savingRatio, writes chunkSet + stats", () => {
    const sid = JSON.parse(
      mega(["session", "create", "demo", "--agent", "claude-code", "--title", "exec session", "--store", store, "--json"], store).stdout,
    ).id as string;
    mega(["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"], store);

    // Plan 8–9: agent action (CLI twin of mega_run_command; AA1 §8d same orchestrator).
    // `node -e` is an ALLOWED_COMMAND (AA1 §9b); emits stdout+stderr (combined-capture path).
    const out = JSON.parse(
      mega(
        ["output", "exec", sid, "--intent", "auth failures", "--store", store, "--json",
          "--", process.execPath, "-e", "console.error('FAIL auth.test'); console.log('ok')"],
        store,
      ).stdout,
    ) as { sessionId: string; result: { rawBytes: number; returnedBytes: number; bytesSaved: number; savingRatio: number; chunkSetId?: string } };

    expect(out.result.rawBytes).toBeGreaterThan(0);
    expect(out.result.returnedBytes).toBeGreaterThan(0);
    expect(out.result.bytesSaved).toBeGreaterThanOrEqual(0);
    expect(typeof out.result.savingRatio).toBe("number");
    expect(out.result.savingRatio).toBeGreaterThanOrEqual(0);
    expect(out.result.savingRatio).toBeLessThanOrEqual(1);
    expect(out.result.chunkSetId).toBeTruthy();

    // Plan 9: raw chunkSet persisted (AA1 §10a path).
    const contentDir = join(store, "megasaver", "content");
    const allFiles: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : allFiles.push(p); } };
    walk(contentDir);
    const chunkFile = allFiles.find((f) => f.endsWith(`${out.result.chunkSetId}.json`));
    expect(chunkFile).toBeTruthy();
    const chunkSet = JSON.parse(readFileSync(chunkFile!, "utf8")) as { chunkSetId: string; chunks: unknown[]; rawBytes: number };
    expect(chunkSet.chunkSetId).toBe(out.result.chunkSetId);
    expect(Array.isArray(chunkSet.chunks)).toBe(true);

    // Plan 9: stats event persisted (AA1 §13b paths).
    const statsDir = join(store, "megasaver", "stats");
    const statsFiles: string[] = [];
    walk(statsDir);
    const summaryFile = statsFiles.find((f) => f.endsWith(`${sid}.json`));
    const eventsFile = statsFiles.find((f) => f.endsWith(`${sid}.events.jsonl`));
    expect(summaryFile).toBeTruthy();
    expect(eventsFile).toBeTruthy();
    const summary = JSON.parse(readFileSync(summaryFile!, "utf8")) as { eventsTotal: number };
    expect(summary.eventsTotal).toBeGreaterThanOrEqual(1);
    expect(readFileSync(eventsFile!, "utf8").trim().split("\n").length).toBeGreaterThanOrEqual(1);
  });

  it("[A4+A7] mcp repair installs config + sync writes the CONTEXT_GATE connector block", () => {
    // Plan 6: install/repair MCP, sync connector.
    mega(["mcp", "repair", "--target", "claude-code", "--store", store, "--json"], store);
    const status = JSON.parse(mega(["mcp", "status", "--store", store, "--json"], store).stdout) as Array<{ id: string; mcpInstalled: boolean; connectorSynced: boolean }>;
    const cc = status.find((s) => s.id === "claude-code");
    expect(cc?.mcpInstalled).toBe(true);

    // AA1 §7: CONTEXT_GATE block coexists with the legacy block. The connector writes
    // into the PROJECT root CLAUDE.md; the project root defaults to cwd at create time,
    // so we read it via `connector status` rather than guessing a path.
    const sid = JSON.parse(
      mega(["session", "create", "demo", "--agent", "claude-code", "--title", "cg session", "--store", store, "--json"], store).stdout,
    ).id as string;
    mega(["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"], store);
    mega(["connector", "sync", "--target", "claude-code", "--project", "demo", "--store", store], store);
    // The synced file path is reported by `connector status --json` (relativePath).
    const conn = JSON.parse(mega(["connector", "status", "--target", "claude-code", "--project", "demo", "--store", store, "--json"], store).stdout) as Array<{ relativePath: string }>;
    const rel = conn[0]!.relativePath;
    const body = readFileSync(join(process.cwd(), rel), "utf8");
    expect(body).toContain("<!-- MEGA SAVER:BEGIN -->"); // legacy still present
    expect(body).toContain("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->"); // additive CG block
    expect(body).toContain("mega_run_command"); // block instructs the agent (AA1 §7)
    const cgStart = body.indexOf("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->");
    const cgEnd = body.indexOf("<!-- MEGA SAVER:CONTEXT_GATE END -->");
    expect(cgEnd - cgStart).toBeGreaterThan(0); // block bytes > 0

    // F4-locked: BB8 `mega mcp status` reports `connectorSynced` per AA1 §5c.
    // After `connector sync` wrote the block, the flag MUST be true.
    const after = JSON.parse(mega(["mcp", "status", "--store", store, "--json"], store).stdout) as Array<{ id: string; mcpInstalled: boolean; connectorSynced: boolean }>;
    const ccAfter = after.find((s) => s.id === "claude-code");
    expect(ccAfter?.mcpInstalled).toBe(true);
    expect(ccAfter?.connectorSynced).toBe(true);
  });

  it("[A6] GUI bridge serves token-saver status + stats for the enabled session", async () => {
    const sid = JSON.parse(
      mega(["session", "create", "demo", "--agent", "claude-code", "--title", "gui session", "--store", store, "--json"], store).stdout,
    ).id as string;
    mega(["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"], store);
    mega(["output", "exec", sid, "--intent", "x", "--store", store, "--json", "--", process.execPath, "-e", "console.log('hello world '.repeat(50))"], store);

    const statusRes = await fetch(`${baseUrl}/api/sessions/${sid}/token-saver/status`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { tokenSaver: { enabled: boolean; mode: string } };
    expect(status.tokenSaver.enabled).toBe(true);
    expect(status.tokenSaver.mode).toBe("balanced");

    const statsRes = await fetch(`${baseUrl}/api/sessions/${sid}/token-saver/stats`);
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as { savingRatio: number; rawBytesTotal: number; returnedBytesTotal: number };
    expect(typeof stats.savingRatio).toBe("number");
    expect(stats.savingRatio).toBeGreaterThanOrEqual(0);
    expect(stats.savingRatio).toBeLessThanOrEqual(1);
    expect(stats.rawBytesTotal).toBeGreaterThan(0);
    expect(stats.returnedBytesTotal).toBeGreaterThan(0);
  });

  it("[A4+A6] GUI AgentSetupDoctor drives /api/mcp/* end-to-end (BB8-backed ops)", async () => {
    // AA1 §1 [A4]/[A6]: the GUI doctor half. BB8's buildMcpSetupOps is wired into
    // apps/gui/bridge/server.ts so /api/mcp/* runs real install/repair/status ops.
    // GET status: per-agent flags present and well-typed (AA1 §5c, §6c).
    const statusRes = await fetch(`${baseUrl}/api/mcp/status`);
    expect(statusRes.status).toBe(200);
    const doctor = (await statusRes.json()) as {
      agents: Array<{ id: string; mcpInstalled: boolean; connectorSynced: boolean; restartRequired: boolean; restartHint: string }>;
    };
    expect(Array.isArray(doctor.agents)).toBe(true);
    expect(doctor.agents.length).toBeGreaterThan(0);
    const ccBefore = doctor.agents.find((a) => a.id === "claude-code");
    expect(ccBefore).toBeDefined();
    expect(typeof ccBefore!.mcpInstalled).toBe("boolean");
    expect(typeof ccBefore!.connectorSynced).toBe("boolean");
    expect(typeof ccBefore!.restartRequired).toBe("boolean");
    expect(typeof ccBefore!.restartHint).toBe("string");

    // Pick a missing-config agent so repair has a visible before→after effect.
    // `aider` is a known target the prior legs never installed (AA1 §5c targets).
    const missing = doctor.agents.find((a) => a.mcpInstalled === false) ?? doctor.agents.find((a) => a.id === "aider");
    expect(missing).toBeDefined();
    const target = missing!.id;

    // POST repair: install MCP config + sync the connector block for that agent.
    const repairRes = await fetch(`${baseUrl}/api/mcp/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(repairRes.status).toBe(200);

    // GET status again: the repaired agent's flags MUST flip to true (AA1 §5c).
    const afterRes = await fetch(`${baseUrl}/api/mcp/status`);
    expect(afterRes.status).toBe(200);
    const afterDoctor = (await afterRes.json()) as {
      agents: Array<{ id: string; mcpInstalled: boolean; connectorSynced: boolean }>;
    };
    const repaired = afterDoctor.agents.find((a) => a.id === target);
    expect(repaired).toBeDefined();
    expect(repaired!.mcpInstalled).toBe(true);
    expect(repaired!.connectorSynced).toBe(true);
  });
});
```

- [ ] **Step 3: Run the e2e and READ the real output**

Run: `pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli exec vitest run test/e2e/v1-closeout-flow.test.ts`
Expected (first run, TDD): observe the ACTUAL output. Likely mismatches to fix against real behavior — they are evidence, not failures to paper over:
  - The store sub-path: code resolves `<store>/megasaver/...`. If the on-disk layout differs (e.g. no `megasaver` segment), correct the `join(store, "megasaver", "content")` / `"stats"` literals to match the real path printed by the failing assertion. Do NOT change production code — adjust the test to the real resolved path.
  - The bridge route prefix: if `GET /api/sessions/:id/token-saver/status` 404s, read `apps/gui/bridge/routes/token-saver.ts` (BB10) for the actual registered path and fix the URL.
  - The GUI doctor route prefix + payload: if `GET /api/mcp/status` 404s or the body is not `{ agents: [...] }` (e.g. a bare array, or `POST /api/mcp/install` instead of `repair`), read `apps/gui/bridge/routes/mcp-setup.ts` (BB11) for the registered paths and the response/body shape and adjust the URLs, the `{ agents }` destructure, and the per-agent field names. Do NOT change production code.
  - The `connector sync` flag: if `--project` is positional there too, adjust (mirror Task-1 verified facts; `connector sync` in this repo uses `--target` + `--project`).
  - `mcp status --json` shape: if it is an object keyed by target rather than an array, adjust the `.find` accordingly (read `apps/cli/src/commands/mcp/status.ts`, BB8). This applies to BOTH the CLI `mcp status` legs and the post-sync `connectorSynced` assertion.

- [ ] **Step 4: Iterate to green against real behavior**

Re-run Step 3 until all five `it` blocks pass ([A1+A2], [A3+A5], [A4+A7], [A6], [A4+A6]). Every fix is a test-only adjustment to match the REAL merged behavior of BB7b/BB8/BB10/BB11 (this PR adds no feature code). If an assertion reveals a genuine product gap (e.g. `savingRatio` absent from the `/stats` envelope, or `/api/mcp/repair` not flipping `connectorSynced`), STOP and flag it to the parent — that is a BB-PR regression, not a closeout fix.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/e2e/v1-closeout-flow.test.ts
git commit -m "test(cli): v1.0 closeout end-to-end flow"
```

---

## Task 2: Closed-enum pin audit (AA1 §17)

Structural guard that every AA1 §17 pin file exists and is non-empty. Catches a dropped pin during integration. (Per-enum tuple ordering is asserted by the pins themselves under `pnpm typecheck`.)

**Files:**
- Create: `apps/cli/test/enum-pin-audit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/enum-pin-audit.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AA1 §17: every closed enum introduced by the epic has a tuple-ordering pin.
// Paths are relative to the monorepo root (apps/cli is two levels under root).
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PIN_FILES: ReadonlyArray<readonly [enumName: string, relPath: string]> = [
  ["TokenSaverMode", "packages/shared/test/token-saver-mode.test-d.ts"],
  ["PolicyDenyCode", "packages/policy/test/deny-code.test-d.ts"],
  ["ContentStoreErrorCode", "packages/content-store/test/error-code.test-d.ts"],
  ["RankFeatureName", "packages/output-filter/test/rank-features.test-d.ts"],
  ["OutputSourceKind", "packages/output-filter/test/output-source.test-d.ts"],
  ["DerivedIntentSource", "packages/retrieval/test/intent.test-d.ts"],
  ["McpToolName", "packages/mcp-bridge/test/tool-name.test-d.ts"],
  ["McpBridgeErrorCode", "packages/mcp-bridge/test/errors.test-d.ts"],
];

describe("AA1 §17 closed-enum pin audit", () => {
  it.each(PIN_FILES)("%s pin exists and is non-empty (%s)", (_name, rel) => {
    const abs = fileURLToPath(new URL(rel, REPO_ROOT));
    expect(existsSync(abs), `${rel} missing`).toBe(true);
    expect(readFileSync(abs, "utf8").trim().length, `${rel} empty`).toBeGreaterThan(0);
  });

  it("audits exactly the 8 epic enums (no silent add/drop)", () => {
    expect(PIN_FILES).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run to verify it passes (pins exist post-merge)**

Run: `pnpm --filter @megasaver/cli exec vitest run test/enum-pin-audit.test.ts`
Expected: PASS (8 + 1). If any pin file is MISSING, that is a dropped-pin regression in a BB PR — STOP and flag to the parent; do not create the pin here (it belongs to its owning BB PR).

- [ ] **Step 3: Verify the REPO_ROOT resolution is correct**

If every row fails with "missing", the `../../../` depth is wrong. Confirm: `apps/cli/test/enum-pin-audit.test.ts` → root is three `..` up (`test` → `cli` → `apps` → root). Adjust only if the harness resolves differently; re-run Step 2.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/test/enum-pin-audit.test.ts
git commit -m "test(cli): audit AA1 §17 closed-enum pins present"
```

---

## Task 3: README "Mega Saver Mode" section

**Files:**
- Modify: `README.md` (insert a new section after "GUI app", before "Future packages"; fold `mcp-bridge` out of "Future packages").

- [ ] **Step 1: Read the insertion anchors**

Run: `grep -nE "^## (GUI app|Future packages)" README.md`
Expected: prints the two heading line numbers (≈ `## GUI app` at 325, `## Future packages` at 352). Confirm the `### @megasaver/mcp-bridge` subsection sits under "Future packages".

- [ ] **Step 2: Insert the "Mega Saver Mode" section**

Add this section immediately before the `## Future packages` heading (the COMPLETE prose — do not abbreviate):

```markdown
## Mega Saver Mode

Mega Saver Mode is session-scoped, GUI-controlled, MCP-backed output
compression. Turn it on for a session and the agent stops drowning in
raw tool output: every large file read, command run, or build/test log
is routed through a deterministic redact → chunk → rank → fit →
summarize pipeline, and only the most relevant excerpts reach the
model. The raw evidence stays on your disk; the agent sees the signal.

**Less tokens. More signal. Same or better agent performance.**

### One click

In the GUI, open **Sessions**, pick a session, and click **Enable Mega
Saver Mode**. Choose a mode. Mega Saver then, in one step:

- writes the session's `tokenSaver` settings,
- syncs the connector instruction block into the agent's config file,
- installs or repairs the MCP bridge for the agent,
- initializes per-session stats,
- verifies the content store.

The Sessions detail pane shows **Mega Saver Mode: ON**, whether the
agent is ready, and whether a restart is needed. No terminal required.

The same flow is available from the CLI:

```bash
mega session saver enable <session-id> --mode balanced
mega mcp repair --target claude-code
mega connector sync --target claude-code --project <name>
```

### Modes

Each mode caps the bytes returned to the agent per call. The cap is the
single source of truth in `modeToBudget()` and is shared by the CLI,
the MCP bridge, and the GUI.

| Mode | Returned-byte budget | Use when |
|------|----------------------|----------|
| `safe` | 32 000 | You want more context retained; exploratory work. |
| `balanced` | 12 000 | Default. Strong savings, ample signal. |
| `aggressive` | 4 000 | Maximum savings; tight, focused tasks. |

### Measurable savings

Every routed call records `rawBytes`, `returnedBytes`, `bytesSaved`,
and a `savingRatio`. The Sessions panel shows the running total — e.g.
**Raw 380 KB · Sent 24 KB · Saved 93.7%** — and a feed of recent
events. Read the live numbers anytime:

```bash
mega session saver stats <session-id>
```

### Raw / sent viewer

Compression never deletes evidence. For any event you can open the
**raw** captured output and the **sent** filtered excerpts side by
side in the GUI (`/raw` and `/sent` stream straight from the local
content store). Ask for the raw bytes only when the filtered result is
genuinely insufficient.

### Doctor & repair

The **Agent Setup Doctor** view (and `mega mcp status` / `mega mcp
repair`) reports, per agent, whether the MCP bridge is installed, the
connector block is in sync, and a restart is required — and fixes any
of them with one action. `mega doctor` folds these checks into the
overall environment report.

### MCP tools

When Mega Saver Mode is on, the connector block tells the agent to
prefer the Mega Saver MCP tools over native ones:

- `mega_read_file(path, intent, …)` instead of reading a whole file,
- `mega_run_command(command, args, intent, …)` instead of a raw shell,
- `mega_fetch_chunk(chunkSetId, chunkId)` to drill into a stored
  excerpt,
- `mega_recall(sessionId, intent)` to reload session memory and recent
  tool calls without re-reading every file.

The bridge speaks MCP over `stdio`, gates every command through the
policy allow/deny list, and runs the redaction pipeline before any
output is stored or returned. Command execution never escapes the
allow-list, and secrets are redacted before persistence.

```

- [ ] **Step 3: Fold `mcp-bridge` out of "Future packages"**

`@megasaver/mcp-bridge` shipped in BB8, so it is no longer future. In the `## Future packages` section, DELETE the `### @megasaver/mcp-bridge` subsection (its capability is now covered by the "MCP tools" paragraph above). Leave the `### @megasaver/skill-packs` subsection — it is still future per AA1 §2c. If "Future packages" now has only `skill-packs`, keep the heading.

Read the exact `mcp-bridge` subsection first to delete it precisely:

Run: `sed -n '352,381p' README.md`
Then remove only the `### @megasaver/mcp-bridge` block (heading through the blank line before `### @megasaver/skill-packs`).

- [ ] **Step 4: Update the Table of contents**

`README.md:18` has a `## Table of contents`. Add a `- [Mega Saver Mode](#mega-saver-mode)` entry in the correct position (after the GUI app entry, before Future packages). Read it first:

Run: `sed -n '18,36p' README.md`
Edit the matching anchor list to include the new section.

- [ ] **Step 5: Verify no broken markdown / lint**

Run: `pnpm lint`
Expected: exit 0 (Biome does not lint markdown prose, but this confirms no accidental code-file change). Also eyeball: `grep -n "Mega Saver Mode" README.md` shows the new heading.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add Mega Saver Mode section to README"
```

---

## Task 4: Wiki close-out entry + entity pages

Per `wiki/CLAUDE.md`: ≤ 50 lines/page, frontmatter, cited claims, log every op.

**Files:**
- Create: `wiki/entities/{policy,content-store,output-filter,retrieval,stats,mcp-bridge}.md`
- Modify: `wiki/index.md`, `wiki/log.md`, `wiki/entities/{core,gui,cli,connectors-shared}.md`

- [ ] **Step 1: Write the 5 new-package entity pages**

Create each with this shape (substitute per package). Example — `wiki/entities/policy.md`:

```markdown
---
title: "@megasaver/policy"
tags: [package, security, policy]
sources: [docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md]
status: active
created: 2026-05-13
updated: 2026-05-13
---

# @megasaver/policy

Security gate for command execution and path reads (AA1 §9; BB3, HIGH risk).

## Surface
- `evaluateCommand({ command, args, project, env? })` → allow/deny with a
  `PolicyDenyCode` reason. Denies on non-allow-listed commands,
  DANGEROUS_PATTERNS, and inherited `MEGASAVER_ORIGIN_PID` mismatch
  (`recursive_megasaver` re-entry guard) (source: AA1 §9a).
- `evaluatePathRead({ path, project })` → denylist check for secret paths
  (`**/.env`, `**/.ssh/**`, `**/*.pem`, …) (source: AA1 §9a).
- `redact(text)` → `{ redacted, count }` over the default REDACTION_PATTERNS
  (source: AA1 §9d).

## Closed enum
- `PolicyDenyCode` = `["command_not_allowed", "dangerous_pattern",
  "intent_missing", "path_denied", "recursive_megasaver",
  "secret_path_read"]`, pinned in `packages/policy/test/deny-code.test-d.ts`
  (source: AA1 §17).

## Boundaries
Imports only `@megasaver/shared`; never `core`/`output-filter` (AA1 §3c).
```

Repeat for the other four (cite the AA1 section in each):
- `content-store.md` — AA1 §10. Surface: `saveChunkSet`/`loadChunkSet`/`listChunkSets`/`deleteChunkSet`/`pruneOlderThan`; layout `<store>/content/<projectId>/<sessionId>/<chunkSetId>.json`; enum `ContentStoreErrorCode` = `["not_found","schema_invalid","store_corrupt","write_failed"]`; redaction-flag invariant (AA1 §10d). Imports `shared` + `output-filter` (OutputSourceKind) only.
- `output-filter.md` — AA1 §11. Surface: `filterOutput` (pure pipeline redact→normalize→collapse→chunk→rank→dedupe→fit→summarize→compose), `resolveSafeReadPath` (sandbox gate), `scoreChunk`; enums `RankFeatureName` (9 members) + `OutputSourceKind` (4 members). Redaction lives here (HIGH risk). Imports `shared` + `policy` only; NOT `core` (AA1 §2e cycle).
- `retrieval.md` — AA1 §12. Surface: standalone BM25 over chunked text + `DerivedIntent` derivation (precedence: explicit→session-title→recent-memory→command→file-path→auto). Enum `DerivedIntentSource` (6 members). Imports `shared` only.
- `stats.md` — AA1 §13. Surface: `appendEvent`/`updateSessionStats`; `TokenSaverEvent` + `SessionTokenSaverStats` schemas; layout `<store>/stats/<projectId>/<sessionId>.json` + `.events.jsonl`; disable preserves events, zeros summary (AA1 §13c). Imports `shared` + `output-filter` (OutputSourceKind) only.

- [ ] **Step 2: Write the real `mcp-bridge` entity page**

Create `wiki/entities/mcp-bridge.md` (was a reserved slot, `wiki/index.md:32`):

```markdown
---
title: "@megasaver/mcp-bridge"
tags: [package, mcp, bridge, critical]
sources: [docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md]
status: active
created: 2026-05-13
updated: 2026-05-13
---

# @megasaver/mcp-bridge

Real MCP server over `stdio` (AA1 §8; BB8, CRITICAL). Replaced the v0.3
`not_implemented` placeholder without redesigning `createBridge(config)`.

## Tools (alphabetic; AA1 §8a)
- `mega_fetch_chunk(chunkSetId, chunkId, around?)`
- `mega_read_file(path, intent, sessionId, maxBytes?)` — policy.evaluatePathRead
  → resolveSafeReadPath → readFile → filterOutput → store.
- `mega_recall(sessionId, intent, maxBytes?)`
- `mega_run_command(command, args, intent, sessionId, maxBytes?)` —
  evaluateCommand (env-marker re-entry guard) → spawn → redact → filter →
  store + stats. Same orchestrator as `mega output exec` (AA1 §8d).

## Closed enums (AA1 §17)
- `McpToolName` (4 members), `McpBridgeErrorCode` (16 members, replaced the
  single `not_implemented`), `McpTransport` = `["stdio","sse"]` (unchanged;
  sse rejects until v0.6).

## CLI
`mega mcp {install,repair,status,uninstall}` (BB8) + GUI AgentSetupDoctor (BB11).
```

- [ ] **Step 3: Append AA1 notes to the 4 existing entity pages**

Append a short "## AA1 / Mega Saver Mode" subsection (3–6 lines each, cited to AA1) to:
- `wiki/entities/core.md` — context-gate orchestrator folded in (`packages/core/src/context-gate/`, AA1 §2a); `Session.tokenSaver?` field + `updateTokenSaver` registry method (AA1 §4).
- `wiki/entities/gui.md` — `TokenSaverPanel` + `token-saver-{modal,stats}` + `savings-badge` (BB10); `agent-setup-doctor` view + `agent-setup-row` (BB11); bridge routes `/api/sessions/:id/token-saver/*` + `/api/mcp/*` (AA1 §6c).
- `wiki/entities/cli.md` — new surfaces `mega session saver {enable,disable,status,stats}` (BB2), `mega output {file,filter,chunk,exec}` (BB7a/BB7b), `mega mcp {install,repair,status,uninstall}` (BB8).
- `wiki/entities/connectors-shared.md` — additive `MEGA SAVER:CONTEXT_GATE` block via `context-gate-block.ts`; `parseBlock` parameterised by sentinel pair (AA1 §7; BB11).

- [ ] **Step 4: Link the 6 new pages in `wiki/index.md`**

In the `## Entities` list of `wiki/index.md`, add 6 bullets (alphabetical with the existing ones):

```markdown
- [[entities/content-store]] — `@megasaver/content-store` chunk-set persistence + retention (AA1 §10).
- [[entities/mcp-bridge]] — `@megasaver/mcp-bridge` real MCP stdio server, 4 tools (AA1 §8).
- [[entities/output-filter]] — `@megasaver/output-filter` redact→…→summarize pipeline + sandbox gate (AA1 §11).
- [[entities/policy]] — `@megasaver/policy` command/path/redaction security gate (AA1 §9).
- [[entities/retrieval]] — `@megasaver/retrieval` BM25 + intent derivation (AA1 §12).
- [[entities/stats]] — `@megasaver/stats` token-saver event + session-summary store (AA1 §13).
```

Also delete the stale clause in `wiki/index.md:32` ("v0.3 scaffolds (entity pages still pending): `mcp-bridge`, …") — `mcp-bridge` now has a page; leave `skill-packs` + `conventions-sync` if still pending.

- [ ] **Step 5: Add the v1.0 Status entry to `wiki/index.md`**

At the TOP of the `## Status` section (before `## v0.3 — SHIPPED`), add:

```markdown
## v1.0 — SHIPPED (2026-05-13)

Context Gate / Mega Saver Mode epic (AA1) complete: BB1–BB11 merged,
v1.0 closeout (CC) tagged `v1.0.0`. Session-scoped, GUI-controlled,
MCP-backed output compression — "Open GUI → Click Enable → Done"
(plan L1672–L1702). Five new packages (`policy`, `content-store`,
`output-filter`, `retrieval`, `stats`); real `@megasaver/mcp-bridge`
over stdio; GUI `TokenSaverPanel` + AgentSetupDoctor; additive
`MEGA SAVER:CONTEXT_GATE` connector block. End-to-end acceptance test
at `apps/cli/test/e2e/v1-closeout-flow.test.ts`; all 8 AA1 §17 enum
pins audited. `pnpm verify` green; all 14 packages bumped to 1.0.0.

```

- [ ] **Step 6: Append the close-out log entry**

Append to the END of `wiki/log.md`:

```markdown
## [2026-05-13] feat | CC — v1.0 closeout: e2e + docs + release tag (AA1 capstone)

Capstone PR for the AA1 epic. No feature code — proves the AA1 §1
v1.0 done-list end-to-end and tags `v1.0.0`.

- **e2e** — `apps/cli/test/e2e/v1-closeout-flow.test.ts` walks plan
  L1672–L1702: project+session → `session saver enable --mode balanced`
  → `output exec -- node …` (savingRatio present, chunkSet + stats
  written) → `mcp repair` + `connector sync` (CONTEXT_GATE block
  coexists with legacy block) → in-process GUI bridge serves
  `/token-saver/{status,stats}`. Shells the real built
  `apps/cli/dist/cli.js`.
- **enum audit** — `apps/cli/test/enum-pin-audit.test.ts` asserts all
  8 AA1 §17 pin files present + non-empty.
- **docs** — README "Mega Saver Mode" section (modes, savings,
  raw/sent viewer, doctor, MCP tools); `mcp-bridge` folded out of
  Future packages. 6 new wiki entity pages + 4 updated.
- **release** — coordinated `major` changeset
  (`.changeset/cc-v1-release.md`); `pnpm version-packages` →
  1.0.0 across 14 packages + per-package CHANGELOGs; `pnpm verify`
  green; annotated tag `v1.0.0`. Publish deferred to CI (packages
  `private`, no registry auth).
- **§2a** — orchestrator extraction outcome recorded in
  `wiki/decisions/context-gate-extraction.md`.
```

- [ ] **Step 7: Verify wiki link integrity + conventions still green**

Run: `grep -c "\[\[entities/" wiki/index.md` (expect the count to have grown by 6) and `pnpm conventions:check`
Expected: conventions check exit 0 (wiki edits do not touch `docs/conventions/`, so no drift).

- [ ] **Step 8: Commit**

```bash
git add wiki/
git commit -m "docs(wiki): v1.0 close-out + 6 entity pages"
```

---

## Task 5: Coordinated v1.0 changeset

**Files:**
- Create: `.changeset/cc-v1-release.md`

- [ ] **Step 1: Confirm the 14 package names**

Run: `find packages apps -maxdepth 3 -name package.json -not -path "*/node_modules/*" -exec grep -m1 '"name"' {} \;`
Expected: 13 `@megasaver/*` names (core, shared, policy, content-store, output-filter, retrieval, stats, mcp-bridge, skill-packs, cli, gui, connector-claude-code, connector-generic-cli, connectors-shared). Confirm the exact strings (note `connectors-shared` is plural; the two connectors are `connector-claude-code` / `connector-generic-cli`).

- [ ] **Step 2: Write the changeset file**

Create `.changeset/cc-v1-release.md` (same format as `.changeset/bb6-retrieval-stats.md`):

```markdown
---
"@megasaver/shared": major
"@megasaver/core": major
"@megasaver/policy": major
"@megasaver/content-store": major
"@megasaver/output-filter": major
"@megasaver/retrieval": major
"@megasaver/stats": major
"@megasaver/mcp-bridge": major
"@megasaver/skill-packs": major
"@megasaver/cli": major
"@megasaver/gui": major
"@megasaver/connectors-shared": major
"@megasaver/connector-claude-code": major
"@megasaver/connector-generic-cli": major
---

Mega Saver v1.0 — Context Gate / Mega Saver Mode.

Session-scoped, GUI-controlled, MCP-backed output compression ships
complete: the `tokenSaver` session setting, the Context Gate
orchestrator, the output-filter redaction/ranking pipeline, the
content store, retrieval (BM25) and stats packages, the real
`@megasaver/mcp-bridge` over stdio with four tools, the GUI
TokenSaverPanel + Agent Setup Doctor, and the additive
`MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
enables token saving per session; raw evidence stays local; the agent
receives only the most relevant excerpts with measurable byte savings.
```

(That is 14 names — the workspace has 14 `@megasaver/*` packages once both connectors + connectors-shared are counted. Use whatever Step 1 prints; bump EVERY non-root `@megasaver/*` package to `major`. The root `megasaver` package is private + unversioned and is not listed.)

- [ ] **Step 3: Validate the changeset is well-formed**

Run: `pnpm exec changeset status`
Expected: exit 0; lists every named package at a `Major` bump (alongside any pending BB changesets). If it errors "package not found", a name is misspelled — fix against Step 1's output.

- [ ] **Step 4: Commit**

```bash
git add .changeset/cc-v1-release.md
git commit -m "chore: add v1.0.0 coordinated major changeset"
```

---

## Task 6: Version bump to 1.0.0

**Files:**
- Modify (by tool, NOT hand): every `package.json` → `1.0.0`; generated per-package `CHANGELOG.md`.

- [ ] **Step 1: Run `changeset version`**

Run: `pnpm version-packages`
Expected: exit 0; consumes ALL pending changesets (BB + the new release), writes `1.0.0` into every package's `package.json`, generates/updates per-package `CHANGELOG.md`, and deletes the consumed `.changeset/*.md` files (config.json + README stay).

- [ ] **Step 2: Refresh the lockfile**

Run: `pnpm install`
Expected: exit 0; `pnpm-lock.yaml` updated (workspace-internal deps are `workspace:*` so no churn there, but recorded package versions update). No new external deps added.

- [ ] **Step 3: Verify every version is 1.0.0**

Run: `find packages apps -maxdepth 3 -name package.json -not -path "*/node_modules/*" -exec grep -H '"version"' {} \;`
Expected: every line shows `"version": "1.0.0"`.

- [ ] **Step 4: Verify CHANGELOGs were generated**

Run: `find packages apps -maxdepth 3 -name CHANGELOG.md -not -path "*/node_modules/*" | wc -l`
Expected: ≥ 13 (one per bumped package).

- [ ] **Step 5: Commit the version bump**

```bash
git add -A
git commit -m "chore: release v1.0.0 (changeset version)"
```

---

## Task 7: Release notes

**Files:**
- Create: `docs/superpowers/RELEASE-NOTES-v1.0.0.md`

- [ ] **Step 1: Write the release notes**

Create `docs/superpowers/RELEASE-NOTES-v1.0.0.md`:

```markdown
# Mega Saver v1.0.0

**Context Gate / Mega Saver Mode** — session-scoped, GUI-controlled,
MCP-backed output compression. *Less tokens. More signal. Same or
better agent performance.*

## Highlights

- **One-click Mega Saver Mode.** Enable per session from the GUI (or
  `mega session saver enable --mode balanced`). Mega Saver writes the
  session settings, syncs the connector block, installs/repairs the
  MCP bridge, initializes stats, and verifies the content store in one
  step.
- **Deterministic output compression.** Raw tool output is routed
  through redact → chunk → rank → fit → summarize. The agent receives
  only the most relevant excerpts; raw evidence stays on local disk.
- **Three modes** — `safe` (32 000 B), `balanced` (12 000 B),
  `aggressive` (4 000 B) returned-byte budgets.
- **Real MCP bridge over stdio** exposing `mega_fetch_chunk`,
  `mega_read_file`, `mega_recall`, `mega_run_command` — policy-gated
  and redaction-pipelined.
- **Measurable savings** — per-event `rawBytes` / `returnedBytes` /
  `savingRatio`, surfaced in the GUI TokenSaverPanel with a raw/sent
  viewer.
- **Agent Setup Doctor** — install / repair / status per agent, no
  terminal required.

## New packages

`@megasaver/policy`, `@megasaver/content-store`,
`@megasaver/output-filter`, `@megasaver/retrieval`, `@megasaver/stats`,
plus the real `@megasaver/mcp-bridge` (replacing the v0.3 placeholder).

## Security

- Command execution is gated by an allow-list + dangerous-pattern
  deny-list; a `MEGASAVER_ORIGIN_PID` env marker blocks recursive
  self-invocation.
- Secrets are redacted before any output is stored or returned.
- File reads pass a secret-path denylist plus a structural sandbox
  gate (no symlink escape, no `..` traversal, no out-of-sandbox
  absolute paths).

## Compatibility

- Pre-v1.0 sessions load unchanged (`tokenSaver` is optional; absent
  means "not enabled").
- The connector `MEGA SAVER:CONTEXT_GATE` block is **additive** — the
  legacy `MEGA SAVER:BEGIN/END` block is untouched.

## Verification

`pnpm verify` green (lint + typecheck + test + conventions). End-to-end
acceptance test: `apps/cli/test/e2e/v1-closeout-flow.test.ts`. All
closed-enum tuple pins audited (`apps/cli/test/enum-pin-audit.test.ts`).

## Not in v1.0

Auth / per-project ACLs on the bridge, multi-user / team chatops,
real-time push to the GUI, model proxying, external embedding /
retrieval services (all local). Registry publish is a CI step
(packages are private in this release).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/RELEASE-NOTES-v1.0.0.md
git commit -m "docs: v1.0.0 release notes"
```

---

## Task 8: §2a orchestrator-extraction decision record

AA1 §2a: after BB7b, `wc -l packages/core/src/context-gate/*.ts`; > 500 LOC → extract to `@megasaver/context-gate` (BB12), else keep folded. PR #75 evaluated this. The closeout RECORDS the outcome.

**Files:**
- Create: `wiki/decisions/context-gate-extraction.md`
- Modify: `wiki/index.md` (link it), `wiki/log.md` (note it)

- [ ] **Step 1: Measure the orchestrator LOC**

Run: `wc -l packages/core/src/context-gate/*.ts`
Expected: a total line. Record the exact `total` number — it determines which branch of the record to write. (Also check PR #75's disposition: `gh pr view 75 --json state,title,url 2>/dev/null || echo "PR #75 state unknown — record as in-flight"`.)

- [ ] **Step 2: Write the decision record**

Create `wiki/decisions/context-gate-extraction.md` (fill `<TOTAL_LOC>` and the branch from Step 1):

```markdown
---
title: Context Gate — folded vs extracted (AA1 §2a)
tags: [decision, architecture, context-gate]
sources: [docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md]
status: active
created: 2026-05-13
updated: 2026-05-13
---

# Context Gate — folded vs extracted

AA1 §2a folded the Context Gate orchestrator into `@megasaver/core`
(`packages/core/src/context-gate/`) for BB1–BB7b, with a deferred
trigger: if the orchestrator exceeds **500 LOC** after BB7b, extract
it to a standalone `@megasaver/context-gate` package (BB12); otherwise
keep it folded (source: AA1 §2a).

## Measurement (2026-05-13, post-BB7b)

`wc -l packages/core/src/context-gate/*.ts` total = **<TOTAL_LOC>** LOC.

## Outcome

<TOTAL_LOC> <= 500 → **KEPT FOLDED.** The orchestrator stays inside
`@megasaver/core`; no `@megasaver/context-gate` package is created. The
cycle-risk argument (a coordinator that imports every domain package
would close a dependency cycle if promoted) holds at this size
(source: AA1 §2a, §19a).

— OR, if the measured total > 500 —

<TOTAL_LOC> > 500 → **EXTRACTED.** Tracked as BB12; the orchestrator
moves to `@megasaver/context-gate`, importing the domain packages and
re-exported by `@megasaver/core` to preserve the public surface.

(Keep ONLY the branch that matches the measured number; delete the other.)

## PR #75

Orchestrator-extraction evaluation: <state from `gh pr view 75`, e.g.
"merged — confirmed folded" / "closed — extraction deferred" / "open —
in flight">.
```

- [ ] **Step 3: Link + log**

Add to `wiki/index.md` under `## Decisions`:
```markdown
- [[decisions/context-gate-extraction]] — AA1 §2a folded-vs-extracted outcome (post-BB7b LOC audit).
```
Append to `wiki/log.md`:
```markdown
## [2026-05-13] decision | Context Gate extraction (AA1 §2a) recorded

`wc -l packages/core/src/context-gate/*.ts` = <TOTAL_LOC> LOC →
<folded|extracted>. Recorded in
`wiki/decisions/context-gate-extraction.md`. PR #75: <state>.
```

- [ ] **Step 4: Commit**

```bash
git add wiki/decisions/context-gate-extraction.md wiki/index.md wiki/log.md
git commit -m "docs(wiki): record context-gate extraction outcome (§2a)"
```

---

## Task 9: Final verify, smoke evidence, and tag

- [ ] **Step 1: Run the full verify gate**

Run: `pnpm verify`
Expected: exit 0 — `pnpm lint && pnpm typecheck && pnpm test && pnpm conventions:check` all green. The e2e (Task 1) and enum audit (Task 2) run inside `pnpm test`. CAPTURE the tail of the output as smoke evidence (test file count + total passed).

- [ ] **Step 2: Re-run the e2e in isolation as smoke evidence**

Run: `pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli exec vitest run test/e2e/v1-closeout-flow.test.ts --reporter=verbose`
Expected: 5 passed. Record the per-`it` PASS lines — this is the AA1 §1 done-list evidence bundle ([A1]–[A8], incl. the GUI-doctor `/api/mcp/*` leg).

- [ ] **Step 3: Confirm version + clean tree**

Run: `grep -m1 '"version"' packages/core/package.json && git status --porcelain`
Expected: `"version": "1.0.0"`; `git status --porcelain` empty (all committed).

- [ ] **Step 4: Create the annotated tag**

Run:
```bash
git tag -a v1.0.0 -m "Mega Saver v1.0.0 — Context Gate / Mega Saver Mode"
git tag -l v1.0.0
```
Expected: `v1.0.0` listed. Do NOT push — pushing the tag (and any `changeset publish`) is a human/CI step (packages are private; no registry auth here).

- [ ] **Step 5: Final evidence summary**

Confirm and record:
- `pnpm verify` exit 0 (Step 1).
- e2e 5/5 passed (Step 2).
- enum-pin audit 9/9 passed (inside Step 1).
- all 14 `package.json` at `1.0.0` (Task 6 Step 3).
- ≥ 13 CHANGELOG.md present (Task 6 Step 4).
- tag `v1.0.0` exists (Step 4).
- README "Mega Saver Mode" section present; wiki close-out + 6 entity pages + §2a record committed.

This evidence bundle satisfies the spec §7 DoD items 2–7. Hand to `code-reviewer` (author ≠ reviewer) before declaring the closeout done.

---

## Self-review

**1. Spec coverage.** Each spec section maps to a task:
- §1 acceptance contract [A1]–[A8] → Task 1 (e2e legs) + Task 2 (enum audit) + Task 9 (`pnpm verify`). Mapping table in spec §7 + Task 9 Step 5.
- §2 e2e flow → Task 1 (all 8 plan steps as `it` blocks / assertions).
- §3 enum audit → Task 2.
- §4 docs (README, no `docs/` guide, wiki) → Task 3 (README) + Task 4 (wiki). §4b "no new docs tree" honored — no task creates `docs/guides/`.
- §5 release (changesets) → Task 5 (changeset) + Task 6 (version) + Task 9 Step 4 (tag). §5.5 "publish deferred" honored — no task runs `changeset publish`.
- §6 §2a record → Task 8.
- §7 DoD → Task 9.

**2. Placeholder scan.** No "TBD"/"add appropriate". The two intentional run-time substitutions (`<TOTAL_LOC>` in Task 8, the store sub-path / route prefix in Task 1 Step 3) are explicitly flagged as "measure live / adjust to real output" with the exact command that produces the value — not vague placeholders. README + release-notes + changeset + entity-page prose is complete verbatim.

**3. Type / name consistency.** Package names use the verified strings (`connectors-shared` plural; `connector-claude-code` / `connector-generic-cli` singular) — Task 5 Step 1 re-confirms before the changeset. Enum names + pin paths copied verbatim from AA1 §17 (Task 2 + spec §3 identical). CLI flag forms (positional `projectName`/`sessionId`, `--intent`/`--store`/`--mode`, `-- <cmd>`) are the verified repo forms, consistent across Task 1 and the README. The e2e store path literal (`<store>/megasaver/...`) is flagged for live correction in Task 1 Step 3 since it is the one fact I could not byte-confirm without the merged BB7b store-resolution code.

**Known live-adjust points (not gaps — flagged for the executor):** (a) the exact on-disk store sub-path segment, (b) the GUI bridge token-saver route prefix, (c) `mcp status --json` array-vs-object shape, (d) `connector sync` project flag form. Each has a "read the real file / adjust the test" instruction in Task 1 Step 3. These exist because BB7b/BB8/BB10/BB11 are not yet merged in the authoring worktree; they are test-only adjustments, never product-code changes.
