# Cache Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega doctor --cache` — a free, read-only suffix-stability lint (spec: `docs/superpowers/specs/2026-08-06-cache-doctor-design.md`, merges wiki B5+B6): static churn lint of the user's hook stack / CLAUDE.md / MCP scopes, a counts-only "correlated, never caused" join against the proxy usage ledger, and a byte-determinism self-audit of Mega Saver's own generated surfaces.

**Architecture:** Detectors live in `@megasaver/connector-claude-code` (agent-specific logic never enters core): `suffix-churn-lint.ts` (new) + append-only extensions to `cache-suffix-audit.ts` + `byte-variance-probes.ts` (new). The CLI composes in `apps/cli/src/commands/doctor-cache.ts` (`runDoctorCacheChecks(deps): Promise<Check[]>`, all readers injected) and `doctor.ts` gains the `--cache` flag, reusing the existing `Check`/`renderReport`/`exitCodeFor` frame verbatim. Usage receipts come from `readProxyUsage` (`@megasaver/llm-proxy` — CLI edge already exists at `apps/cli/src/commands/audit/usage.ts:9`).

**Tech Stack:** TypeScript strict ESM, Zod at boundaries (reuses existing `proxyUsageEventSchema` — no new schemas needed), Citty, Vitest, `node:fs`/`node:path` only. No new dependencies, no pnpm catalog (repo has none — `workspace:*`).

## Global Constraints

- Read-only: this feature writes NOTHING (no fingerprint cache, no store rows) — its output is the rendered report only.
- Privacy amendment (cache-suffix-audit.ts:3-5) is law: closed code vocabulary; surfaces are positional (`"SessionStart[0]"`, `count=N`, `L<line>`); no command text, file content, server names, rendered bytes, or digests ever serialize into a risk or a Check reason.
- Enum order is a contract: `CACHE_SUFFIX_RISK_CODES` is extended by APPENDING only — the existing six codes keep their positions; a test pins this. `MANAGED_TEXT_PATTERN_CODES` is a new closed const whose order is fixed at birth.
- Exit semantics: user-config findings are `pass: true` + `warn:` reason (precedent `checkSettingsPermissions`, doctor.ts:87-95); only self-audit byte-variance rows are `pass: false`.
- Pro boundary: no `@megasaver/pro-analytics` import, no USD, no hit-rate findings — `mega cache` (entitlement-gated, cache.ts:102-111) is untouched and its `--suffix-audit` output must not change.
- Dependency invariant: `@megasaver/stats` and `@megasaver/retrieval` stay forbidden in the CLI (`apps/cli/test/dependency-graph.test.ts:52`); `@megasaver/llm-proxy` is an existing allowed edge — this plan adds no new workspace edges.
- Mechanism honesty: never claim cached-prefix invalidation (retraction 2026-07-30, wiki/syntheses/saver-cache-churn.md). Ledger wording is fixed: "correlated", never "caused".
- cli-test-pattern (wiki/workflows/cli-test-pattern.md): temp stores via `mkdtemp`, injected readers, tests drive the inner `run*` function directly; handler tests use the `as never` Citty invocation.
- No timing-tight tests — structural assertions only (repo lesson, commits 6d48d4a3 / 5bc849a5).
- Hook handlers are out of scope: nothing under `apps/cli/src/hooks/` changes (hooks always exit 0 discipline is not perturbed).
- §8 conventions: strict TS, files ≤ 300 LOC (hence the two new connector files instead of growing cache-suffix-audit.ts), comments only for non-obvious WHY, English everywhere.

---

### Task 1: Connector — churn-lint detectors (`lintHookCommandChurn`, `lintManagedTextVolatility`, `lintMcpScopeOverlap`)

**Files:**
- `packages/connectors/claude-code/src/suffix-churn-lint.ts` (new)
- `packages/connectors/claude-code/src/cache-suffix-audit.ts` (append 3 codes to `CACHE_SUFFIX_RISK_CODES`)
- `packages/connectors/claude-code/src/index.ts` (export new symbols)
- `packages/connectors/claude-code/test/suffix-churn-lint.test.ts` (new)
- `packages/connectors/claude-code/test/public-export.test.ts` (append new export names)

**Interfaces:**

```ts
// suffix-churn-lint.ts
export const MANAGED_TEXT_PATTERN_CODES = ["iso_datetime", "uuid", "epoch_millis"] as const;
export type ManagedTextPatternCode = (typeof MANAGED_TEXT_PATTERN_CODES)[number];
export type ManagedTextFinding = { code: ManagedTextPatternCode; line: number };

export function lintHookCommandChurn(settings: unknown): CacheSuffixRisk[];
export function lintManagedTextVolatility(content: string): ManagedTextFinding[];
export function lintMcpScopeOverlap(input: {
  projectMcp: unknown;
  userMcp: unknown;
}): CacheSuffixRisk[];
```

Appended codes (END of `CACHE_SUFFIX_RISK_CODES`, in this order):
`"hook_command_volatile_output"`, `"hook_command_file_mutator"`, `"mcp_server_duplicate_scope"`.

**Steps:**

- [ ] Write the failing test `packages/connectors/claude-code/test/suffix-churn-lint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CACHE_SUFFIX_RISK_CODES } from "../src/cache-suffix-audit.js";
import {
  MANAGED_TEXT_PATTERN_CODES,
  lintHookCommandChurn,
  lintManagedTextVolatility,
  lintMcpScopeOverlap,
} from "../src/suffix-churn-lint.js";

const settingsWith = (event: string, command: string) => ({
  hooks: { [event]: [{ hooks: [{ type: "command", command }] }] },
});

describe("enum order contract", () => {
  it("keeps the first six risk codes in their shipped positions and appends the new ones", () => {
    expect(CACHE_SUFFIX_RISK_CODES.slice(0, 6)).toEqual([
      "settings_unreadable",
      "settings_malformed",
      "duplicate_megasaver_hook",
      "foreign_custom_base_url",
      "owned_route_missing_first_party_flag",
      "generated_output_byte_variance",
    ]);
    expect(CACHE_SUFFIX_RISK_CODES.slice(6)).toEqual([
      "hook_command_volatile_output",
      "hook_command_file_mutator",
      "mcp_server_duplicate_scope",
    ]);
    expect(MANAGED_TEXT_PATTERN_CODES).toEqual(["iso_datetime", "uuid", "epoch_millis"]);
  });
});

describe("lintHookCommandChurn", () => {
  it("flags $(date) interpolation positionally and never serializes the command", () => {
    const risks = lintHookCommandChurn(settingsWith("SessionStart", 'echo "up $(date +%s)"'));
    expect(risks).toEqual([
      {
        scope: "configuration-risk",
        code: "hook_command_volatile_output",
        surface: "SessionStart[0]",
      },
    ]);
    expect(JSON.stringify(risks)).not.toContain("echo");
  });

  it("flags file-mutating flags as a distinct code", () => {
    const risks = lintHookCommandChurn(settingsWith("PostToolUse", "npx biome check --fix ."));
    expect(risks).toEqual([
      {
        scope: "configuration-risk",
        code: "hook_command_file_mutator",
        surface: "PostToolUse[0]",
      },
    ]);
  });

  it("reports both families once each when one command trips both", () => {
    const risks = lintHookCommandChurn(
      settingsWith("PostToolUse", "sed -i \"s/x/$RANDOM/\" notes.md"),
    );
    expect(risks.map((r) => r.code).sort()).toEqual([
      "hook_command_file_mutator",
      "hook_command_volatile_output",
    ]);
  });

  it("returns [] for clean settings, non-object input, and mega's own hooks", () => {
    expect(lintHookCommandChurn(settingsWith("PostToolUse", "mega hooks saver"))).toEqual([]);
    expect(lintHookCommandChurn(null)).toEqual([]);
    expect(lintHookCommandChurn({ hooks: "corrupt" })).toEqual([]);
  });

  it("does not flag --write-log style near-miss flags", () => {
    expect(lintHookCommandChurn(settingsWith("PostToolUse", "mytool --write-log out"))).toEqual([]);
  });
});

describe("lintManagedTextVolatility", () => {
  it("flags ISO datetimes, uuids, and epoch millis with line numbers only", () => {
    const findings = lintManagedTextVolatility(
      [
        "# notes",
        "generated 2026-08-06T10:00:00.000Z",
        "session 1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6",
        "ts 1754400000000",
      ].join("\n"),
    );
    expect(findings).toEqual([
      { code: "iso_datetime", line: 2 },
      { code: "uuid", line: 3 },
      { code: "epoch_millis", line: 4 },
    ]);
  });

  it("does not flag plain prose dates (false-positive budget)", () => {
    expect(lintManagedTextVolatility("Reviewed on 2026-08-06 by the team.")).toEqual([]);
  });

  it("dedupes per (line, code) and orders by line then code", () => {
    const findings = lintManagedTextVolatility(
      "1754400000000 and 1754400000001\n2026-08-06T10:00:00Z",
    );
    expect(findings).toEqual([
      { code: "epoch_millis", line: 1 },
      { code: "iso_datetime", line: 2 },
    ]);
  });
});

describe("lintMcpScopeOverlap", () => {
  it("reports only the overlap count, never server names", () => {
    const risks = lintMcpScopeOverlap({
      projectMcp: { mcpServers: { github: {}, linear: {} } },
      userMcp: { mcpServers: { github: {} } },
    });
    expect(risks).toEqual([
      { scope: "configuration-risk", code: "mcp_server_duplicate_scope", surface: "count=1" },
    ]);
    expect(JSON.stringify(risks)).not.toContain("github");
  });

  it("returns [] for disjoint, absent, or malformed scopes", () => {
    expect(
      lintMcpScopeOverlap({ projectMcp: { mcpServers: { a: {} } }, userMcp: { mcpServers: { b: {} } } }),
    ).toEqual([]);
    expect(lintMcpScopeOverlap({ projectMcp: null, userMcp: undefined })).toEqual([]);
    expect(lintMcpScopeOverlap({ projectMcp: { mcpServers: 7 }, userMcp: {} })).toEqual([]);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/suffix-churn-lint.test.ts` — expect FAIL (module does not exist; codes not appended).
- [ ] Append the three codes to `CACHE_SUFFIX_RISK_CODES` in `cache-suffix-audit.ts` (END of the array — order contract).
- [ ] Implement `suffix-churn-lint.ts`. Pattern registries are closed consts; the hooks walk mirrors `duplicateHookRisks` (cache-suffix-audit.ts:37-73) so malformed shapes degrade to `[]`:

```ts
import { type CacheSuffixRisk } from "./cache-suffix-audit.js";

// Closed heuristics (spec Locked Decision 4). Volatile = output differs per
// invocation; mutator = rewrites files the agent re-reads. Both change future
// suffix bytes — neither claims cached-prefix invalidation (2026-07-30
// retraction, wiki/syntheses/saver-cache-churn.md).
const VOLATILE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\$\(\s*date\b/,
  /\bdate\s+\+/,
  /\$RANDOM\b/,
  /\buuidgen\b/,
  /\$\(\s*hostname\b/,
];
const FILE_MUTATOR_PATTERNS: readonly RegExp[] = [
  /\s--write(?=\s|$)/,
  /\s--fix(?=\s|$)/,
  /\bsed\s+-i\b/,
];

export const MANAGED_TEXT_PATTERN_CODES = ["iso_datetime", "uuid", "epoch_millis"] as const;
export type ManagedTextPatternCode = (typeof MANAGED_TEXT_PATTERN_CODES)[number];
export type ManagedTextFinding = { code: ManagedTextPatternCode; line: number };

const MANAGED_TEXT_PATTERNS: readonly { code: ManagedTextPatternCode; re: RegExp }[] = [
  { code: "iso_datetime", re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ },
  { code: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  // 13-digit ms epochs 2020-2033; plain dates are deliberately NOT flagged.
  { code: "epoch_millis", re: /\b1[6-9]\d{11}\b/ },
];

// Same four events cache-suffix-audit.ts walks (its const is private, so the
// list is re-declared; order drives report order).
const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"] as const;

export function lintHookCommandChurn(settings: unknown): CacheSuffixRisk[] {
  if (typeof settings !== "object" || settings === null) return [];
  const { hooks } = settings as Record<string, unknown>;
  if (typeof hooks !== "object" || hooks === null) return [];
  const risks: CacheSuffixRisk[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) return;
      const commandHooks = (entry as { hooks?: unknown }).hooks;
      if (!Array.isArray(commandHooks)) return;
      let volatile = false;
      let mutator = false;
      for (const hook of commandHooks) {
        if (typeof hook !== "object" || hook === null) continue;
        const command = (hook as { command?: unknown }).command;
        if (typeof command !== "string") continue;
        volatile ||= VOLATILE_COMMAND_PATTERNS.some((re) => re.test(command));
        mutator ||= FILE_MUTATOR_PATTERNS.some((re) => re.test(command));
      }
      if (volatile) {
        risks.push({
          scope: "configuration-risk",
          code: "hook_command_volatile_output",
          surface: `${event}[${i}]`,
        });
      }
      if (mutator) {
        risks.push({
          scope: "configuration-risk",
          code: "hook_command_file_mutator",
          surface: `${event}[${i}]`,
        });
      }
    });
  }
  return risks;
}

export function lintManagedTextVolatility(content: string): ManagedTextFinding[] {
  const findings: ManagedTextFinding[] = [];
  content.split("\n").forEach((text, i) => {
    for (const { code, re } of MANAGED_TEXT_PATTERNS) {
      if (re.test(text)) findings.push({ code, line: i + 1 });
    }
  });
  // At most one finding per (line, code) by construction; registry order per
  // line plus ascending line order gives the contract ordering without a sort.
  return findings;
}

function mcpServerNames(scope: unknown): readonly string[] | undefined {
  if (typeof scope !== "object" || scope === null) return undefined;
  const { mcpServers } = scope as Record<string, unknown>;
  if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
    return undefined;
  }
  return Object.keys(mcpServers);
}

export function lintMcpScopeOverlap(input: {
  projectMcp: unknown;
  userMcp: unknown;
}): CacheSuffixRisk[] {
  const project = mcpServerNames(input.projectMcp);
  const user = mcpServerNames(input.userMcp);
  if (project === undefined || user === undefined) return [];
  const userNames = new Set(user);
  const overlap = project.filter((name) => userNames.has(name)).length;
  if (overlap === 0) return [];
  return [
    {
      scope: "configuration-risk",
      code: "mcp_server_duplicate_scope",
      surface: `count=${overlap}`,
    },
  ];
}
```

(The block above is the full module. Malformed shapes degrade to `[]` exactly as `duplicateHookRisks` does — cache-suffix-audit.ts:37-73 — and no owned-command special case is needed: `mega hooks *` commands cannot match either closed registry, which is what the "mega's own hooks" test pins.)

- [ ] Export from `src/index.ts`; append `"lintHookCommandChurn"`, `"lintManagedTextVolatility"`, `"lintMcpScopeOverlap"`, `"MANAGED_TEXT_PATTERN_CODES"` to `test/public-export.test.ts`'s expected list.
- [ ] GREEN: `pnpm --filter @megasaver/connector-claude-code exec vitest run` — expect PASS (whole package: proves cache-suffix-audit tests still pass with appended codes).
- [ ] `pnpm --filter @megasaver/connector-claude-code typecheck && pnpm exec biome check packages/connectors/claude-code` — expect clean.
- [ ] Commit: `feat(connector-claude-code): add suffix churn lint detectors`

---

### Task 2: Connector — byte-variance probe surface + `defaultByteVarianceRenderers` (B6)

**Files:**
- `packages/connectors/claude-code/src/cache-suffix-audit.ts` (extend `ByteVarianceRenderers`, append one probe)
- `packages/connectors/claude-code/src/byte-variance-probes.ts` (new)
- `packages/connectors/claude-code/src/index.ts` (export)
- `packages/connectors/claude-code/test/byte-variance-probes.test.ts` (new)
- `packages/connectors/claude-code/test/public-export.test.ts` (append)

**Interfaces:**

```ts
// cache-suffix-audit.ts — field APPENDED (existing two keep positions/surfaces)
export type ByteVarianceRenderers = {
  hookSettingsRenderer?: () => string;
  connectorBlockRenderer?: () => string;
  contextGateBlockRenderer?: () => string; // appended; probe surface "context-gate-block"
};

// byte-variance-probes.ts
export function defaultByteVarianceRenderers(): ByteVarianceRenderers;
```

**Steps:**

- [ ] Write the failing test `packages/connectors/claude-code/test/byte-variance-probes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultByteVarianceRenderers } from "../src/byte-variance-probes.js";
import { checkGeneratedOutputByteVariance } from "../src/cache-suffix-audit.js";

describe("defaultByteVarianceRenderers", () => {
  it("provides the hook-settings and context-gate probes and both are byte-stable (B6 gate)", () => {
    const renderers = defaultByteVarianceRenderers();
    expect(typeof renderers.hookSettingsRenderer).toBe("function");
    expect(typeof renderers.contextGateBlockRenderer).toBe("function");
    expect(checkGeneratedOutputByteVariance(renderers)).toEqual([]);
  });

  it("probe outputs are non-empty and carry the managed sentinels", () => {
    const renderers = defaultByteVarianceRenderers();
    expect(renderers.hookSettingsRenderer?.()).toContain("hooks");
    expect(renderers.contextGateBlockRenderer?.()).toContain("MEGA SAVER:CONTEXT_GATE");
  });
});

describe("checkGeneratedOutputByteVariance context-gate surface", () => {
  it("reports the appended surface, and only code+surface, when the renderer varies", () => {
    let toggle = false;
    const risks = checkGeneratedOutputByteVariance({
      contextGateBlockRenderer: () => {
        toggle = !toggle;
        return toggle ? "a" : "b";
      },
    });
    expect(risks).toEqual([
      {
        scope: "configuration-risk",
        code: "generated_output_byte_variance",
        surface: "context-gate-block",
      },
    ]);
    expect(JSON.stringify(risks)).not.toContain('"a"');
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/byte-variance-probes.test.ts` — expect FAIL.
- [ ] In `cache-suffix-audit.ts`: append the optional `contextGateBlockRenderer` field and one probe line after the existing two: `probe("context-gate-block", renderers.contextGateBlockRenderer);`.
- [ ] Implement `byte-variance-probes.ts`:

```ts
import { renderContextGateBlockText } from "@megasaver/connectors-shared";
import type { ByteVarianceRenderers } from "./cache-suffix-audit.js";
import {
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  addPostToolUseHook,
  addPreToolUseHook,
} from "./hook-settings.js";

// Fixed fixture ids: the probe checks the RENDERER's determinism (same input
// -> same bytes), so inputs are constants. Nil-ish UUIDs make it obvious in
// any accidental leak that these are probe values, not user data.
const PROBE_GATE_FIELDS = {
  sessionId: "00000000-0000-4000-8000-000000000000",
  projectId: "00000000-0000-4000-8000-000000000001",
  mode: "balanced",
  maxReturnedBytes: 12_000,
} as const;

export function defaultByteVarianceRenderers(): ByteVarianceRenderers {
  return {
    hookSettingsRenderer: () =>
      JSON.stringify(
        addPostToolUseHook(addPreToolUseHook({}, DEFAULT_HOOK_COMMAND), SAVER_HOOK_COMMAND),
      ),
    contextGateBlockRenderer: () => renderContextGateBlockText({ ...PROBE_GATE_FIELDS }),
  };
}
```

(Verified: `renderContextGateBlockText`/`ContextGateBlockFields` are exported from `@megasaver/connectors-shared` — packages/connectors/shared/src/context-gate-block.ts:5-14; `mode: "balanced"` satisfies `tokenSaverModeSchema` — packages/shared/src/token-saver-mode.ts:7; `addPreToolUseHook`/`addPostToolUseHook`/both command consts — hook-settings.ts:13-14,275,300; the connector already depends on `@megasaver/connectors-shared` and `@megasaver/shared`.)

- [ ] Export `defaultByteVarianceRenderers` from `src/index.ts`; append it to `public-export.test.ts`.
- [ ] GREEN: `pnpm --filter @megasaver/connector-claude-code exec vitest run` — expect PASS.
- [ ] `pnpm --filter @megasaver/connector-claude-code typecheck && pnpm exec biome check packages/connectors/claude-code` — expect clean.
- [ ] Commit: `feat(connector-claude-code): wire default byte-variance probes`

---

### Task 3: CLI — `runDoctorCacheChecks` composition

**Files:**
- `apps/cli/src/commands/doctor-cache.ts` (new)
- `apps/cli/test/doctor-cache.test.ts` (new)

**Interfaces:**

```ts
import type { ByteVarianceRenderers } from "@megasaver/connector-claude-code";
import type { readProxyUsage } from "@megasaver/llm-proxy";
import type { ClaudeSettingsReadResult } from "./cache.js";
import type { Check } from "./doctor.js"; // type-only: no runtime cycle (doctor-saver.ts precedent)

export type DoctorCacheDeps = {
  storeRoot: string;
  cwd: string;
  readClaudeSettings?: () => ClaudeSettingsReadResult; // default: defaultReadClaudeSettings (cache.ts:84)
  readProjectMcp?: () => ClaudeSettingsReadResult; // default: ./.mcp.json in cwd
  readUserMcp?: () => ClaudeSettingsReadResult; // default: see ASSUMPTION below
  readProjectClaudeMd?: () => string | null; // default: <cwd>/CLAUDE.md
  readUserClaudeMd?: () => string | null; // default: ~/.claude/CLAUDE.md
  readUsage?: typeof readProxyUsage; // default: readProxyUsage
  byteVarianceRenderers?: ByteVarianceRenderers; // default: defaultByteVarianceRenderers()
};

// The min cacheable prefix is 1024 tokens (saver-cache-churn wiki, replay
// check); creation counts below it are noise, not churn evidence.
export const CACHE_HEAVY_FLOOR_TOKENS = 1024;

export function isCacheCreationHeavy(e: {
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): boolean;
export async function runDoctorCacheChecks(deps: DoctorCacheDeps): Promise<Check[]>;
```

Check rows (keys, in emit order — order is part of the rendered contract):
`cache-settings`, `cache-mcp-scopes`, `cache-claude-md-project`, `cache-claude-md-user`, `cache-self-audit`, `cache-receipts`.

ASSUMPTION: user-scope MCP servers live in `~/.claude.json` (not `~/.claude/settings.json`); the default `readUserMcp` reads that path, tolerant (missing/unparsable → `{ kind: "absent" }`). Verify against a real Claude Code install during implementation; the detector and all tests are path-agnostic (readers injected), so a wrong default is a one-line fix.

**Steps:**

- [ ] Write the failing test `apps/cli/test/doctor-cache.test.ts` (cli-test-pattern: temp store, injected readers, inner function driven directly, no timing assertions):

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { proxyUsageLogPath } from "@megasaver/llm-proxy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_HEAVY_FLOOR_TOKENS,
  isCacheCreationHeavy,
  runDoctorCacheChecks,
} from "../src/commands/doctor-cache.js";

const TS = "2026-08-06T10:00:00.000Z";
let n = 0;
const usage = (over: Record<string, unknown> = {}) => ({
  id: `u${++n}`,
  ts: TS,
  model: "claude-sonnet-5",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 2048,
  messageCount: 3,
  stream: false,
  ...over,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-doctor-cache-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeUsage(lines: readonly unknown[]): void {
  const path = proxyUsageLogPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

const base = () => ({
  storeRoot: root,
  cwd: root,
  readClaudeSettings: () => ({ kind: "absent" }) as const,
  readProjectMcp: () => ({ kind: "absent" }) as const,
  readUserMcp: () => ({ kind: "absent" }) as const,
  readProjectClaudeMd: () => null,
  readUserClaudeMd: () => null,
});

describe("runDoctorCacheChecks", () => {
  it("passes everything on an empty machine, including the self-audit", async () => {
    const checks = await runDoctorCacheChecks(base());
    expect(checks.map((c) => c.key)).toEqual([
      "cache-settings",
      "cache-mcp-scopes",
      "cache-claude-md-project",
      "cache-claude-md-user",
      "cache-self-audit",
      "cache-receipts",
    ]);
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(checks.find((c) => c.key === "cache-self-audit")?.value).toBe("byte-stable");
  });

  it("reports hook churn as a warn row (pass stays true) with codes only", async () => {
    const checks = await runDoctorCacheChecks({
      ...base(),
      readClaudeSettings: () => ({
        kind: "ok",
        settings: {
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: 'echo "$(date +%s)"' }] }],
          },
        },
      }),
    });
    const row = checks.find((c) => c.key === "cache-settings");
    expect(row?.pass).toBe(true);
    expect(row?.reason).toContain("hook_command_volatile_output@SessionStart[0]");
    expect(JSON.stringify(checks)).not.toContain("echo");
  });

  it("flags CLAUDE.md volatility with line-number surfaces only", async () => {
    const checks = await runDoctorCacheChecks({
      ...base(),
      readProjectClaudeMd: () => "# ok\ngenerated 2026-08-06T10:00:00.000Z",
    });
    const row = checks.find((c) => c.key === "cache-claude-md-project");
    expect(row?.pass).toBe(true);
    expect(row?.reason).toContain("iso_datetime@L2");
    expect(JSON.stringify(checks)).not.toContain("generated 2026-08");
  });

  it("counts cache-creation-heavy receipts and uses correlated-only wording", async () => {
    writeUsage([
      usage(),
      usage(),
      usage({ cacheCreationTokens: 10, cacheReadTokens: 5000 }),
    ]);
    const checks = await runDoctorCacheChecks(base());
    const row = checks.find((c) => c.key === "cache-receipts");
    expect(row?.value).toBe("2/3 cache-creation-heavy");
    expect(row?.reason).toContain("correlated");
    expect(row?.reason).not.toContain("caused by");
  });

  it("applies the 1024-token floor to the heavy predicate", () => {
    expect(isCacheCreationHeavy({ cacheCreationTokens: 512, cacheReadTokens: 0 })).toBe(false);
    expect(
      isCacheCreationHeavy({ cacheCreationTokens: CACHE_HEAVY_FLOOR_TOKENS, cacheReadTokens: 0 }),
    ).toBe(true);
    expect(isCacheCreationHeavy({ cacheCreationTokens: 5000, cacheReadTokens: 6000 })).toBe(false);
  });

  it("FAILS only the self-audit row when a probe is byte-unstable", async () => {
    let toggle = false;
    const checks = await runDoctorCacheChecks({
      ...base(),
      byteVarianceRenderers: {
        contextGateBlockRenderer: () => {
          toggle = !toggle;
          return toggle ? "a" : "b";
        },
      },
    });
    const selfAudit = checks.find((c) => c.key === "cache-self-audit");
    expect(selfAudit?.pass).toBe(false);
    expect(selfAudit?.reason).toContain("generated_output_byte_variance@context-gate-block");
    expect(checks.filter((c) => !c.pass)).toHaveLength(1);
  });

  it("survives a missing usage log and reports skipped lines when torn", async () => {
    const clean = await runDoctorCacheChecks(base());
    expect(clean.find((c) => c.key === "cache-receipts")?.value).toBe("none");
    writeUsage([usage()]);
    writeFileSync(proxyUsageLogPath(root), '{"torn\n', { flag: "a" });
    const torn = await runDoctorCacheChecks(base());
    expect(torn.find((c) => c.key === "cache-receipts")?.reason).toContain("1 unreadable");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/doctor-cache.test.ts` — expect FAIL.
- [ ] Implement `doctor-cache.ts` (≤300 LOC). Composition per row:
  - `cache-settings`: read once via `readClaudeSettings`; `kind: "ok"` → `auditClaudeCacheSuffix(settings, { ownedRouteBaseUrl: OWNED_ROUTE_BASE_URL })` + `lintHookCommandChurn(settings)`; `unreadable`/`malformed` → their existing codes (cache.ts:170-175 pattern). Value `clean`/`absent`/`<n> risk(s)`; reason `warn: <code>@<surface>` comma-joined (object surfaces render `<event>.<subcommand>x<count>`).
  - `cache-mcp-scopes`: `lintMcpScopeOverlap` over both reads; absent scopes → `absent`, pass.
  - `cache-claude-md-project`/`-user`: `lintManagedTextVolatility` over the raw text; findings → `warn: <code>@L<line>`; `null` → `absent`.
  - `cache-self-audit`: `checkGeneratedOutputByteVariance(deps.byteVarianceRenderers ?? defaultByteVarianceRenderers())`; risks → `pass: false`, reason `<code>@<surface>`; clean → value `byte-stable` with the fixed info reason `info: context-gate block embeds session/project ids by design (regenerates at session start, cold prefix)` — the no-self-exemption disclosure (spec Locked Decision 7).
  - `cache-receipts`: `readUsage ?? readProxyUsage` with try/catch (audit/usage.ts:155-160 pattern); no events → value `none`, reason hints `mega proxy`; else value `` `${heavy}/${total} cache-creation-heavy` `` and reason `info: correlated only — receipts cannot prove config findings caused this churn` (+ `, N unreadable usage lines skipped` when torn).

Composition skeleton (row builders + reason formatting; combine with the
Interfaces block above — `DoctorCacheDeps` and the exported signatures are
already declared there):

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ByteVarianceRenderers,
  type CacheSuffixRisk,
  auditClaudeCacheSuffix,
  checkGeneratedOutputByteVariance,
  defaultByteVarianceRenderers,
  lintHookCommandChurn,
  lintManagedTextVolatility,
  lintMcpScopeOverlap,
} from "@megasaver/connector-claude-code";
import { readProxyUsage } from "@megasaver/llm-proxy";
import {
  type ClaudeSettingsReadResult,
  OWNED_ROUTE_BASE_URL,
  defaultReadClaudeSettings,
} from "./cache.js";
import type { Check } from "./doctor.js"; // type-only: no runtime cycle

export const CACHE_HEAVY_FLOOR_TOKENS = 1024;

export function isCacheCreationHeavy(e: {
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): boolean {
  return (
    e.cacheCreationTokens > e.cacheReadTokens &&
    e.cacheCreationTokens >= CACHE_HEAVY_FLOOR_TOKENS
  );
}

const SELF_AUDIT_INFO =
  "info: context-gate block embeds session/project ids by design (regenerates at session start, cold prefix)";
const RECEIPTS_INFO =
  "info: correlated only — receipts cannot prove config findings caused this churn";

function surfaceSuffix(surface: CacheSuffixRisk["surface"]): string {
  if (surface === undefined) return "";
  if (typeof surface === "string") return `@${surface}`;
  return `@${surface.event}.${surface.subcommand}x${surface.count}`;
}

const joinRisks = (risks: readonly CacheSuffixRisk[]): string =>
  risks.map((r) => `${r.code}${surfaceSuffix(r.surface)}`).join(", ");

function settingsRow(read: ClaudeSettingsReadResult): Check {
  const key = "cache-settings";
  if (read.kind === "absent") return { key, value: "absent", pass: true };
  const risks: CacheSuffixRisk[] =
    read.kind === "ok"
      ? [
          ...auditClaudeCacheSuffix(read.settings, { ownedRouteBaseUrl: OWNED_ROUTE_BASE_URL }),
          ...lintHookCommandChurn(read.settings),
        ]
      : [
          {
            scope: "configuration-risk",
            code: read.kind === "unreadable" ? "settings_unreadable" : "settings_malformed",
          },
        ];
  if (risks.length === 0) return { key, value: "clean", pass: true };
  return { key, value: `${risks.length} risk(s)`, pass: true, reason: `warn: ${joinRisks(risks)}` };
}

function mcpScopesRow(project: ClaudeSettingsReadResult, user: ClaudeSettingsReadResult): Check {
  const key = "cache-mcp-scopes";
  if (project.kind !== "ok" && user.kind !== "ok") return { key, value: "absent", pass: true };
  const risks = lintMcpScopeOverlap({
    projectMcp: project.kind === "ok" ? project.settings : undefined,
    userMcp: user.kind === "ok" ? user.settings : undefined,
  });
  if (risks.length === 0) return { key, value: "clean", pass: true };
  return { key, value: `${risks.length} risk(s)`, pass: true, reason: `warn: ${joinRisks(risks)}` };
}

function claudeMdRow(key: string, text: string | null): Check {
  if (text === null) return { key, value: "absent", pass: true };
  const findings = lintManagedTextVolatility(text);
  if (findings.length === 0) return { key, value: "clean", pass: true };
  const joined = findings.map((f) => `${f.code}@L${f.line}`).join(", ");
  return { key, value: `${findings.length} finding(s)`, pass: true, reason: `warn: ${joined}` };
}

function selfAuditRow(renderers: ByteVarianceRenderers): Check {
  const key = "cache-self-audit";
  const risks = checkGeneratedOutputByteVariance(renderers);
  if (risks.length === 0) return { key, value: "byte-stable", pass: true, reason: SELF_AUDIT_INFO };
  return { key, value: `${risks.length} unstable`, pass: false, reason: joinRisks(risks) };
}

async function receiptsRow(deps: DoctorCacheDeps): Promise<Check> {
  const key = "cache-receipts";
  try {
    const { events, skippedLines } = await (deps.readUsage ?? readProxyUsage)({
      storeRoot: deps.storeRoot,
    });
    if (events.length === 0) {
      return {
        key,
        value: "none",
        pass: true,
        reason: "no metered calls yet — run behind `mega proxy` to collect receipts",
      };
    }
    const heavy = events.filter((e) => isCacheCreationHeavy(e)).length;
    const torn = skippedLines > 0 ? `, ${skippedLines} unreadable usage lines skipped` : "";
    return {
      key,
      value: `${heavy}/${events.length} cache-creation-heavy`,
      pass: true,
      reason: `${RECEIPTS_INFO}${torn}`,
    };
  } catch {
    return { key, value: "unreadable", pass: true, reason: "warn: usage log unreadable" };
  }
}

function readJsonTolerant(path: string): ClaudeSettingsReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? { kind: "ok", settings: parsed }
      : { kind: "malformed" };
  } catch {
    return { kind: "malformed" };
  }
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export async function runDoctorCacheChecks(deps: DoctorCacheDeps): Promise<Check[]> {
  const read = (deps.readClaudeSettings ?? defaultReadClaudeSettings)();
  const projectMcp = (deps.readProjectMcp ??
    (() => readJsonTolerant(join(deps.cwd, ".mcp.json"))))();
  // ASSUMPTION (see above): user-scope MCP servers live in ~/.claude.json.
  const userMcp = (deps.readUserMcp ??
    (() => readJsonTolerant(join(homedir(), ".claude.json"))))();
  const projectMd = (deps.readProjectClaudeMd ??
    (() => readTextOrNull(join(deps.cwd, "CLAUDE.md"))))();
  const userMd = (deps.readUserClaudeMd ??
    (() => readTextOrNull(join(homedir(), ".claude", "CLAUDE.md"))))();
  return [
    settingsRow(read),
    mcpScopesRow(projectMcp, userMcp),
    claudeMdRow("cache-claude-md-project", projectMd),
    claudeMdRow("cache-claude-md-user", userMd),
    selfAuditRow(deps.byteVarianceRenderers ?? defaultByteVarianceRenderers()),
    await receiptsRow(deps),
  ];
}
```

- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/doctor-cache.test.ts` — expect PASS (7 tests).
- [ ] `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts` — expect PASS (no forbidden edge introduced).
- [ ] `pnpm --filter @megasaver/cli typecheck && pnpm exec biome check apps/cli/src/commands/doctor-cache.ts apps/cli/test/doctor-cache.test.ts` — expect clean.
- [ ] Commit: `feat(cli): add cache doctor check composition`

---

### Task 4: CLI — `--cache` flag wiring, smoke evidence, changeset, wiki

**Files:**
- `apps/cli/src/commands/doctor.ts` (add `cache` + `store` args; async run; dispatch)
- `apps/cli/test/doctor.test.ts` (append handler test)
- `.changeset/cache-doctor.md` (new)
- `wiki/log.md`, `wiki/syntheses/cache-write-cost-reduction-2026-08-01.md` (B5/B6 status note)

**Interfaces:** `doctorCommand` args gain
`cache: { type: "boolean", default: false, description: "Suffix-stability lint: cache-churn findings + Mega Saver self-audit (read-only)." }` and
`store: { type: "string", description: "Override store directory (used with --cache)." }`.
`run` becomes `async`; with `--cache` it renders ONLY the cache checks through the existing `renderReport`/`exitCodeFor` and returns before the env/saver path (spec Locked Decision 1).

**Steps:**

- [ ] Append the failing handler test to `apps/cli/test/doctor.test.ts` (reuse the file's existing spies + temp-HOME rig; `as never` Citty invocation per cli-test-pattern):

```ts
it("--cache renders the focused cache report and exits 0 on a clean machine", async () => {
  const store = mkdtempSync(join(tmpdir(), "megasaver-doctor-cache-flag-"));
  try {
    await doctorCommand.run?.({
      args: { cache: true, store },
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("cache-self-audit byte-stable PASS");
    expect(out).toContain("cache-receipts");
    expect(out).not.toContain("claude-code-hook-telemetry"); // focused: env/saver path skipped
    expect(process.exitCode).toBe(0);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});
```

(Note: `--store` short-circuits the XDG branch via `resolveStorePath` — cli-test-pattern. The file's HOME stub does NOT protect the user-scope rows: `run()`'s default paths resolve via `os.homedir()`, which ignores the stubbed env (recorded WHY at doctor.test.ts:210-213), so on a dev machine `cache-settings`/`cache-claude-md-user` read the real `~/.claude`. The assertions are chosen to be robust against that: user-config findings are warn rows that keep `pass: true` and exit 0, so the test asserts only the in-process `cache-self-audit` row and the `--store`-scoped `cache-receipts` row, as written.)

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/doctor.test.ts` — expect FAIL (unknown arg).
- [ ] Wire `doctor.ts`: import `runDoctorCacheChecks` from `./doctor-cache.js` and `readStoreEnv`/`resolveStorePath` from `../store.js`; on `args.cache` resolve `storeRoot` exactly as cache.ts:269-271 does, `console.log(renderReport(await runDoctorCacheChecks({ storeRoot, cwd: process.cwd() })))`, set `process.exitCode` via `exitCodeFor`, `return`.
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/doctor.test.ts test/doctor-cache.test.ts test/doctor-saver.test.ts test/commands/cache.test.ts` — expect PASS (regression: default doctor and Pro `mega cache --suffix-audit` unchanged).
- [ ] Smoke evidence (DoD #5, capture the terminal session into the PR/verify notes): `pnpm --filter @megasaver/cli build && node apps/cli/dist/cli.js doctor --cache` — expect the six-row report; on this dev machine the CLAUDE.md rows may WARN (real dates/uuids) and exit code must still be 0.
- [ ] Add `.changeset/cache-doctor.md`:

```md
---
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

`mega doctor --cache`: read-only suffix-stability lint — hook-stack churn
heuristics, CLAUDE.md volatility patterns, MCP scope overlap, counts-only
proxy-receipt correlation, and a byte-determinism self-audit of Mega Saver's
own generated blocks (new connector exports: lint* detectors,
defaultByteVarianceRenderers, appended CACHE_SUFFIX_RISK_CODES).
```

- [ ] Commit: `feat(cli): add mega doctor --cache suffix lint`
- [ ] Update wiki: `wiki/syntheses/cache-write-cost-reduction-2026-08-01.md` — mark B5+B6 "spec'd + implemented (cache-doctor, wave-2 #3)"; append `wiki/log.md` entry. Commit: `docs(wiki): record cache-doctor B5+B6 landing`
- [ ] Full gate: `pnpm verify` — expect green before requesting review (`code-reviewer`, fresh context; author ≠ reviewer).
