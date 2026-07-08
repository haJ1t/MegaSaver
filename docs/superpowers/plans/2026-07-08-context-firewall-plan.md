# Context Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega firewall` (Pro module 10, 1.12): checksummed PII detection in policy, an always-on value-free firewall event ledger written by the context-gate orchestrator, and a Pro-gated windowed audit report.

**Architecture:** `policy` gains three validate-gated PII redaction patterns (card/Luhn, IBAN/mod-97, TCKN) plus an email count-only observer, and `redact()` additively returns per-detector `findings`/`observed`. `filterOutput` (pure) carries those counts out on `FilterOutputResult.firewall`; the context-gate orchestrator (IO owner) maps them — plus path-gate denials — to append-only events in `<store>/firewall/events.jsonl` (never values, F-FW-1). A pure `diagnoseFirewall` in pro-analytics windows/aggregates the events; a thin Pro CLI renders it, mirroring `mega cache` verbatim (its `--json`/`--days` lessons included).

**Tech Stack:** TypeScript strict ESM (NodeNext), Vitest, Zod, Biome. Spec: `docs/superpowers/specs/2026-07-08-context-firewall-design.md`. Risk HIGH.

**Conventions for every task:** run tests from the owning package dir (`cd packages/<pkg> && npx vitest run <file>`); `npx biome check --write <changed files>` before each commit; commit from the worktree root. Follow the code below verbatim — deviations require a BLOCKED report, not a workaround. No new dependency edges (`apps/cli → @megasaver/context-gate` and `apps/cli → @megasaver/pro-analytics` already exist; verify with `grep context-gate apps/cli/package.json` before assuming anything else).

---

### Task 1: PII checksum validators (policy)

**Files:**
- Create: `packages/policy/src/pii-validators.ts`
- Test: `packages/policy/test/pii-validators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/policy/test/pii-validators.test.ts
import { describe, expect, it } from "vitest";
import { ibanValid, luhnValid, tcknValid } from "../src/pii-validators.js";

describe("luhnValid", () => {
  it("accepts classic Luhn-valid test cards (16 and 15 digits)", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
  });
  it("rejects a checksum-broken card", () => {
    expect(luhnValid("4111111111111112")).toBe(false);
  });
  it("rejects out-of-range lengths (12 and 20 digits)", () => {
    expect(luhnValid("411111111111")).toBe(false);
    expect(luhnValid("41111111111111111111")).toBe(false);
  });
  it("accepts boundary lengths when Luhn-valid (13 and 19 digits)", () => {
    // 13-digit: 4222222222222 is a classic Visa 13-digit test number.
    expect(luhnValid("4222222222222")).toBe(true);
    // 19-digit: base 621234567890123283 + Luhn check digit 7 (digit sum 83 → c=7).
    expect(luhnValid("6212345678901232837")).toBe(true);
  });
});

describe("ibanValid", () => {
  it("accepts the ISO example and a TR sample", () => {
    expect(ibanValid("GB82WEST12345698765432")).toBe(true);
    expect(ibanValid("TR330006100519786457841326")).toBe(true);
  });
  it("rejects a mod-97-broken IBAN", () => {
    expect(ibanValid("GB82WEST12345698765431")).toBe(false);
  });
  it("rejects a malformed shape (too short / bad prefix)", () => {
    expect(ibanValid("GB82WEST1")).toBe(false);
    expect(ibanValid("8282WEST12345698765432")).toBe(false);
  });
});

describe("tcknValid", () => {
  it("accepts the canonical valid test id", () => {
    expect(tcknValid("10000000146")).toBe(true);
  });
  it("rejects a checksum-broken id", () => {
    expect(tcknValid("10000000147")).toBe(false);
  });
  it("rejects a leading zero and wrong lengths", () => {
    expect(tcknValid("01000000146")).toBe(false);
    expect(tcknValid("1000000014")).toBe(false);
    expect(tcknValid("100000001467")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/policy && npx vitest run test/pii-validators.test.ts`
Expected: FAIL — cannot resolve `../src/pii-validators.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/policy/src/pii-validators.ts
// Checksum validators for the PII redaction patterns (spec §Architecture/1).
// All three never throw on arbitrary digit strings — they return false.

export function luhnValid(digits: string): boolean {
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function ibanValid(candidate: string): boolean {
  const s = candidate.toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  // ISO 13616: move the first four chars to the end, map A→10..Z→35, mod 97
  // computed incrementally so the big number never overflows.
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

export function tcknValid(digits: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(digits)) return false;
  const d = (i: number): number => digits.charCodeAt(i) - 48;
  const odd = d(0) + d(2) + d(4) + d(6) + d(8);
  const even = d(1) + d(3) + d(5) + d(7);
  // JS % can be negative when even > odd*7 — normalize into 0..9.
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d(9)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += d(i);
  return sum % 10 === d(10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/policy && npx vitest run test/pii-validators.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Biome + commit**

```bash
npx biome check --write packages/policy/src/pii-validators.ts packages/policy/test/pii-validators.test.ts
git add packages/policy/src/pii-validators.ts packages/policy/test/pii-validators.test.ts
git commit -m "feat(policy): PII checksum validators"
```

---

### Task 2: PII patterns + email observer + redact() findings (policy)

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts` (schema gains optional `validate`; three PII patterns appended AFTER the existing 16; new `OBSERVED_PATTERNS` export)
- Modify: `packages/policy/src/redact.ts` (full replacement below)
- Modify: `packages/policy/src/index.ts` (export the new types; keep existing exports intact)
- Test: `packages/policy/test/redact-pii.test.ts` (new file — do NOT touch the existing redact tests; they must pass unchanged as the regression corpus)

- [ ] **Step 1: Write the failing test**

```ts
// packages/policy/test/redact-pii.test.ts
import { describe, expect, it } from "vitest";
import { redact, redactWithFindings } from "../src/redact.js";

describe("redactWithFindings — PII patterns (validate-gated)", () => {
  it("redacts a Luhn-valid card, including separator forms", () => {
    const r = redactWithFindings("card 4111111111111111 and 4111 1111 1111 1111 and 4111-1111-1111-1111");
    expect(r.redacted).not.toContain("4111111111111111");
    expect(r.redacted).toContain("[REDACTED:credit_card]");
    expect(r.findings).toContainEqual({ name: "credit_card", count: 3 });
  });

  it("leaves a checksum-broken 16-digit run alone", () => {
    const r = redactWithFindings("not a card: 4111111111111112");
    expect(r.redacted).toContain("4111111111111112");
    expect(r.findings.some((f) => f.name === "credit_card")).toBe(false);
  });

  it("redacts a valid IBAN and rejects a broken one", () => {
    const r = redactWithFindings("pay GB82WEST12345698765432 not GB82WEST12345698765431");
    expect(r.redacted).toContain("[REDACTED:iban]");
    expect(r.redacted).toContain("GB82WEST12345698765431");
    expect(r.findings).toContainEqual({ name: "iban", count: 1 });
  });

  it("redacts a valid TCKN and rejects a broken one", () => {
    const r = redactWithFindings("tckn 10000000146 vs 10000000147");
    expect(r.redacted).toContain("[REDACTED:tr_national_id]");
    expect(r.redacted).toContain("10000000147");
    expect(r.findings).toContainEqual({ name: "tr_national_id", count: 1 });
  });

  it("observes emails without redacting them", () => {
    const r = redactWithFindings("author a@example.com reviewer b@test.org");
    expect(r.redacted).toContain("a@example.com");
    expect(r.redacted).toContain("b@test.org");
    expect(r.observed).toEqual([{ name: "email", count: 2 }]);
  });

  it("keeps the aggregate count in sync and reports secrets in findings too", () => {
    const r = redactWithFindings("token ghp_0123456789abcdef0123456789abcdef0123 card 4111111111111111");
    expect(r.count).toBe(2);
    expect(r.findings.map((f) => f.name).sort()).toEqual(["credit_card", "github_token"]);
  });

  it("returns empty findings/observed on clean text", () => {
    const r = redactWithFindings("nothing sensitive here");
    expect(r).toEqual({ redacted: "nothing sensitive here", count: 0, findings: [], observed: [] });
  });
});

describe("redact — 2-field public contract preserved (non-breaking)", () => {
  it("still returns exactly {redacted, count} — no findings/observed keys", () => {
    const r = redact("nothing sensitive here");
    expect(r).toEqual({ redacted: "nothing sensitive here", count: 0 });
    expect(Object.keys(r).sort()).toEqual(["count", "redacted"]);
  });

  it("also catches the new PII patterns (behavior change, not shape change)", () => {
    const r = redact("card 4111111111111111");
    expect(r.redacted).toContain("[REDACTED:credit_card]");
    expect(r.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/policy && npx vitest run test/redact-pii.test.ts`
Expected: FAIL — `findings`/`observed` undefined, PII patterns missing.

- [ ] **Step 3a: Extend `redaction-patterns.ts`**

Three edits, all inside the existing file:

(1) Extend the schema (replace the existing `redactionPatternSchema` object):

```ts
const redactionPatternSchema = z.object({
  name: z.string(),
  pattern: z.instanceof(RegExp),
  replacement: z.string(),
  validate: z
    .custom<(match: string) => boolean>((v) => typeof v === "function")
    .optional(),
});
```

(2) Append to the `baseline` array, AFTER the last existing entry (order matters: PII runs after secrets; replacement tokens contain no digits so no double-count — spec §Architecture/1). Import at top of file: `import { ibanValid, luhnValid, tcknValid } from "./pii-validators.js";`

```ts
  {
    // 13–19 digits with optional single space/dash separators. The regex is
    // deliberately broad; the Luhn validate gate is what makes it precise.
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replacement: "[REDACTED:credit_card]",
    validate: (match: string) => luhnValid(match.replace(/[ -]/g, "")),
  },
  {
    name: "iban",
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g,
    replacement: "[REDACTED:iban]",
    validate: (match: string) => ibanValid(match),
  },
  {
    name: "tr_national_id",
    pattern: /\b[1-9][0-9]{10}\b/g,
    replacement: "[REDACTED:tr_national_id]",
    validate: (match: string) => tcknValid(match),
  },
```

(3) Add the observer list at the end of the file (same schema, no replacement needed but keep shape uniform; the replacement string is unused for observers):

```ts
// Count-only observers: matches are COUNTED into RedactResult.observed but the
// text is never modified (spec: email redaction corrupts git/package metadata
// the agent legitimately needs).
const observedBaseline: RedactionPattern[] = [
  {
    name: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "",
  },
];
export const OBSERVED_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(observedBaseline);
```

(If the file validates `baseline` through the schema at module load — it does — the appended PII entries flow through the same parse. Keep that.)

- [ ] **Step 3b: Replace `redact.ts` (full file)**

CRITICAL: `redact()` keeps its EXACT 2-field return (`{redacted, count}`) — 9
call sites and ~20 existing tests assert that exact shape via `.toEqual`, so
adding fields to it breaks them. The firewall detail lives in a SEPARATE
`redactWithFindings()`; `redact()` strips to two fields. Both apply the new PII
patterns (behavior is compatible for the existing corpus, which has no
checksum-valid PII).

```ts
// packages/policy/src/redact.ts
import { OBSERVED_PATTERNS, REDACTION_PATTERNS } from "./redaction-patterns.js";

export type DetectorCount = { name: string; count: number };

// Unchanged public contract — do NOT add fields here.
export type RedactResult = { redacted: string; count: number };

// Richer variant for the firewall path (filterOutput only).
export type RedactFindings = {
  redacted: string;
  count: number;
  findings: DetectorCount[];
  observed: DetectorCount[];
};

export function redactWithFindings(text: string): RedactFindings {
  let redacted = text;
  let count = 0;
  const findings: DetectorCount[] = [];
  for (const { name, pattern, replacement, validate } of REDACTION_PATTERNS) {
    let patternCount = 0;
    redacted = redacted.replace(pattern, (match) => {
      if (validate !== undefined && !validate(match)) return match;
      patternCount += 1;
      return replacement;
    });
    if (patternCount > 0) {
      count += patternCount;
      findings.push({ name, count: patternCount });
    }
  }
  const observed: DetectorCount[] = [];
  for (const { name, pattern } of OBSERVED_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches !== null && matches.length > 0) {
      observed.push({ name, count: matches.length });
    }
  }
  return { redacted, count, findings, observed };
}

// Existing signature preserved: strip the richer result to {redacted, count}.
export function redact(text: string): RedactResult {
  const { redacted, count } = redactWithFindings(text);
  return { redacted, count };
}
```

- [ ] **Step 3c: Export from `packages/policy/src/index.ts`**

Find the existing line exporting from `./redact.js` and extend it to also export the new type; add `OBSERVED_PATTERNS` to the redaction-patterns export line:

```ts
export {
  redact,
  redactWithFindings,
  type RedactResult,
  type RedactFindings,
  type DetectorCount,
} from "./redact.js";
```

(Keep whatever else those lines already export.)

- [ ] **Step 4: Run the FULL policy suite (regression gate)**

Run: `cd packages/policy && npx vitest run`
Expected: PASS — the new file AND every pre-existing test. Because `redact()`'s
2-field shape is preserved, the existing `.toEqual({redacted, count})` tests
pass untouched. If any existing test fails on the redacted STRING or COUNT (not
shape), a PII pattern changed old behavior → report BLOCKED, do not adjust the
old tests.

- [ ] **Step 5: Biome + commit**

```bash
npx biome check --write packages/policy/src/redaction-patterns.ts packages/policy/src/redact.ts packages/policy/src/index.ts packages/policy/test/redact-pii.test.ts
git add packages/policy/src packages/policy/test/redact-pii.test.ts
git commit -m "feat(policy): PII redaction + email observer + findings"
```

---

### Task 3: carry firewall counts out of filterOutput (output-filter)

**Files:**
- Modify: `packages/output-filter/src/types.ts` (type + redact call + both result constructions)
- Test: `packages/output-filter/test/firewall-field.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/output-filter/test/firewall-field.test.ts
import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/index.js";

describe("filterOutput — firewall counts on the result", () => {
  it("reports redacted findings and observed emails", async () => {
    const raw = [
      "line with card 4111111111111111",
      "contact dev@example.com",
      `${"filler line to keep the pipeline in normal mode\n".repeat(20)}`,
    ].join("\n");
    const r = await filterOutput({
      raw,
      intent: "find the card",
      mode: "balanced",
      maxReturnedBytes: 4000,
    });
    expect(r.firewall).toEqual({
      findings: [{ name: "credit_card", count: 1 }],
      observed: [{ name: "email", count: 1 }],
    });
  });

  it("omits the field entirely on clean input", async () => {
    const r = await filterOutput({
      raw: "clean text\n".repeat(10),
      intent: "read",
      mode: "balanced",
      maxReturnedBytes: 4000,
    });
    expect(r.firewall).toBeUndefined();
  });
});
```

(If `filterOutput`'s input schema requires fields not listed here, mirror the minimal valid input used by the existing tests in `packages/output-filter/test/` — check `filter-output.test.ts` for the canonical minimal call and reuse its shape. Do not weaken the schema.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/output-filter && npx vitest run test/firewall-field.test.ts`
Expected: FAIL — `firewall` undefined on the result.

- [ ] **Step 3: Implement in `types.ts`**

(1) Add to `FilterOutputResult` (after the `deduped?` field):

```ts
  firewall?: {
    findings: ReadonlyArray<{ name: string; count: number }>;
    observed: ReadonlyArray<{ name: string; count: number }>;
  };
```

(2) Change the import at the top of `types.ts` from `redact` to
`redactWithFindings` (the `@megasaver/policy` import line — swap the named
import; `redact` is no longer used in this file), then replace the current
redact lines:

```ts
  const { redacted, count } = redact(raw);
  if (count > 0) warnings.push(`redacted ${count} secret(s) before processing`);
```

with:

```ts
  const redaction = redactWithFindings(raw);
  const { redacted } = redaction;
  if (redaction.count > 0) {
    warnings.push(`redacted ${redaction.count} secret(s) before processing`);
  }
  const firewall =
    redaction.findings.length > 0 || redaction.observed.length > 0
      ? { findings: redaction.findings, observed: redaction.observed }
      : undefined;
```

(3) Attach at BOTH result-construction sites (the outline branch `const base: FilterOutputResult = {` and the normal-path `const result: FilterOutputResult = {`): add the spread line inside each object literal:

```ts
    ...(firewall !== undefined ? { firewall } : {}),
```

- [ ] **Step 4: Run the full output-filter suite**

Run: `cd packages/output-filter && npx vitest run`
Expected: PASS (new tests + all existing).

- [ ] **Step 5: Biome + commit**

```bash
npx biome check --write packages/output-filter/src/types.ts packages/output-filter/test/firewall-field.test.ts
git add packages/output-filter/src/types.ts packages/output-filter/test/firewall-field.test.ts
git commit -m "feat(output-filter): firewall counts on filter result"
```

---

### Task 4: firewall ledger writer (context-gate)

**Files:**
- Create: `packages/context-gate/src/firewall-ledger.ts`
- Modify: `packages/context-gate/src/index.ts` (add exports)
- Test: `packages/context-gate/test/firewall-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/context-gate/test/firewall-ledger.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFirewallEvent,
  appendFirewallEventsFromFilter,
  firewallEventSchema,
  firewallLogPath,
} from "../src/firewall-ledger.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fw-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const AT = "2026-07-08T12:00:00.000Z";

describe("firewall ledger", () => {
  it("appends schema-valid JSONL and creates the directory on first write", () => {
    appendFirewallEvent(root, { at: AT, kind: "blocked-read", detector: "secret-path", count: 1, sourcePath: "/repo/.env" });
    appendFirewallEvent(root, { at: AT, kind: "redacted", detector: "credit_card", count: 2 });
    const lines = readFileSync(firewallLogPath(root), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(firewallEventSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });

  it("swallows write failures (F-FW-3: auditing never breaks the pipeline)", () => {
    // Point the store at a path whose parent is a FILE so mkdir fails.
    appendFirewallEvent(join(root, "not-a-dir"), { at: AT, kind: "redacted", detector: "iban", count: 1 });
    // no throw is the assertion; and nothing was created
    expect(existsSync(join(root, "not-a-dir"))).toBe(false);
  });

  it("maps filter firewall counts to one event per detector", () => {
    appendFirewallEventsFromFilter(
      root,
      { at: AT, sourcePath: "/repo/data.md", projectId: "p1", sessionId: "s1" },
      {
        findings: [
          { name: "credit_card", count: 2 },
          { name: "github_token", count: 1 },
        ],
        observed: [{ name: "email", count: 3 }],
      },
    );
    const lines = readFileSync(firewallLogPath(root), "utf8").trim().split("\n");
    const events = lines.map((l) => firewallEventSchema.parse(JSON.parse(l)));
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.kind === "redacted")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "observed")).toEqual([
      expect.objectContaining({ detector: "email", count: 3, projectId: "p1", sessionId: "s1" }),
    ]);
  });

  it("is a no-op when the filter result carried no firewall field", () => {
    appendFirewallEventsFromFilter(root, { at: AT }, undefined);
    expect(existsSync(firewallLogPath(root))).toBe(false);
  });

  it("F-FW-1: the ledger never contains matched values", () => {
    // Even a hostile caller cannot put values in: the schema has no value
    // field and .strict() rejects extras.
    const parsed = firewallEventSchema.safeParse({
      at: AT, kind: "redacted", detector: "credit_card", count: 1, value: "4111111111111111",
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/context-gate && npx vitest run test/firewall-ledger.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `firewall-ledger.ts`**

```ts
// packages/context-gate/src/firewall-ledger.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// Value-free by construction (F-FW-1): there is no field for matched text and
// .strict() rejects any extra. Only detector names and occurrence counts.
export const firewallEventSchema = z
  .object({
    at: z.string().datetime(),
    kind: z.enum(["blocked-read", "redacted", "observed"]),
    detector: z.string().min(1),
    count: z.number().int().positive(),
    sourcePath: z.string().optional(),
    projectId: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .strict();
export type FirewallEvent = z.infer<typeof firewallEventSchema>;

export function firewallLogPath(storeRoot: string): string {
  return join(storeRoot, "firewall", "events.jsonl");
}

// Best-effort (F-FW-3): auditing must never break the saver pipeline.
export function appendFirewallEvent(storeRoot: string, event: FirewallEvent): void {
  try {
    const path = firewallLogPath(storeRoot);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  } catch {
    // swallowed (F-FW-3)
  }
}

export type FirewallScope = {
  at: string;
  sourcePath?: string;
  projectId?: string;
  sessionId?: string;
};

export type FilterFirewallCounts = {
  findings: ReadonlyArray<{ name: string; count: number }>;
  observed: ReadonlyArray<{ name: string; count: number }>;
};

export function appendFirewallEventsFromFilter(
  storeRoot: string,
  scope: FirewallScope,
  firewall: FilterFirewallCounts | undefined,
): void {
  if (firewall === undefined) return;
  for (const f of firewall.findings) {
    appendFirewallEvent(storeRoot, { ...scope, kind: "redacted", detector: f.name, count: f.count });
  }
  for (const o of firewall.observed) {
    appendFirewallEvent(storeRoot, { ...scope, kind: "observed", detector: o.name, count: o.count });
  }
}
```

- [ ] **Step 4: Export from `packages/context-gate/src/index.ts`** (append a new export block)

```ts
export {
  appendFirewallEvent,
  appendFirewallEventsFromFilter,
  firewallEventSchema,
  firewallLogPath,
  type FirewallEvent,
  type FirewallScope,
  type FilterFirewallCounts,
} from "./firewall-ledger.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/context-gate && npx vitest run test/firewall-ledger.test.ts`
Expected: PASS.

- [ ] **Step 6: Biome + commit**

```bash
npx biome check --write packages/context-gate/src/firewall-ledger.ts packages/context-gate/src/index.ts packages/context-gate/test/firewall-ledger.test.ts
git add packages/context-gate/src packages/context-gate/test/firewall-ledger.test.ts
git commit -m "feat(context-gate): value-free firewall event ledger"
```

---

### Task 5: orchestrator wiring — 6 sites (context-gate)

**Files:**
- Modify: `packages/context-gate/src/run.ts` (2 sites in `runOutputPipeline`, 2 in `runOverlayOutputPipeline`)
- Modify: `packages/context-gate/src/run-command.ts` (1 site in `runOutputExecCommand`, 1 in `runOverlayOutputExecCommand`)
- Test: `packages/context-gate/test/firewall-wiring.test.ts`

Anchors, not line numbers (the files evolve): in each pipeline function, the
deny site is the `if (!gate.ok)` branch that returns `reason: "path_denied"`;
the post-filter site is immediately after the `filterRaw(...)` /
`filterOutput(...)` result is available. `redact` is already imported in both
files; add the `appendFirewallEvent, appendFirewallEventsFromFilter` import
from `./firewall-ledger.js`. `input.storeRoot` is in scope at every site. Note
`const now = input.now ?? defaultNow;` is declared AFTER the gate in `run.ts`
— the deny snippet therefore inlines `(input.now ?? defaultNow)()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/context-gate/test/firewall-wiring.test.ts
// Integration-style: drive runOutputPipeline against a real temp store with
// (a) a denied secret path and (b) a readable file containing a planted card
// + email, then assert the events.jsonl contents — including the end-to-end
// F-FW-1 value-free invariant.
//
// Mirror the setup of the existing pipeline tests: copy the registry/settings
// bootstrap from packages/context-gate/test/run.test.ts (the canonical
// "pipeline happy path" test) — same fake registry, same settings shape, same
// tmpdir store. Do NOT invent a new harness. The assertions below are the
// contract; adapt only the boilerplate.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firewallLogPath } from "../src/firewall-ledger.js";
// + the same imports run.test.ts uses for runOutputPipeline and its registry fixture

const CARD = "4111111111111111";

describe("firewall wiring — pipeline emits events", () => {
  // beforeEach/afterEach: tmp store root + fixture registry (copy run.test.ts)

  it("path deny → one blocked-read event with detector secret-path", async () => {
    // call runOutputPipeline with path = <tmp>/.env (denylisted)
    // expect result.ok === false, reason "path_denied"
    // read events.jsonl: exactly one event, kind blocked-read,
    // detector "secret-path", sourcePath ending in ".env"
  });

  it("planted card + email → redacted + observed events; ledger is value-free (F-FW-1)", async () => {
    // write <tmp>/notes.md containing CARD and "dev@example.com" plus filler
    // call runOutputPipeline on it (settings.storeRawOutput true)
    // expect result.ok === true
    // read events.jsonl:
    //   - one event kind redacted, detector credit_card, count 1
    //   - one event kind observed, detector email, count 1
    //   - projectId/sessionId populated from the pipeline input
    // F-FW-1: the raw ledger text contains NO digit-run of 6+ chars.
    //   ISO timestamps/counts only carry runs ≤ 4, but the fixture's
    //   projectId/sessionId MUST be digit-free strings (e.g. "proj-fw",
    //   "sess-fw") or the assertion self-triggers:
    //   expect(/[0-9]{6,}/.test(ledgerText)).toBe(false)
    //   and expect(ledgerText).not.toContain(CARD)
  });

  it("ledger write failure never breaks the pipeline", async () => {
    // pre-create <store>/firewall as a FILE so mkdir/append fails,
    // run the planted-card read again, expect result.ok === true
  });
});
```

(The comments are the specification of each case; the implementer writes the
real bodies against run.test.ts's existing fixtures. The three `it` names and
every assertion listed MUST appear in the final test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/context-gate && npx vitest run test/firewall-wiring.test.ts`
Expected: FAIL — no events file written (wiring absent).

- [ ] **Step 3: Wire `run.ts` — `runOutputPipeline`**

Deny site — replace:

```ts
  if (!gate.ok) {
    return gate.code === "path_denied"
      ? { ok: false, reason: "path_denied", detail: gate.reason }
      : { ok: false, reason: "path_unsafe", detail: gate.message };
  }
```

with:

```ts
  if (!gate.ok) {
    if (gate.code === "path_denied") {
      appendFirewallEvent(input.storeRoot, {
        at: new Date((input.now ?? defaultNow)()).toISOString(),
        kind: "blocked-read",
        detector: "secret-path",
        count: 1,
        sourcePath: redact(input.path).redacted,
        projectId: settings.projectId,
        sessionId: input.sessionId,
      });
      return { ok: false, reason: "path_denied", detail: gate.reason };
    }
    return { ok: false, reason: "path_unsafe", detail: gate.message };
  }
```

Post-filter site — immediately after the line
`const { trace: rankingTrace, ...filteredSansTrace } = filteredResult;` add:

```ts
  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date(now()).toISOString(),
      sourcePath: redact(input.path).redacted,
      projectId: settings.projectId,
      sessionId: input.sessionId,
    },
    filteredResult.firewall,
  );
```

- [ ] **Step 4: Wire `run.ts` — `runOverlayOutputPipeline`** (same two snippets; substitute the overlay scope fields: `projectId: input.workspaceKey`, `sessionId: input.liveSessionId` — confirm the exact input field names at the top of the overlay function; they are the ones used to build its `sessionDir`).

- [ ] **Step 5: Wire `run-command.ts` — both exec functions.** Immediately after `const filtered = await filterOutput({ ... });` in each, add (using each function's own settings/session fields; the command label mirrors the existing `redactedCommand` convention):

```ts
  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date(now()).toISOString(),
      sourcePath: redact(`${input.command} ${input.args.join(" ")}`.trim()).redacted,
      projectId: settings.projectId,
      sessionId: input.sessionId,
    },
    filtered.firewall,
  );
```

(In the overlay exec function substitute its workspace/live-session scope
fields, mirroring Step 4. If `now` is not already defined at that point in a
function, inline `(input.now ?? defaultNow)()` — do not reorder existing code.)

- [ ] **Step 6: Run the full context-gate suite**

Run: `cd packages/context-gate && npx vitest run`
Expected: PASS — firewall-wiring tests green AND every pre-existing pipeline test unchanged.

- [ ] **Step 7: Biome + commit**

```bash
npx biome check --write packages/context-gate/src/run.ts packages/context-gate/src/run-command.ts packages/context-gate/test/firewall-wiring.test.ts
git add packages/context-gate/src packages/context-gate/test/firewall-wiring.test.ts
git commit -m "feat(context-gate): emit firewall events at ingress"
```

---

### Task 6: diagnoseFirewall analyzer (pro-analytics)

**Files:**
- Create: `packages/pro-analytics/src/firewall-report.ts`
- Modify: `packages/pro-analytics/src/index.ts` (re-export)
- Test: `packages/pro-analytics/test/firewall-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pro-analytics/test/firewall-report.test.ts
import { describe, expect, it } from "vitest";
import { FIREWALL_ADVICE, diagnoseFirewall } from "../src/firewall-report.js";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");
const DAY = 86_400_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const ev = (over: Partial<Parameters<typeof diagnoseFirewall>[0][number]> = {}) => ({
  at: at(60_000),
  kind: "redacted" as const,
  detector: "credit_card",
  count: 1,
  ...over,
});

describe("diagnoseFirewall", () => {
  it("defaults to a 7-day window and filters older events", () => {
    const r = diagnoseFirewall([ev(), ev({ at: at(8 * DAY) })], { now: NOW });
    expect(r.windowDays).toBe(7);
    expect(r.events).toBe(1);
  });

  it("honors a custom window", () => {
    const r = diagnoseFirewall([ev({ at: at(8 * DAY) })], { now: NOW, days: 30 });
    expect(r.events).toBe(1);
  });

  it("skips unparseable timestamps instead of throwing", () => {
    const r = diagnoseFirewall([ev({ at: "not-a-date" }), ev()], { now: NOW });
    expect(r.events).toBe(1);
  });

  it("aggregates blocked reads per path, sorted by count desc then path, top 10", () => {
    const events = [
      ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: "/a/.env", count: 3 }),
      ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: "/b/id_rsa", count: 3 }),
      ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: "/a/.env", count: 1 }),
      ...Array.from({ length: 12 }, (_, i) =>
        ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: `/x/${i}.pem`, count: 1 }),
      ),
    ];
    const r = diagnoseFirewall(events, { now: NOW });
    expect(r.blockedReads[0]).toEqual({ sourcePath: "/a/.env", count: 4 });
    expect(r.blockedReads[1]).toEqual({ sourcePath: "/b/id_rsa", count: 3 });
    expect(r.blockedReads).toHaveLength(10);
  });

  it("aggregates redactions per detector and counts observed emails", () => {
    const r = diagnoseFirewall(
      [
        ev({ detector: "github_token", count: 2 }),
        ev({ detector: "credit_card", count: 1 }),
        ev({ detector: "github_token", count: 1 }),
        ev({ kind: "observed" as const, detector: "email", count: 5 }),
      ],
      { now: NOW },
    );
    expect(r.redactedByDetector).toEqual([
      { detector: "github_token", count: 3 },
      { detector: "credit_card", count: 1 },
    ]);
    expect(r.observedEmails).toBe(5);
  });

  it("emits one advice line per non-empty category (pinned strings)", () => {
    const r = diagnoseFirewall(
      [
        ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: "/a/.env" }),
        ev({ detector: "github_token" }),
        ev({ detector: "credit_card" }),
      ],
      { now: NOW },
    );
    expect(r.advice).toEqual([FIREWALL_ADVICE.blocked, FIREWALL_ADVICE.secrets, FIREWALL_ADVICE.pii]);
  });

  it("returns an all-empty report on no events", () => {
    const r = diagnoseFirewall([], { now: NOW });
    expect(r).toEqual({
      windowDays: 7,
      events: 0,
      blockedReads: [],
      redactedByDetector: [],
      observedEmails: 0,
      advice: [],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/pro-analytics && npx vitest run test/firewall-report.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `firewall-report.ts`**

```ts
// packages/pro-analytics/src/firewall-report.ts
// Pure analyzer over firewall ledger events (spec §Architecture/4). Structural
// input type — pro-analytics must not import context-gate (no new dep edges).

export interface FirewallEventInput {
  at: string;
  kind: "blocked-read" | "redacted" | "observed";
  detector: string;
  count: number;
  sourcePath?: string;
}

export interface FirewallReport {
  windowDays: number;
  events: number;
  blockedReads: Array<{ sourcePath: string; count: number }>;
  redactedByDetector: Array<{ detector: string; count: number }>;
  observedEmails: number;
  advice: string[];
}

export const FIREWALL_ADVICE = {
  blocked:
    "the agent attempted to read secret files — review the prompts/workflows that pointed it there",
  secrets: "secrets passed through tool output — rotate any recently pasted credentials",
  pii: "PII appeared in tool output — check what files/commands expose customer data",
} as const;

const PII_DETECTORS = new Set(["credit_card", "iban", "tr_national_id"]);
const TOP_BLOCKED = 10;
const DAY_MS = 86_400_000;

export function diagnoseFirewall(
  events: FirewallEventInput[],
  opts: { now: number; days?: number },
): FirewallReport {
  const windowDays = opts.days ?? 7;
  const sinceMs = opts.now - windowDays * DAY_MS;
  const inWindow = events.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= sinceMs && t <= opts.now;
  });

  const blockedMap = new Map<string, number>();
  const redactedMap = new Map<string, number>();
  let observedEmails = 0;
  for (const e of inWindow) {
    if (e.kind === "blocked-read") {
      const key = e.sourcePath ?? "(unknown)";
      blockedMap.set(key, (blockedMap.get(key) ?? 0) + e.count);
    } else if (e.kind === "redacted") {
      redactedMap.set(e.detector, (redactedMap.get(e.detector) ?? 0) + e.count);
    } else if (e.detector === "email") {
      observedEmails += e.count;
    }
  }

  const blockedReads = [...blockedMap]
    .map(([sourcePath, count]) => ({ sourcePath, count }))
    .sort((a, b) => b.count - a.count || a.sourcePath.localeCompare(b.sourcePath))
    .slice(0, TOP_BLOCKED);
  const redactedByDetector = [...redactedMap]
    .map(([detector, count]) => ({ detector, count }))
    .sort((a, b) => b.count - a.count || a.detector.localeCompare(b.detector));

  const advice: string[] = [];
  if (blockedReads.length > 0) advice.push(FIREWALL_ADVICE.blocked);
  if (redactedByDetector.some((r) => !PII_DETECTORS.has(r.detector))) {
    advice.push(FIREWALL_ADVICE.secrets);
  }
  if (redactedByDetector.some((r) => PII_DETECTORS.has(r.detector))) {
    advice.push(FIREWALL_ADVICE.pii);
  }

  return { windowDays, events: inWindow.length, blockedReads, redactedByDetector, observedEmails, advice };
}
```

- [ ] **Step 4: Re-export from `packages/pro-analytics/src/index.ts`** (append, matching the file's existing style):

```ts
export {
  diagnoseFirewall,
  FIREWALL_ADVICE,
  type FirewallEventInput,
  type FirewallReport,
} from "./firewall-report.js";
```

- [ ] **Step 5: Run the full pro-analytics suite**

Run: `cd packages/pro-analytics && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Biome + commit**

```bash
npx biome check --write packages/pro-analytics/src/firewall-report.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/firewall-report.test.ts
git add packages/pro-analytics/src packages/pro-analytics/test/firewall-report.test.ts
git commit -m "feat(pro-analytics): firewall audit report"
```

---

### Task 7: `mega firewall` CLI command

**Files:**
- Create: `apps/cli/src/commands/firewall.ts`
- Test: `apps/cli/test/commands/firewall.test.ts`

Mirror `apps/cli/src/commands/cache.ts` (read it first — the structure below
matches it deliberately: gate FIRST, boundary-parsed `--days` capped at 3650,
`--json` ALWAYS JSON including no-data, injected log reader, corrupt-line
skip, lazy pro-analytics import after the gate).

- [ ] **Step 1: Write the failing test.** Copy the harness of
`apps/cli/test/commands/cache.test.ts` (license fixture, `run()` helper,
stdout/stderr capture) and adapt; the cases below are the contract:

```ts
// apps/cli/test/commands/firewall.test.ts — required cases (harness copied
// from cache.test.ts; usageLine() replaced by fwLine() building firewall
// events):
//
// const fwLine = (over = {}) => JSON.stringify({
//   at: new Date(NOW_MS - HOUR).toISOString(),
//   kind: "redacted", detector: "credit_card", count: 1, ...over });
//
// 1. gating: with NO license (each of {}, {json:true}, {days:"3"}): prints
//    FIREWALL_UPSELL, exit 0, readFirewallLog NEVER called.
// 2. rejects invalid --days at the boundary: ["0","-3","x","1.5","10000000"]
//    → exit 1, stderr contains "--days".
// 3. --json always emits JSON: (a) log: null → {"events":0,...} parses;
//    (b) only an 8-day-old event → events 0; both exit 0.
// 4. --days widens the window: 8-day-old event excluded at default, included
//    with days:"30" (windowDays 30, events 1) via --json.
// 5. prose report: a log with one blocked-read (/repo/.env), two redacted
//    detectors, one observed email →
//    stdout contains "Context firewall — last 7 days",
//    "blocked reads", "/repo/.env", "credit_card", FIREWALL advice lines,
//    and the footer "native agent reads bypass it".
// 6. corrupt lines are skipped: log = "not json\n" + fwLine() → events 1.
// 7. empty window prose: valid log, zero in-window → stdout contains
//    "no firewall events recorded", exit 0.
// 8. real-fs smoke: write a real events.jsonl under <tmp>/firewall/ via
//    appendFirewallEvent from @megasaver/context-gate, run with
//    defaultReadFirewallLog, assert the prose header renders.
```

Every numbered case becomes an `it(...)`; assertions listed are mandatory.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cli && npx vitest run test/commands/firewall.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `firewall.ts`**

```ts
// apps/cli/src/commands/firewall.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkEntitlement } from "@megasaver/entitlement";
import { type FirewallEvent, firewallEventSchema, firewallLogPath } from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const FIREWALL_UPSELL = `The context firewall audit is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export const NO_EVENTS_NOTE =
  "no firewall events recorded — either nothing was blocked or Mega Saver Mode is not routing this workspace";

const FOOTER =
  "note: the firewall guards the Mega Saver ingress surface (proxy tools + hooks); native agent reads bypass it";

// Boundary parse (§8): window drives date arithmetic downstream; the 3650 cap
// keeps `since` inside the JS Date range (cache-doctor lesson).
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type RunFirewallInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  readFirewallLog: (storeRoot: string) => string | null;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function defaultReadFirewallLog(storeRoot: string): string | null {
  try {
    return readFileSync(firewallLogPath(storeRoot), "utf8");
  } catch {
    return null;
  }
}

export async function runFirewall(input: RunFirewallInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(FIREWALL_UPSELL);
    return 0;
  }

  let days: number | undefined;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr(`Invalid --days ${input.days}: expected a whole number of days between 1 and 3650.`);
      return 1;
    }
    days = parsed;
  }

  const raw = input.readFirewallLog(input.storeRoot);
  const events: FirewallEvent[] = [];
  for (const line of raw === null ? [] : raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed);
    } catch {
      continue; // corrupt tail from a crashed writer must not kill the report
    }
    const result = firewallEventSchema.safeParse(parsedLine);
    if (result.success) events.push(result.data);
  }

  // Lazy import after the gate: never load the Pro compute on the free path.
  const { diagnoseFirewall } = await import("@megasaver/pro-analytics");
  const report = diagnoseFirewall(events, {
    now: input.now(),
    ...(days === undefined ? {} : { days }),
  });

  // --json is a stable contract: ALWAYS JSON, including the empty/no-log case.
  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.events === 0) {
    input.stdout(NO_EVENTS_NOTE);
    return 0;
  }

  input.stdout(`Context firewall — last ${report.windowDays} days`);
  input.stdout(`events ${report.events}`);
  if (report.blockedReads.length > 0) {
    input.stdout("");
    input.stdout("blocked reads:");
    for (const b of report.blockedReads) {
      input.stdout(`  ${b.sourcePath} · ${b.count}x`);
    }
  }
  if (report.redactedByDetector.length > 0) {
    input.stdout("");
    input.stdout("redacted:");
    for (const r of report.redactedByDetector) {
      input.stdout(`  ${r.detector} · ${r.count}x`);
    }
  }
  if (report.observedEmails > 0) {
    input.stdout("");
    input.stdout(`observed (not redacted): ${report.observedEmails} email(s)`);
  }
  if (report.advice.length > 0) {
    input.stdout("");
    for (const a of report.advice) {
      input.stdout(`fix: ${a}`);
    }
  }
  input.stdout("");
  input.stdout(FOOTER);
  return 0;
}

export const firewallCommand = defineCommand({
  meta: {
    name: "firewall",
    description:
      "Audit the context firewall — blocked secret reads, redactions, and PII observations (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default 7, max 3650)." },
    json: { type: "boolean", default: false, description: "Emit the FirewallReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runFirewall({
      storeRoot,
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      readFirewallLog: defaultReadFirewallLog,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

(If `resolve` ends up unused after transcription, drop the import — Biome will
flag it.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cli && npx vitest run test/commands/firewall.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Biome + commit**

```bash
npx biome check --write apps/cli/src/commands/firewall.ts apps/cli/test/commands/firewall.test.ts
git add apps/cli/src/commands/firewall.ts apps/cli/test/commands/firewall.test.ts
git commit -m "feat(cli): mega firewall — Pro ingress audit report"
```

---

### Task 8: register command + full-suite gate

**Files:**
- Modify: `apps/cli/src/main.ts` (register `firewall` exactly the way `cache` is registered — same import style, same subCommands entry, alphabetical placement beside it)
- Test: extend `apps/cli/test/commands/firewall.test.ts` with a registration smoke

- [ ] **Step 1: Add the registration test** (append to firewall.test.ts):

```ts
it("is registered as a `mega firewall` subcommand", async () => {
  const { mainCommand } = await import("../../src/main.js");
  const sub = (mainCommand as { subCommands?: Record<string, unknown> }).subCommands;
  expect(sub).toBeDefined();
  expect(Object.keys(sub ?? {})).toContain("firewall");
});
```

(Check how `cache`'s registration is asserted in `cache.test.ts` first — if a
registration smoke already has a canonical shape there, copy THAT shape
instead of the snippet above.)

- [ ] **Step 2: Register in `main.ts`** — one import + one subCommands entry mirroring `cache`.

- [ ] **Step 3: Rebuild changed dep packages, then run the FULL cli suite**

```bash
pnpm --filter @megasaver/policy build && pnpm --filter @megasaver/output-filter build && pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/pro-analytics build
cd apps/cli && npx vitest run
```
Expected: PASS — including the dependency-graph guard (no new edges were added; `@megasaver/context-gate` was already a CLI dep) and every pre-existing test.

- [ ] **Step 4: Biome + commit**

```bash
npx biome check --write apps/cli/src/main.ts apps/cli/test/commands/firewall.test.ts
git add apps/cli/src/main.ts apps/cli/test/commands/firewall.test.ts
git commit -m "feat(cli): register firewall command"
```

---

### Task 9: verify + changeset + README + wiki

**Files:**
- Create: `.changeset/context-firewall.md`
- Modify: `README.md` (Pro section: add the firewall row/paragraph right after the `mega cache` entry — grep `mega cache` to find it and mirror its format exactly)
- Modify: `wiki/entities/cli.md` (module-10 bullet, after the module-9 cache bullet)
- Modify: `wiki/log.md` (append a build entry)

- [ ] **Step 1: Changeset**

```md
---
"@megasaver/cli": minor
---

mega firewall: context-firewall audit (Pro). policy now detects checksummed
PII (credit card/Luhn, IBAN/mod-97, TR national id) alongside secrets and
counts emails without redacting them; every blocked secret-path read,
redaction, and observation is logged value-free to <store>/firewall/
events.jsonl (always on); `mega firewall` renders the windowed audit —
blocked reads, redactions by detector, observed emails, fixes.
```

- [ ] **Step 2: README** — one row/paragraph in the Pro features section, mirroring the `mega cache` entry's exact format, with the one-liner: "`mega firewall` — audit the ingress guard: blocked secret reads, PII/secret redactions, and a value-free leak ledger (`--days`, `--json`)."

- [ ] **Step 3: wiki/entities/cli.md** — add after the module-9 bullet:

```md
- **`mega firewall`** (module 10, 1.12) — Pro ingress audit over the always-on
  firewall ledger (`<store>/firewall/events.jsonl`, value-free by schema).
  policy gained validate-gated PII patterns (credit_card/Luhn, iban/mod-97,
  tr_national_id/TCKN) + an email count-only observer; the context-gate
  orchestrator emits blocked-read/redacted/observed events at 6 sites
  (pipeline+overlay deny/post-filter, 2 exec post-filter). F-FW-1..3
  invariants; report footer states the ingress-surface limit.
```

- [ ] **Step 4: wiki/log.md** — append:

```md
## [2026-07-08] build | module 10 — context firewall (1.12)

Implemented per docs/superpowers/plans/2026-07-08-context-firewall-plan.md:
policy PII validators + validate-gated patterns + email observer +
findings/observed on redact(); FilterOutputResult.firewall carries counts out
of the pure filter; context-gate firewall-ledger (value-free schema, F-FW-1,
best-effort F-FW-3) wired at 6 orchestrator sites; pro-analytics
diagnoseFirewall (7-day window, top-10 blocked, pinned advice);
`mega firewall` CLI (gate-first, --days 1..3650, --json always JSON, footer
states the ingress-surface limit). Evidence: per-package suites + full
`pnpm verify` green. Pending: HIGH review (code-reviewer AND critic) + PR +
merge + 1.12.0 release.
```

- [ ] **Step 5: Full verify from the worktree root**

Run: `pnpm verify`
Expected: green — biome, tsc, all suites, conventions:check.

- [ ] **Step 6: Commit**

```bash
git add .changeset/context-firewall.md README.md wiki/entities/cli.md wiki/log.md
git commit -m "docs: firewall changeset + README + wiki"
```

---

## Post-plan gates (controller, not plan tasks)

Per spec DoD (HIGH): after Task 9 — adversarial review (code-reviewer AND
critic lenses, separate fresh contexts; numerical lens optional here — no
dollar math, but include a PRIVACY lens on F-FW-1) → fix findings red-first →
PR → CI green → squash-merge (branch will carry churn) → changeset version PR
→ tag `v1.12.0` → release.yml auto-publish (NO manual npm publish) →
published-artifact smoke (`npx @megasaver/cli@1.12.0 firewall` free-path
upsell) → wiki "1.12.0 live" entry.
