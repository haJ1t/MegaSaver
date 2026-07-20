# Redaction Baseline Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the LOCKED secret-redaction baseline in `@megasaver/policy` with 31 cloud-credential detectors and fix a PKCS#8 defect in an existing one, so common provider credentials stop reaching git-committed agent config files through every redaction sink.

**Architecture:** Plain additive entries in the existing ordered `REDACTION_PATTERNS` table — no change to `RedactionPattern`, `redactWithFindings`, `redact`, or `redactForLedger`. The whole new prefix-anchored block runs ahead of the existing 19; the three context-gated detectors sit immediately after it. Safety rests on four gates that land before or alongside the detectors: a frozen snapshot of the original 19, a false-positive corpus asserting zero matches, behavioral plus structural ordering tests, and a ReDoS timing regression scoped to the new tier.

**Tech Stack:** TypeScript strict ESM, Zod (pattern-table validation at module load), vitest, biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design.md` — risk **CRITICAL** (§12: evidence-preserving redaction core, consumed by 8 sinks). Both design gates ran: architect **REVISE** and security-reviewer **REVISE**, integrated; security re-check **APPROVE_WITH_FIXES**, closed.

**Execution context:** worktree `.worktrees/redaction-baseline` on branch `feat/redaction-baseline-extension`, created by Task 1. All commands run from the worktree root. Task order is dependency order: 1 → 2 → 3 → 4a → 4b → 4c → 4d → 5 → 6 → 7 → 8 → 9 → 10.

**Load-bearing facts discovered while writing this plan (verified against source, not assumed):**

- `REDACTION_PATTERNS` is **not** exported from `packages/policy/src/index.ts`. Tests import from `../src/redaction-patterns.js` directly. Do not add an index export.
- `packages/policy` typechecks its tests as of 2026-07-20: the script is `tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit`, wired by the jwt ReDoS fix branch, matching the `packages/core` and `apps/cli` precedent. Task 1's wiring step is therefore already satisfied — verify with `pnpm --filter @megasaver/policy typecheck` and skip the edit.
- **No edit needed, recorded so the merge is expected rather than investigated:** Task 5's structural ordering test derives leading literals from `pattern.source` with a helper that stops at any `(` which is not `(?:`. The jwt fix changes `leadingLiterals(jwt)` from `["eyJ"]` to `[]` — identical to how the eleven existing lookbehind-gated entries already behave, so the test needs no change.
- The locked snapshot looks entries up **by name** and asserts the relative order of the original 19 as a filtered subsequence. It deliberately does **not** assert `REDACTION_PATTERNS.length === 19`, which would fail the moment Task 4a lands. Do not add a length assertion.
- Task 1 pins `private_key_block` in its **current** form so it is green against unmodified source; Task 3 flips that one snapshot entry as part of its own commit. That is this plan's only intended exception to the lock. There are **two** amended entries overall: `jwt` was already amended on `main` by `docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md`, so Task 1's snapshot pins the fixed `jwt` source from the start and Task 3 still flips exactly one entry.
- `packages/policy/test/redaction-detectors.test.ts` is **created by Task 3**. Tasks 4a–4d and 7 append to it.
- The FP corpus generator uses a fixed LCG (`Math.imul`), never `Math.random` — a corpus that varies between runs is not evidence. Every generated hex/base64 token starts with a digit so the `iban` detector's `[A-Z]{2}` lead can never enter, and generated digests are 40 or 64 characters, outside IBAN's 15–34 window.
- The corpus test asserts through `redact()`, not `pattern.test()`, so `credit_card`/`iban`/`tr_national_id` are judged **after** their `validate` gates. If a later task hits a corpus failure, the fix is to bump that family's seed base — never to weaken a detector, never to delete the line.

---

> **Dry-run verified 2026-07-20.** Both task bodies below were executed
> verbatim against unmodified `main` before this plan was written, then removed
> and the tree restored (`git status --porcelain packages/policy` clean). The
> snapshot ran 22 passed / 22, the mutation check produced exactly the
> `AKIA[0-9A-Z]{16}` → `{15}` diff on `keeps aws_access_key byte-identical`, the
> corpus ran 13 passed / 13 with 5,010 lines, and
> `tsc -p tsconfig.test.json --noEmit` exited 0. The expected outputs quoted in
> the steps are observed, not predicted.

### Task 1: LOCKED snapshot of the current 19 detectors

**Files:**
- Create: `packages/policy/test/redaction-locked.test.ts`
- Modify: `packages/policy/package.json` (typecheck script — see Step 2)
- Test: `packages/policy/test/redaction-locked.test.ts`

This task lands FIRST. It converts the §2 safety invariant into a CI gate, so
every later task in this chain (the `private_key_block` fix, the 28
prefix-anchored detectors, the 3 context-gated detectors) is bounded by a
mechanical assertion that the original 19 did not drift.

The frozen table records the CURRENT source of `private_key_block`
(`[A-Z ]+`), because this task must pass against **unmodified** source. Task 3
flips that single entry to the fixed PKCS#8 form as part of the change it
gates.

The snapshot is written to be forward-compatible with Tasks 4a–4d and 7, which
grow the table from 19 to 50: it looks entries up **by name**, asserts field
equality, and asserts that the *relative order* of the 19 among themselves is
unchanged. It deliberately does NOT assert `REDACTION_PATTERNS.length === 19`,
which would fail the moment a new detector lands and would have to be edited by
the very task it exists to gate.

- [ ] **Step 1: Create the worktree** — the chain is CRITICAL risk (§12), so no
  edits happen on `main`.

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver && \
    git worktree add .worktrees/redaction-baseline -b feat/redaction-baseline-extension main
  ```
  Expected: `Preparing worktree (new branch 'feat/redaction-baseline-extension')`
  followed by `HEAD is now at <sha> ...`. Every remaining step in this plan runs
  from `/Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline`.

  Then install and build so `vitest` and the workspace deps resolve:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && pnpm install
  ```
  Expected: pnpm reports `Done in …s` with no `ERR_PNPM_*`.

- [ ] **Step 2: Close the typecheck gap on `test/`** — VERIFIED TRAP. The
  policy package's script is `"typecheck": "tsc -b --noEmit"`, and
  `packages/policy/tsconfig.json` carries `"exclude": ["test", "dist",
  "node_modules", ".turbo"]`. `packages/policy/tsconfig.test.json` exists but
  **nothing runs it** — no package script, no turbo task, and
  `vitest.config.ts` only type-checks `test/**/*.test-d.ts` via
  `tsconfig.test-d.json`. A type error in any of the seven new test files this
  chain adds would pass CI silently. `packages/core` and `apps/cli` already
  carry the fix; match them.

  Edit `packages/policy/package.json`, replacing this line:
  ```json
    "typecheck": "tsc -b --noEmit",
  ```
  with:
  ```json
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
  ```

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy typecheck
  ```
  Expected: exit 0, no diagnostics. (If the pre-existing `test/` files emit
  errors here, they are pre-existing and must be fixed before continuing —
  record them; do not proceed with a red typecheck.)

- [ ] **Step 3: Write the LOCKED snapshot test** — this is the gate; it is
  written before any source change in the chain.

  Create `packages/policy/test/redaction-locked.test.ts` with exactly:
  ```ts
  import { describe, expect, it } from "vitest";
  import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

  type LockedEntry = {
    name: string;
    source: string;
    flags: string;
    replacement: string;
    hasValidate: boolean;
  };

  // Frozen §9d baseline. Transcribed from the compiled RegExp objects, not by
  // hand: any edit to an existing detector's regex, flags, replacement, or
  // validate gate fails here. Task 3 updates exactly one entry
  // (`private_key_block`) and nothing else.
  const LOCKED: readonly LockedEntry[] = [
    {
      name: "github_token",
      source: "gh[pousr]_[A-Za-z0-9]{36,}",
      flags: "g",
      replacement: "gh*_[REDACTED]",
      hasValidate: false,
    },
    {
      name: "anthropic_key",
      source: "sk-ant-[A-Za-z0-9\\-_]{20,}",
      flags: "g",
      replacement: "sk-ant-[REDACTED]",
      hasValidate: false,
    },
    {
      name: "openai_key",
      source: "sk-[A-Za-z0-9]{20,}",
      flags: "g",
      replacement: "sk-[REDACTED]",
      hasValidate: false,
    },
    {
      name: "aws_access_key",
      source: "AKIA[0-9A-Z]{16}",
      flags: "g",
      replacement: "AKIA[REDACTED]",
      hasValidate: false,
    },
    {
      name: "aws_secret_key",
      source: "(?<=aws_secret_access_key\\s*=\\s*)[A-Za-z0-9/+]{40}",
      flags: "g",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "bearer_token",
      source: "bearer\\s+[A-Za-z0-9\\-._~+/=]{20,}",
      flags: "gi",
      replacement: "Bearer [REDACTED]",
      hasValidate: false,
    },
    {
      name: "jwt",
      source: "(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
      flags: "g",
      replacement: "eyJ[REDACTED]",
      hasValidate: false,
    },
    {
      name: "private_key_block",
      source: "-----BEGIN [A-Z ]+PRIVATE KEY-----[\\s\\S]+?-----END [A-Z ]+PRIVATE KEY-----",
      flags: "g",
      replacement: "[REDACTED PRIVATE KEY]",
      hasValidate: false,
    },
    {
      name: "env_value",
      source: "(?<=^[A-Z_]+=)[\"'].+?[\"']",
      flags: "gm",
      replacement: '"[REDACTED]"',
      hasValidate: false,
    },
    {
      name: "db_url",
      source: "(?:postgres|postgresql|mysql|mongodb):\\/\\/[^\\s/]+:[^\\s@]+@\\S+",
      flags: "g",
      replacement: "[scheme]://[REDACTED]@[host]",
      hasValidate: false,
    },
    {
      name: "url_basic_auth",
      source:
        "(?<=[a-z][a-z0-9+.-]*:\\/\\/)[^\\s/?#:]*:[^\\s?#]+?(?=@(?:[^\\s/?#@:]+(?:[/?#:]|$)|\\s|$))",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "url_query_secret",
      source:
        "(?<=[?&#](?:access[_-]?token|api[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?(?:id|token)|id[_-]?token|token|secret|password|passwd|pwd|apikey|signature)=)[^&\\s#\"'<>]+",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "cli_secret_flag_eq",
      source:
        "(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)=)(?:\"[^\"]*\"|'[^']*'|[^\\s\"']+)",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "cli_secret_flag_spaced",
      source:
        "(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)[ \\t])(?:\"[^\"]*\"|'[^']*')",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "api_key_header",
      source:
        "(?<=(?:x-api-key|x-auth-token|x-access-token)\\s*[:=]\\s*)(?:\"[^\"]*\"|'[^']*'|[^\\s\"']{8,})",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "basic_auth_header",
      source: "(?<=authorization\\s*[:=]\\s*basic\\s+)[A-Za-z0-9+/=]{8,}",
      flags: "gi",
      replacement: "[REDACTED]",
      hasValidate: false,
    },
    {
      name: "credit_card",
      source: "\\b(?:\\d[ -]?){12,18}\\d\\b",
      flags: "g",
      replacement: "[REDACTED:credit_card]",
      hasValidate: true,
    },
    {
      name: "iban",
      source: "\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\\b",
      flags: "gi",
      replacement: "[REDACTED:iban]",
      hasValidate: true,
    },
    {
      name: "tr_national_id",
      source: "\\b[1-9][0-9]{10}\\b",
      flags: "g",
      replacement: "[REDACTED:tr_national_id]",
      hasValidate: true,
    },
  ];

  describe("REDACTION_PATTERNS — LOCKED §9d baseline (spec §9.4)", () => {
    it("freezes 19 detectors", () => {
      expect(LOCKED).toHaveLength(19);
    });

    it("keeps every locked detector present exactly once", () => {
      const counts = new Map<string, number>();
      for (const { name } of REDACTION_PATTERNS) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const missing = LOCKED.filter((entry) => (counts.get(entry.name) ?? 0) !== 1);
      expect(missing.map((entry) => entry.name)).toEqual([]);
    });

    for (const entry of LOCKED) {
      it(`keeps ${entry.name} byte-identical`, () => {
        const live = REDACTION_PATTERNS.find((pattern) => pattern.name === entry.name);
        expect(live).toBeDefined();
        expect({
          name: live?.name,
          source: live?.pattern.source,
          flags: live?.pattern.flags,
          replacement: live?.replacement,
          hasValidate: live?.validate !== undefined,
        }).toEqual(entry);
      });
    }

    it("keeps the relative order of the locked 19 unchanged", () => {
      const lockedNames = new Set(LOCKED.map((entry) => entry.name));
      const liveOrder = REDACTION_PATTERNS.filter((pattern) =>
        lockedNames.has(pattern.name),
      ).map((pattern) => pattern.name);
      expect(liveOrder).toEqual(LOCKED.map((entry) => entry.name));
    });
  });
  ```

- [ ] **Step 4: Run the snapshot against unmodified source (expect GREEN)** —
  a characterization test of untouched code is green by construction; Step 5
  is what proves it is not vacuous.

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy test -- test/redaction-locked.test.ts
  ```
  Expected: `Test Files  1 passed (1)` and `Tests  22 passed (22)`
  (1 length + 1 presence + 19 per-detector + 1 order).

- [ ] **Step 5: Mutation check — prove the gate actually bites (expect RED,
  then GREEN)** — the real red bar for a snapshot test. Perturb one locked
  regex, confirm the gate fails, revert, confirm it passes again.

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    sed -i '' 's|/AKIA\[0-9A-Z\]{16}/g|/AKIA[0-9A-Z]{15}/g|' packages/policy/src/redaction-patterns.ts && \
    pnpm --filter @megasaver/policy test -- test/redaction-locked.test.ts
  ```
  Expected: FAIL. `Tests  1 failed | 21 passed (22)`, with the failing test
  named `keeps aws_access_key byte-identical` and a diff showing
  `- "source": "AKIA[0-9A-Z]{16}"` / `+ "source": "AKIA[0-9A-Z]{15}"`.

  Revert and re-run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    git checkout -- packages/policy/src/redaction-patterns.ts && \
    pnpm --filter @megasaver/policy test -- test/redaction-locked.test.ts
  ```
  Expected: `Tests  22 passed (22)`, and `git status --porcelain
  packages/policy/src/redaction-patterns.ts` prints nothing.

- [ ] **Step 6: Full package suite + lint + typecheck** — spec §9.8 requires
  the four existing redaction suites to pass unmodified.

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy test && \
    pnpm --filter @megasaver/policy typecheck && \
    pnpm lint
  ```
  Expected: vitest reports all policy test files passed including
  `test/redact.test.ts`, `test/redact-pii.test.ts`,
  `test/redact-unstructured.test.ts`, `test/redact.property.test.ts`;
  `tsc` exits 0 for both projects; biome prints `Checked … files … No fixes
  applied.` with no errors.

- [ ] **Step 7: Commit** —

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    git add packages/policy/test/redaction-locked.test.ts packages/policy/package.json && \
    git commit -m "test(policy): freeze locked redaction snapshot" -m "The redaction baseline is a CRITICAL path consumed by every sink, and the
  next commits interleave 31 new detectors ahead of the existing ones. Land
  the gate before the change it gates: this snapshot pins name, regex source,
  flags, replacement, and validate-presence for the original 19, plus their
  relative order, so any unintended drift fails CI rather than shipping.

  The package typecheck script never covered test/ (tsconfig.json excludes it
  and nothing ran tsconfig.test.json), so a type error in the seven test files
  this chain adds would have passed silently. Wired the same way core and cli
  already do it."
  ```
  Expected: `2 files changed`, one insertion-heavy new file plus the one-line
  script change.

---

### Task 2: False-positive corpus fixture, green against today's 19

**Files:**
- Create: `packages/policy/test/redaction-corpus.ts`
- Create: `packages/policy/test/redaction-corpus.test.ts`
- Test: `packages/policy/test/redaction-corpus.test.ts`

Spec §11.1: the corpus lands **before** the detectors it gates, asserted green
against today's 19. A corpus failure in a later task is then unambiguously
caused by a new detector, not by a corpus defect.

The fixture is generators plus the specific strings the design gates caught —
not 4,500 hand-written lines. Two invariants keep the generated bulk safe from
today's validator-gated detectors: every generated hex/base64 token is forced
to start with a digit (so the `iban` regex, which needs a leading `[A-Z]{2}`,
can never enter), and generated digests are either 40 or 64 characters (outside
`iban`'s 15–34 window) or bounded by non-word delimiters.

The assertion runs through `redact()`, not `pattern.test()`, so `credit_card`,
`iban`, and `tr_national_id` are judged on their post-`validate` behavior —
their raw regexes are allowed to match as long as the gate rejects and the
count stays 0.

- [ ] **Step 1: Write the failing corpus test first** — it imports a fixture
  that does not exist yet, so this is a genuine red bar.

  Create `packages/policy/test/redaction-corpus.test.ts` with exactly:
  ```ts
  import { describe, expect, it } from "vitest";
  import { redact } from "../src/redact.js";
  import { GATE_CAUGHT_LINES, NON_SECRET_CORPUS } from "./redaction-corpus.js";

  describe("redaction FP corpus — the strings the design gates caught (spec §9.2)", () => {
    for (const line of GATE_CAUGHT_LINES) {
      it(`leaves untouched: ${line.slice(0, 48)}`, () => {
        expect(redact(line)).toEqual({ redacted: line, count: 0 });
      });
    }
  });

  describe("redaction FP corpus — zero matches over the whole corpus (spec §9.2)", () => {
    it("is large enough to be evidence", () => {
      expect(NON_SECRET_CORPUS.length).toBeGreaterThan(4000);
    });

    it("redacts nothing, line by line", () => {
      const offenders = NON_SECRET_CORPUS.filter((line) => redact(line).count > 0);
      expect(offenders).toEqual([]);
    });

    it("redacts nothing when the corpus is one multi-line document", () => {
      const document = NON_SECRET_CORPUS.join("\n");
      expect(redact(document)).toEqual({ redacted: document, count: 0 });
    });
  });
  ```

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy test -- test/redaction-corpus.test.ts
  ```
  Expected: FAIL before any test runs, with
  `Error: Failed to load url ./redaction-corpus.js` /
  `Failed to resolve import "./redaction-corpus.js" from "test/redaction-corpus.test.ts"`
  and `Test Files  1 failed (1)`.

- [ ] **Step 2: Write the deterministic token generators** — the bottom half of
  the fixture. Create `packages/policy/test/redaction-corpus.ts` with exactly:
  ```ts
  // False-positive corpus for the redaction baseline (spec §9.2). Generators
  // plus the exact strings the design gates caught, not 4,500 literal lines.
  //
  // Every generated token is forced to start with a digit so it can never enter
  // the `iban` regex, whose lead is [A-Z]{2}. Generation is a fixed LCG, not
  // Math.random: a corpus that changes between runs cannot be evidence.

  const HEX = "0123456789abcdef";
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function stream(seed: number, length: number, alphabet: string): string {
    let state = (seed >>> 0) || 1;
    let out = "0";
    for (let i = 1; i < length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out += alphabet.charAt((state >>> 13) % alphabet.length);
    }
    return out;
  }

  const hex = (length: number, seed: number): string => stream(seed, length, HEX);
  const b64 = (length: number, seed: number): string => stream(seed, length, B64);

  const uuid = (seed: number): string =>
    `${hex(8, seed)}-${hex(4, seed + 1)}-4${hex(3, seed + 2)}-a${hex(3, seed + 3)}-${hex(12, seed + 4)}`;

  // 64-char uppercase digest carrying the Twilio-SID shape (AC + 32 hex) that
  // produced 45 false positives in the design harness (spec §7).
  const acDigest = (seed: number): string =>
    `${hex(4, seed)}AC${hex(32, seed + 1)}${hex(26, seed + 2)}`.toUpperCase();

  const bulk = (count: number, make: (index: number) => string): string[] =>
    Array.from({ length: count }, (_unused, index) => make(index));

  const pick = <T>(items: readonly [T, ...T[]], index: number): T =>
    items[index % items.length] ?? items[0];

  const ENV_NAMES = [
    "SERVICE_HOST",
    "LOG_LEVEL",
    "NODE_ENV",
    "CACHE_DIR",
    "APP_REGION",
    "BUILD_TARGET",
  ] as const;
  ```

- [ ] **Step 3: Add the curated gate-caught lines** — append to
  `packages/policy/test/redaction-corpus.ts`:
  ```ts
  const MD5_A = "3b2f8e1c9d0a4b6e7f5c8a1d2e3b4f60";
  const MD5_B = "7d4a1e0c5b982f36a0d17e4c8b25f39a";
  const MD5_C = "2c9e5f81a3b04d67e8f12a5c9b3d740e";
  const MD5_D = "5a1c3e7f92b8046d1e5a9c2f7b3d8046";
  const SHA1_A = "7c3d5e9a1b2f4086cd71e3a95b0f2d6c8a4e1b37";

  // The exact strings the architect and security gates flagged. `mailgun_private_key`
  // was dropped over the first four; the `ghs_` shape is why `github_app_token`
  // is anchored to <numeric app id>_<JWT> instead of GitHub's own loose form.
  export const GATE_CAUGHT_LINES: readonly string[] = [
    `cache key-${MD5_A} hit`,
    `memcached: key-${MD5_B} ttl=300`,
    `s3://bucket/key-${MD5_C}.json`,
    `DEL key-${MD5_D}`,
    `add_app_key: ${SHA1_A}`,
    `odd-api-key = ${MD5_A}`,
    "ghs_handler_registry_for_the_whole_application_module",
    "src/ghs_internal.helpers.for-tests-and-fixtures-only.ts",
    `SHA256 (dist/index.js) = ${acDigest(1)}`,
    `Digest: ${acDigest(2)}`,
  ];
  ```

- [ ] **Step 4: Add the programmatic bulk and export the corpus** — append to
  `packages/policy/test/redaction-corpus.ts`:
  ```ts
  const GENERATED: readonly string[] = [
    ...bulk(400, (i) => `commit ${hex(40, 1_000 + i)} refactor the session store`),
    ...bulk(400, (i) => `COMMIT ${hex(40, 2_000 + i).toUpperCase()} MERGED INTO main`),
    ...bulk(300, (i) => `blob ${hex(64, 3_000 + i)} packages/core/src/index.ts`),
    ...bulk(300, (i) => `SHA256 (dist/chunk-${i}.js) = ${acDigest(4_000 + i)}`),
    ...bulk(400, (i) => `run id ${uuid(5_000 + i)} finished in ${40 + (i % 90)}ms`),
    ...bulk(400, (i) => `payload=${b64(88, 6_000 + i)}`),
    ...bulk(200, (i) => `background-image: url(data:image/png;base64,${b64(64, 7_000 + i)});`),
    ...bulk(400, (i) => `      "integrity": "sha512-${b64(86, 8_000 + i)}==",`),
    ...bulk(
      400,
      (i) =>
        `node_modules/.pnpm/vitest@2.1.8/node_modules/vitest/dist/chunk-${hex(8, 9_000 + i)}.js`,
    ),
    ...bulk(
      200,
      (i) =>
        `!function(e,t){"use strict";var n=${i},r="chunk-${hex(8, 10_000 + i)}";e.exports=function(){return n+r}}(module,void 0);`,
    ),
    ...bulk(
      400,
      (i) =>
        `    at Object.run (/Users/dev/app/node_modules/vitest/dist/chunk-${hex(8, 11_000 + i)}.js:${120 + i}:15)`,
    ),
    ...bulk(300, (i) => `  "cacheDir": "/Users/dev/.cache/megasaver/${hex(32, 12_000 + i)}",`),
    ...bulk(300, (i) => `${pick(ENV_NAMES, i)}=service-${i}.internal.example.com`),
    ...bulk(300, (i) => `.mega-panel__row--variant-${i} { padding-inline: ${i % 32}px; }`),
    ...bulk(300, (i) => `feature-flag-slug-${i}-rollout-cohort-${i % 7}`),
  ];

  export const NON_SECRET_CORPUS: readonly string[] = [...GATE_CAUGHT_LINES, ...GENERATED];
  ```

  Note on the `.env`-shaped family: the values are deliberately **unquoted**.
  `env_value` matches `(?<=^[A-Z_]+=)["'].+?["']` — a quoted value there is a
  true positive by design, not a false one, so quoting these lines would be
  asserting the wrong thing.

- [ ] **Step 5: Run the corpus test (expect GREEN)** —

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy test -- test/redaction-corpus.test.ts
  ```
  Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)` (10 gate-caught
  lines + size + line-by-line + joined-document).

  If `redacts nothing, line by line` fails, the assertion prints the offending
  lines verbatim. Diagnose before editing: `redact()` was used precisely so a
  `credit_card`/`iban`/`tr_national_id` hit means the *validator* accepted, not
  just the regex. Fix by changing the offending literal seed (e.g. bump the
  `1_000 + i` base for that family) — never by weakening a detector, and never
  by deleting the line.

- [ ] **Step 6: Full package suite + lint + typecheck** —

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    pnpm --filter @megasaver/policy test && \
    pnpm --filter @megasaver/policy typecheck && \
    pnpm lint
  ```
  Expected: all policy suites pass (including `redaction-locked.test.ts` from
  Task 1 and the four untouched pre-existing redaction suites); `tsc` exits 0
  for both `tsconfig.json` and `tsconfig.test.json` — this is the first run
  where the Step-2 typecheck wiring from Task 1 actually covers new `test/`
  code; biome prints no errors.

- [ ] **Step 7: Commit** —

  Run:
  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.worktrees/redaction-baseline && \
    git add packages/policy/test/redaction-corpus.ts packages/policy/test/redaction-corpus.test.ts && \
    git commit -m "test(policy): add redaction false-positive corpus" -m "Landing the false-positive gate before the 31 detectors it gates means a
  corpus failure in the next commits is unambiguously a new detector's fault,
  not a corpus defect (spec 11.1).

  Asserted through redact() rather than pattern.test() so the credit_card,
  iban, and tr_national_id validate gates are exercised: their raw regexes may
  match corpus text, and the contract being tested is that nothing is
  rewritten.

  Generators plus the exact strings the design gates caught, seeded from a
  fixed LCG. A corpus that changes between runs is not evidence."
  ```
  Expected: `2 files changed`, both new.
### Task 3: `private_key_block` PKCS#8 fix (spec §4d)

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts` (line 56 — the one regex)
- Create: `packages/policy/test/redaction-detectors.test.ts` (PKCS#8 before/after block; Task 4a–4d **append** to this file, they do not create it)
- Modify: `packages/policy/test/redaction-locked.test.ts` (Task 1's snapshot — the `private_key_block` entry only)

Spec §4d gives the fixed regex verbatim:

```
-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----
```

Today's regex (`packages/policy/src/redaction-patterns.ts:56`) is
`/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g` —
`[A-Z ]+` requires **at least one** qualifier character, so a bare
`-----BEGIN PRIVATE KEY-----` header (PKCS#8, the header in every Google
service-account JSON) does not match and the whole key body is emitted in
cleartext. `private_key_block` is index 7 of the 19 LOCKED detectors; this is the
only deliberate exception to the §2 no-behaviour-change invariant introduced by
this plan; the `jwt` amendment landed separately on `main` before Task 1 ran.

---

- [ ] **Step 1: Write the failing before/after test.**

Create `packages/policy/test/redaction-detectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

const PEM_BODY = "b".repeat(64);

const pem = (qualifier: string): string =>
  `-----BEGIN ${qualifier}PRIVATE KEY-----\n${PEM_BODY}\n-----END ${qualifier}PRIVATE KEY-----`;

// spec §4d — the header shape that today's `[A-Z ]+` cannot reach.
const PKCS8_BARE = pem("");

const GCP_SERVICE_ACCOUNT_JSON =
  '{"type":"service_account","project_id":"demo-project",' +
  `"private_key":"-----BEGIN PRIVATE KEY-----\\n${PEM_BODY}\\n-----END PRIVATE KEY-----\\n",` +
  '"client_email":"svc@demo-project.iam.gserviceaccount.com"}';

const REGRESSION_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ["RSA", pem("RSA ")],
  ["EC", pem("EC ")],
  ["DSA", pem("DSA ")],
  ["OPENSSH", pem("OPENSSH ")],
  ["ENCRYPTED", pem("ENCRYPTED ")],
];

describe("private_key_block — PKCS#8 fix (spec §4d)", () => {
  it("redacts a bare -----BEGIN PRIVATE KEY----- block", () => {
    const result = redact(PKCS8_BARE);
    expect(result.redacted).toBe("[REDACTED PRIVATE KEY]");
    expect(result.count).toBe(1);
  });

  it("redacts a GCP service-account JSON with escaped newlines", () => {
    const result = redact(GCP_SERVICE_ACCOUNT_JSON);
    expect(result.redacted).toContain("[REDACTED PRIVATE KEY]");
    expect(result.redacted).not.toContain("BEGIN PRIVATE KEY");
    expect(result.redacted).not.toContain(PEM_BODY);
    expect(result.redacted).toContain('"client_email"');
  });

  for (const [qualifier, sample] of REGRESSION_VARIANTS) {
    it(`still redacts a ${qualifier} PRIVATE KEY block`, () => {
      const result = redact(sample);
      expect(result.redacted).toBe("[REDACTED PRIVATE KEY]");
      expect(result.count).toBe(1);
    });
  }

  const NEAR_MISSES: ReadonlyArray<readonly [string, string]> = [
    ["CERTIFICATE", `-----BEGIN CERTIFICATE-----\n${PEM_BODY}\n-----END CERTIFICATE-----`],
    ["PUBLIC KEY", `-----BEGIN PUBLIC KEY-----\n${PEM_BODY}\n-----END PUBLIC KEY-----`],
    ["lowercase header", `-----begin private key-----\n${PEM_BODY}\n-----end private key-----`],
  ];

  for (const [label, sample] of NEAR_MISSES) {
    it(`leaves a ${label} block untouched`, () => {
      expect(redact(sample)).toEqual({ redacted: sample, count: 0 });
    });
  }
});
```

- [ ] **Step 2: Run it — expect RED on exactly two cases.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: 10 tests, **2 failed / 8 passed**. The two failures are
`redacts a bare -----BEGIN PRIVATE KEY----- block`
(`expected '-----BEGIN PRIVATE KEY-----…' to be '[REDACTED PRIVATE KEY]'`) and
`redacts a GCP service-account JSON with escaped newlines`
(`expected … to contain '[REDACTED PRIVATE KEY]'`). The five qualifier
regressions and the three near-misses pass **before** the fix — that is the
"after" baseline the fix must not move. Capture this output; it is the §4d
before-evidence.

- [ ] **Step 3: Apply the fix — one line.**

In `packages/policy/src/redaction-patterns.ts`, line 56, replace:

```ts
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
```

with:

```ts
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g,
```

Nothing else in the entry changes — `name`, `replacement: "[REDACTED PRIVATE KEY]"`,
no `validate`, and its index (7) stay exactly as they are. `[\s\S]` is retained
so a PEM collapsed onto one line with escaped newlines still matches.

- [ ] **Step 4: Re-run — expect GREEN.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: **10 passed**. Both previously-red cases now redact; all five
qualifier variants and all three near-misses still behave identically — zero
regression.

- [ ] **Step 5: Prove the Task-1 lock actually fires.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-locked.test.ts
```

Expected: **FAIL**, one assertion, on the `private_key_block` entry —
`expected '-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----'
to be '-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----'`.
Do not skip this step. A green run here means Task 1's snapshot is not reading
`pattern.source` and the lock is decorative — stop and fix Task 1 before
continuing.

- [ ] **Step 6: Update the snapshot entry to the fixed form.**

In `packages/policy/test/redaction-locked.test.ts`, in the frozen table, replace
the `private_key_block` entry:

```ts
  {
    name: "private_key_block",
    source: "-----BEGIN [A-Z ]+PRIVATE KEY-----[\\s\\S]+?-----END [A-Z ]+PRIVATE KEY-----",
    flags: "g",
    replacement: "[REDACTED PRIVATE KEY]",
    hasValidate: false,
  },
```

with:

```ts
  // WHY: the one sanctioned edit to the LOCKED 19 (spec §4d). `[A-Z ]+` demanded
  // at least one qualifier char, so bare PKCS#8 — the header in every GCP
  // service-account JSON — leaked. Re-pinned here, not exempted: any further
  // drift on this entry still fails.
  {
    name: "private_key_block",
    source:
      "-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\\s\\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----",
    flags: "g",
    replacement: "[REDACTED PRIVATE KEY]",
    hasValidate: false,
  },
```

The snapshot is re-pinned to a new constant, never loosened to a regex or
skipped — the lock keeps its full force on this entry from the next commit on.
This edit ships in the **same commit** as the source change, so the two are never
separately reviewable and no commit exists where the lock is red.

- [ ] **Step 7: Full verification of the package.**

```bash
pnpm --filter @megasaver/policy test
pnpm --filter @megasaver/policy typecheck && pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit
pnpm lint
```

Expected: all policy suites pass, including `redact.test.ts`,
`redact-pii.test.ts`, `redact-unstructured.test.ts`, `redact.property.test.ts`
untouched (spec §9.8), plus Task 1's `redaction-locked.test.ts` and Task 2's
`redaction-corpus.test.ts` green — the corpus must stay at zero matches, since a
loosened header could in principle fire on PEM-shaped prose. Both typecheck
invocations exit 0 and biome reports no diagnostics.

- [ ] **Step 8: Commit.**

```bash
git add packages/policy/src/redaction-patterns.ts \
        packages/policy/test/redaction-detectors.test.ts \
        packages/policy/test/redaction-locked.test.ts
git commit -m "$(cat <<'EOF'
fix(policy): PKCS#8 header qualifier optional

The private_key_block regex required at least one qualifier character
between BEGIN and PRIVATE KEY, so a bare -----BEGIN PRIVATE KEY-----
header never matched. That is the PKCS#8 form and the header in every
Google service-account JSON, so those keys passed through the redactor
in cleartext.

This is the single sanctioned change to the 19 LOCKED detectors
(spec §4d). The LOCKED snapshot entry is re-pinned to the fixed source
in this same commit rather than relaxed or exempted, so the lock stays
mechanical and any further drift on this entry still fails CI.

RSA, EC, DSA, OPENSSH and ENCRYPTED blocks are covered by regression
cases that were green before the change and are green after it.
EOF
)"
```
### Task 4a: Stripe (3) + OpenAI project key (1)

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Test (modify): `packages/policy/test/redaction-detectors.test.ts` (created in Task 3 — APPEND, do not create)

Spec §4a rows 1–4, in spec order, inserted at the TOP of `baseline` (ahead of
`github_token`) per §6 placement.

- [ ] **Step 1: Create the detector test file with shared helpers + Stripe cases** —
  Append to `packages/policy/test/redaction-detectors.test.ts` (Task 3 created it with the
  PKCS#8 block and the vitest import). Add the shared helpers below ONCE, directly after
  the existing imports, then the Stripe/OpenAI describe block at the end of the file.
  Do NOT re-add the `import { describe, expect, it } from "vitest";` line — it is already there:

```ts
import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";
import { REDACTION_PATTERNS, type RedactionPattern } from "../src/redaction-patterns.js";

// Detectors compile with `g`, so `.test()`/`.exec()` carry lastIndex between
// calls; every probe runs on a fresh non-global clone of the same source.
const detector = (name: string): RedactionPattern => {
  const found = REDACTION_PATTERNS.find((p) => p.name === name);
  if (found === undefined) throw new Error(`no detector named ${name}`);
  return found;
};

const matchOf = (name: string, text: string): string | null => {
  const { pattern } = detector(name);
  const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return probe.exec(text)?.[0] ?? null;
};

const expectRedacted = (name: string, token: string): void => {
  const result = redact(token);
  expect(result.redacted).toContain(detector(name).replacement);
  expect(result.redacted).not.toContain(token);
  expect(result.count).toBeGreaterThanOrEqual(1);
};

const STRIPE_LIVE = `sk_live_${"a".repeat(24)}`;
const STRIPE_TEST = `sk_test_${"a".repeat(24)}`;
const STRIPE_RK_LIVE = `rk_live_${"a".repeat(24)}`;
const STRIPE_RK_TEST = `rk_test_${"a".repeat(24)}`;

describe("stripe_live_secret_key (spec §4a)", () => {
  it("claims a real-shaped synthetic key in full", () => {
    expect(matchOf("stripe_live_secret_key", STRIPE_LIVE)).toBe(STRIPE_LIVE);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("stripe_live_secret_key", STRIPE_LIVE);
  });

  it("rejects one character short of the 24 minimum", () => {
    expect(matchOf("stripe_live_secret_key", `sk_live_${"a".repeat(23)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(matchOf("stripe_live_secret_key", `sk_live_${"a".repeat(23)}-`)).toBeNull();
  });

  it("rejects the prefix as a substring of a longer identifier", () => {
    expect(matchOf("stripe_live_secret_key", `mysk_live_${"a".repeat(24)}`)).toBeNull();
  });

  it("rejects an over-cap run rather than truncating it (trailing lookahead)", () => {
    expect(matchOf("stripe_live_secret_key", `sk_live_${"a".repeat(248)}`)).toBeNull();
  });
});

describe("stripe_test_secret_key (spec §4a)", () => {
  it("claims a real-shaped synthetic key in full", () => {
    expect(matchOf("stripe_test_secret_key", STRIPE_TEST)).toBe(STRIPE_TEST);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("stripe_test_secret_key", STRIPE_TEST);
  });

  it("rejects one character short of the 24 minimum", () => {
    expect(matchOf("stripe_test_secret_key", `sk_test_${"a".repeat(23)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(matchOf("stripe_test_secret_key", `sk_test_${"a".repeat(23)}.`)).toBeNull();
  });

  it("rejects the prefix as a substring of a longer identifier", () => {
    expect(matchOf("stripe_test_secret_key", `fixture_sk_test_${"a".repeat(24)}`)).toBeNull();
  });

  it("rejects an over-cap run rather than truncating it (trailing lookahead)", () => {
    expect(matchOf("stripe_test_secret_key", `sk_test_${"a".repeat(248)}`)).toBeNull();
  });
});

describe("stripe_restricted_key (spec §4a)", () => {
  it("claims both live and test restricted keys in full", () => {
    expect(matchOf("stripe_restricted_key", STRIPE_RK_LIVE)).toBe(STRIPE_RK_LIVE);
    expect(matchOf("stripe_restricted_key", STRIPE_RK_TEST)).toBe(STRIPE_RK_TEST);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("stripe_restricted_key", STRIPE_RK_LIVE);
  });

  it("rejects an environment word it does not cover", () => {
    expect(matchOf("stripe_restricted_key", `rk_prod_${"a".repeat(24)}`)).toBeNull();
  });

  it("rejects one character short of the 24 minimum", () => {
    expect(matchOf("stripe_restricted_key", `rk_live_${"a".repeat(23)}`)).toBeNull();
  });

  it("rejects the prefix as a substring of a longer identifier", () => {
    expect(matchOf("stripe_restricted_key", `work_live_${"a".repeat(24)}`)).toBeNull();
  });

  it("rejects an over-cap run rather than truncating it (trailing lookahead)", () => {
    expect(matchOf("stripe_restricted_key", `rk_test_${"a".repeat(248)}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new file and capture the RED failure** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: every `stripe_*` test fails with
  `Error: no detector named stripe_live_secret_key` (thrown from `detector`).
  Paste the real output into the task log; do not proceed on a different error.

- [ ] **Step 3: Add the three Stripe detectors** —
  In `packages/policy/src/redaction-patterns.ts`, insert these three entries
  immediately after `const baseline: RedactionPattern[] = [` (i.e. ahead of
  `github_token`, per §6 placement):

```ts
  {
    name: "stripe_live_secret_key",
    pattern: /\bsk_live_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])/g,
    replacement: "sk_live_[REDACTED]",
  },
  {
    name: "stripe_test_secret_key",
    pattern: /\bsk_test_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])/g,
    replacement: "sk_test_[REDACTED]",
  },
  {
    name: "stripe_restricted_key",
    pattern: /\brk_(?:live|test)_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])/g,
    replacement: "rk_*_[REDACTED]",
  },
```

- [ ] **Step 4: Run the file again and confirm GREEN** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 18 passing tests, 0 failing.

- [ ] **Step 5: Add the `openai_project_key` cases** —
  Append to `packages/policy/test/redaction-detectors.test.ts`:

```ts
const OPENAI_PROJECT = `sk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(24)}`;
const OPENAI_SVCACCT = `sk-svcacct-${"a".repeat(24)}T3BlbkFJ${"b".repeat(24)}`;
const OPENAI_ADMIN = `sk-admin-${"a".repeat(24)}T3BlbkFJ${"b".repeat(24)}`;

describe("openai_project_key (spec §4a)", () => {
  it("claims each of the three key classes in full", () => {
    expect(matchOf("openai_project_key", OPENAI_PROJECT)).toBe(OPENAI_PROJECT);
    expect(matchOf("openai_project_key", OPENAI_SVCACCT)).toBe(OPENAI_SVCACCT);
    expect(matchOf("openai_project_key", OPENAI_ADMIN)).toBe(OPENAI_ADMIN);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("openai_project_key", OPENAI_PROJECT);
  });

  it("is the detector that fires — the legacy sk- rule cannot match (spec §1)", () => {
    const legacy = new RegExp(detector("openai_key").pattern.source);
    expect(legacy.exec(OPENAI_PROJECT)).toBeNull();
    expect(redact(OPENAI_PROJECT).redacted).toContain("sk-*-[REDACTED]");
  });

  it("rejects a key without the T3BlbkFJ watermark", () => {
    expect(matchOf("openai_project_key", `sk-proj-${"a".repeat(60)}`)).toBeNull();
  });

  it("rejects one character short of the leading 20-run minimum", () => {
    expect(
      matchOf("openai_project_key", `sk-proj-${"a".repeat(19)}T3BlbkFJ${"b".repeat(24)}`),
    ).toBeNull();
  });

  it("rejects one character short of the trailing 20-run minimum", () => {
    expect(
      matchOf("openai_project_key", `sk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(19)}`),
    ).toBeNull();
  });

  it("rejects a trailing run outside the charset", () => {
    expect(
      matchOf("openai_project_key", `sk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(19)}.`),
    ).toBeNull();
  });

  it("rejects the prefix as a substring of a longer identifier", () => {
    expect(matchOf("openai_project_key", `xsk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(24)}`))
      .toBeNull();
  });

  it("rejects an over-cap trailing run rather than truncating it", () => {
    expect(
      matchOf("openai_project_key", `sk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(151)}`),
    ).toBeNull();
  });
});
```

- [ ] **Step 6: Run and capture the RED failure** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: the 18 Stripe tests still pass; all 9 `openai_project_key` tests fail
  with `Error: no detector named openai_project_key`.

- [ ] **Step 7: Add the `openai_project_key` detector** —
  In `packages/policy/src/redaction-patterns.ts`, insert immediately after the
  `stripe_restricted_key` entry:

```ts
  {
    // Both runs are bounded on purpose: `T3BlbkFJ` and `-` are inside the run's
    // own class, so an unbounded {20,} makes every `sk-proj-` a backtracking
    // start position (12.3 s at 313 KiB measured; 13.3 ms bounded).
    name: "openai_project_key",
    pattern:
      /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,150}T3BlbkFJ[A-Za-z0-9_-]{20,150}(?![A-Za-z0-9_-])/g,
    replacement: "sk-*-[REDACTED]",
  },
```

- [ ] **Step 8: Run and confirm GREEN** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 27 passing, 0 failing.

- [ ] **Step 9: Prove the gates from T1/T2 are still green** —
  `pnpm --filter @megasaver/policy test`
  Expected: the whole policy suite passes, including
  `redaction-corpus.test.ts` (zero matches over the FP corpus — the four new
  detectors must not fire on it), `redaction-locked.test.ts` (the original 19
  unchanged), `redact.test.ts`, `redact-pii.test.ts`,
  `redact-unstructured.test.ts`, `redact.property.test.ts`.

- [ ] **Step 10: Type-check tests + lint** —
  `pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit`
  then `pnpm lint`.
  Expected: both exit 0. `pnpm --filter @megasaver/policy typecheck` is NOT
  sufficient here — see notes.

- [ ] **Step 11: Commit** —
  `git add packages/policy/src/redaction-patterns.ts packages/policy/test/redaction-detectors.test.ts`
  then:

```
git commit -m "feat(policy): detect stripe + openai project keys" -m "The current OpenAI key format (sk-proj-/sk-svcacct-/sk-admin-) breaks the
existing sk- detector's character class at the first hyphen, so the whole
key survived redaction at every sink. Stripe secret and restricted keys had
no detector at all.

Both openai_project_key runs are bounded to {20,150}: the T3BlbkFJ watermark
and '-' are inside the run's own class, so an unbounded run turns every
sk-proj- occurrence into a backtracking start position (measured 12.3 s at
313 KiB, versus 13.3 ms bounded)."
```

---

### Task 4b: Google (2) + Slack (7)

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Test (modify): `packages/policy/test/redaction-detectors.test.ts`

Spec §4a rows 5–13, in spec order, inserted immediately after the Task 4a block
(still ahead of every existing detector).

- [ ] **Step 1: Add the two Google detector cases** —
  Append to `packages/policy/test/redaction-detectors.test.ts`:

```ts
const GOOGLE_API_KEY = `AIza${"a".repeat(35)}`;
const GOOGLE_OAUTH_SECRET = `GOCSPX-${"a".repeat(28)}`;

describe("google_api_key (spec §4a)", () => {
  it("claims a real-shaped synthetic key in full", () => {
    expect(matchOf("google_api_key", GOOGLE_API_KEY)).toBe(GOOGLE_API_KEY);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("google_api_key", GOOGLE_API_KEY);
  });

  it("rejects one character short of the fixed 35-run", () => {
    expect(matchOf("google_api_key", `AIza${"a".repeat(34)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(matchOf("google_api_key", `AIza${"a".repeat(20)}.${"a".repeat(14)}`)).toBeNull();
  });

  it("rejects a longer run rather than truncating it (trailing lookahead)", () => {
    expect(matchOf("google_api_key", `AIza${"a".repeat(36)}`)).toBeNull();
  });

  it("rejects the prefix embedded in a longer identifier run", () => {
    expect(matchOf("google_api_key", `config_AIza${"a".repeat(40)}_suffix`)).toBeNull();
  });
});

describe("google_oauth_client_secret (spec §4a)", () => {
  it("claims a real-shaped synthetic secret in full", () => {
    expect(matchOf("google_oauth_client_secret", GOOGLE_OAUTH_SECRET)).toBe(GOOGLE_OAUTH_SECRET);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("google_oauth_client_secret", GOOGLE_OAUTH_SECRET);
  });

  it("rejects one character short of the fixed 28-run", () => {
    expect(matchOf("google_oauth_client_secret", `GOCSPX-${"a".repeat(27)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(
      matchOf("google_oauth_client_secret", `GOCSPX-${"a".repeat(20)}.${"a".repeat(7)}`),
    ).toBeNull();
  });

  it("rejects a longer run rather than truncating it (trailing lookahead)", () => {
    expect(matchOf("google_oauth_client_secret", `GOCSPX-${"a".repeat(29)}`)).toBeNull();
  });

  it("rejects a lowercase prefix", () => {
    expect(matchOf("google_oauth_client_secret", `gocspx-${"a".repeat(28)}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and capture the RED failure** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: the 27 Task 4a tests pass; all 12 Google tests fail with
  `Error: no detector named google_api_key` /
  `Error: no detector named google_oauth_client_secret`.

- [ ] **Step 3: Add the two Google detectors** —
  In `packages/policy/src/redaction-patterns.ts`, insert immediately after the
  `openai_project_key` entry:

```ts
  {
    name: "google_api_key",
    pattern: /AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
    replacement: "AIza[REDACTED]",
  },
  {
    name: "google_oauth_client_secret",
    pattern: /GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/g,
    replacement: "GOCSPX-[REDACTED]",
  },
```

- [ ] **Step 4: Run and confirm GREEN** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 39 passing, 0 failing.

- [ ] **Step 5: Add the four Slack user/bot/legacy token cases** —
  Append to `packages/policy/test/redaction-detectors.test.ts`:

```ts
const SLACK_BOT = `xoxb-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(24)}`;
const SLACK_USER = `xoxp-${"1".repeat(10)}-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(28)}`;
const SLACK_WORKSPACE = `xoxa-2-${"a".repeat(32)}`;
const SLACK_LEGACY = `xoxo-1-2-3-${"a".repeat(32)}`;

describe("slack_bot_token (spec §4a)", () => {
  it("claims a real-shaped synthetic token in full", () => {
    expect(matchOf("slack_bot_token", SLACK_BOT)).toBe(SLACK_BOT);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_bot_token", SLACK_BOT);
  });

  it("rejects one character short of the 24-minimum secret run", () => {
    expect(
      matchOf("slack_bot_token", `xoxb-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(23)}`),
    ).toBeNull();
  });

  it("rejects a non-numeric team segment", () => {
    expect(
      matchOf("slack_bot_token", `xoxb-${"a".repeat(10)}-${"1".repeat(10)}-${"a".repeat(24)}`),
    ).toBeNull();
  });

  it("rejects the prefix inside a longer identifier", () => {
    expect(matchOf("slack_bot_token", "xoxbee-handler-registry")).toBeNull();
  });

  it("rejects an over-cap secret run rather than truncating it", () => {
    expect(
      matchOf("slack_bot_token", `xoxb-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(35)}`),
    ).toBeNull();
  });
});

describe("slack_user_token (spec §4a)", () => {
  it("claims a real-shaped synthetic token in full", () => {
    expect(matchOf("slack_user_token", SLACK_USER)).toBe(SLACK_USER);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_user_token", SLACK_USER);
  });

  it("rejects a token with only two numeric segments", () => {
    expect(
      matchOf("slack_user_token", `xoxp-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(28)}`),
    ).toBeNull();
  });

  it("rejects one character short of the 28-minimum secret run", () => {
    expect(
      matchOf(
        "slack_user_token",
        `xoxp-${"1".repeat(10)}-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(27)}`,
      ),
    ).toBeNull();
  });

  it("rejects an over-cap secret run rather than truncating it", () => {
    expect(
      matchOf(
        "slack_user_token",
        `xoxp-${"1".repeat(10)}-${"1".repeat(10)}-${"1".repeat(10)}-${"a".repeat(35)}`,
      ),
    ).toBeNull();
  });
});

describe("slack_legacy_workspace_token (spec §4a)", () => {
  it("claims a real-shaped synthetic token in full", () => {
    expect(matchOf("slack_legacy_workspace_token", SLACK_WORKSPACE)).toBe(SLACK_WORKSPACE);
  });

  it("claims the xoxr variant without the optional digit segment", () => {
    const token = `xoxr-${"a".repeat(16)}`;
    expect(matchOf("slack_legacy_workspace_token", token)).toBe(token);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_legacy_workspace_token", SLACK_WORKSPACE);
  });

  it("rejects one character short of the 8-minimum body", () => {
    expect(matchOf("slack_legacy_workspace_token", `xoxa-2-${"a".repeat(7)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(matchOf("slack_legacy_workspace_token", "xoxa-2-not_a_token_body")).toBeNull();
  });

  it("rejects an over-cap body rather than truncating it", () => {
    expect(matchOf("slack_legacy_workspace_token", `xoxa-2-${"a".repeat(49)}`)).toBeNull();
  });
});

describe("slack_legacy_token (spec §4a)", () => {
  it("claims a real-shaped synthetic token in full", () => {
    expect(matchOf("slack_legacy_token", SLACK_LEGACY)).toBe(SLACK_LEGACY);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_legacy_token", SLACK_LEGACY);
  });

  it("rejects one character short of the 16-minimum hex run", () => {
    expect(matchOf("slack_legacy_token", `xoxo-1-2-3-${"a".repeat(15)}`)).toBeNull();
  });

  it("rejects a non-hex tail", () => {
    expect(matchOf("slack_legacy_token", `xoxo-1-2-3-${"z".repeat(32)}`)).toBeNull();
  });

  it("rejects an over-cap hex run rather than truncating it", () => {
    expect(matchOf("slack_legacy_token", `xoxo-1-2-3-${"a".repeat(65)}`)).toBeNull();
  });
});
```

- [ ] **Step 6: Run and capture the RED failure** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 39 pass; the 22 new Slack tests fail with
  `Error: no detector named slack_bot_token` and the three sibling names.

- [ ] **Step 7: Add the four Slack token detectors** —
  In `packages/policy/src/redaction-patterns.ts`, insert immediately after the
  `google_oauth_client_secret` entry:

```ts
  {
    name: "slack_bot_token",
    pattern: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34}(?![A-Za-z0-9])/g,
    replacement: "xoxb-[REDACTED]",
  },
  {
    name: "slack_user_token",
    pattern: /xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9]{28,34}(?![A-Za-z0-9])/g,
    replacement: "xox*-[REDACTED]",
  },
  {
    name: "slack_legacy_workspace_token",
    pattern: /xox[ar]-(?:\d-)?[0-9A-Za-z]{8,48}(?![0-9A-Za-z])/g,
    replacement: "xox*-[REDACTED]",
  },
  {
    name: "slack_legacy_token",
    pattern: /xox[os]-\d+-\d+-\d+-[a-fA-F0-9]{16,64}(?![a-fA-F0-9])/g,
    replacement: "xox*-[REDACTED]",
  },
```

- [ ] **Step 8: Run and confirm GREEN** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 61 passing, 0 failing.

- [ ] **Step 9: Add the app / app-config / webhook cases** —
  Append to `packages/policy/test/redaction-detectors.test.ts`:

```ts
const SLACK_APP = `xapp-1-${"A".repeat(11)}-${"1".repeat(11)}-${"a".repeat(64)}`;
const SLACK_APP_CONFIG = `xoxe-1-${"a".repeat(150)}`;
const SLACK_APP_CONFIG_REFRESH = `xoxe.xoxb-1-${"a".repeat(150)}`;
const SLACK_WEBHOOK = `https://hooks.slack.com/services/${"a".repeat(45)}`;

describe("slack_app_token (spec §4a)", () => {
  it("claims a real-shaped synthetic token in full", () => {
    expect(matchOf("slack_app_token", SLACK_APP)).toBe(SLACK_APP);
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_app_token", SLACK_APP);
  });

  it("rejects one character short of the fixed 64-hex signature", () => {
    expect(
      matchOf("slack_app_token", `xapp-1-${"A".repeat(11)}-${"1".repeat(11)}-${"a".repeat(63)}`),
    ).toBeNull();
  });

  it("rejects a lowercase app-id segment", () => {
    expect(
      matchOf("slack_app_token", `xapp-1-${"a".repeat(11)}-${"1".repeat(11)}-${"a".repeat(64)}`),
    ).toBeNull();
  });

  it("rejects a longer hex run rather than truncating it", () => {
    expect(
      matchOf("slack_app_token", `xapp-1-${"A".repeat(11)}-${"1".repeat(11)}-${"a".repeat(65)}`),
    ).toBeNull();
  });
});

describe("slack_app_config_token (spec §4a)", () => {
  it("claims both the plain and refresh shapes in full", () => {
    expect(matchOf("slack_app_config_token", SLACK_APP_CONFIG)).toBe(SLACK_APP_CONFIG);
    expect(matchOf("slack_app_config_token", SLACK_APP_CONFIG_REFRESH)).toBe(
      SLACK_APP_CONFIG_REFRESH,
    );
  });

  it("redacts end to end without leaving the token", () => {
    expectRedacted("slack_app_config_token", SLACK_APP_CONFIG);
  });

  it("rejects one character short of the 140 minimum", () => {
    expect(matchOf("slack_app_config_token", `xoxe-1-${"a".repeat(139)}`)).toBeNull();
  });

  it("rejects a body outside the charset", () => {
    expect(
      matchOf("slack_app_config_token", `xoxe-1-${"a".repeat(100)}-${"a".repeat(49)}`),
    ).toBeNull();
  });

  it("rejects an over-cap body rather than truncating it", () => {
    expect(matchOf("slack_app_config_token", `xoxe-1-${"a".repeat(171)}`)).toBeNull();
  });
});

describe("slack_webhook_url (spec §4a)", () => {
  it("claims a real-shaped synthetic webhook in full", () => {
    expect(matchOf("slack_webhook_url", SLACK_WEBHOOK)).toBe(SLACK_WEBHOOK);
  });

  it("claims the workflows and triggers paths", () => {
    const workflows = `https://hooks.slack.com/workflows/${"a".repeat(45)}`;
    const triggers = `https://hooks.slack.com/triggers/${"a".repeat(45)}`;
    expect(matchOf("slack_webhook_url", workflows)).toBe(workflows);
    expect(matchOf("slack_webhook_url", triggers)).toBe(triggers);
  });

  it("redacts end to end without leaving the path secret", () => {
    expectRedacted("slack_webhook_url", SLACK_WEBHOOK);
  });

  it("rejects one character short of the 43 minimum", () => {
    expect(matchOf("slack_webhook_url", `https://hooks.slack.com/services/${"a".repeat(42)}`))
      .toBeNull();
  });

  it("rejects a path outside the charset", () => {
    expect(
      matchOf("slack_webhook_url", `https://hooks.slack.com/services/${"a".repeat(20)}-${"a".repeat(22)}`),
    ).toBeNull();
  });

  it("rejects an over-cap path rather than truncating it", () => {
    expect(matchOf("slack_webhook_url", `https://hooks.slack.com/services/${"a".repeat(57)}`))
      .toBeNull();
  });

  it("leaves the documentation host alone", () => {
    const doc = "https://api.slack.com/messaging/webhooks";
    expect(redact(doc)).toEqual({ redacted: doc, count: 0 });
  });
});
```

- [ ] **Step 10: Run and capture the RED failure** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 61 pass; the 17 new tests fail with
  `Error: no detector named slack_app_token` and the two sibling names
  (the `api.slack.com` case passes already — it asserts zero matches).

- [ ] **Step 11: Add the last three Slack detectors** —
  In `packages/policy/src/redaction-patterns.ts`, insert immediately after the
  `slack_legacy_token` entry:

```ts
  {
    name: "slack_app_token",
    pattern: /xapp-\d-[A-Z0-9]{9,13}-\d{10,13}-[a-f0-9]{64}(?![a-f0-9])/g,
    replacement: "xapp-[REDACTED]",
  },
  {
    name: "slack_app_config_token",
    pattern: /xoxe(?:\.xox[bp])?-\d-[A-Za-z0-9]{140,170}(?![A-Za-z0-9])/g,
    replacement: "xoxe-[REDACTED]",
  },
  {
    name: "slack_webhook_url",
    pattern:
      /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+\/]{43,56}(?![A-Za-z0-9+\/])/g,
    replacement: "https://hooks.slack.com/[REDACTED]",
  },
```

- [ ] **Step 12: Run and confirm GREEN** —
  `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: 78 passing, 0 failing.

- [ ] **Step 13: Prove the gates from T1/T2 are still green** —
  `pnpm --filter @megasaver/policy test`
  Expected: whole policy suite passes — `redaction-corpus.test.ts` (the nine new
  detectors fire zero times over the FP corpus), `redaction-locked.test.ts`,
  `redact.test.ts`, `redact-pii.test.ts`, `redact-unstructured.test.ts`,
  `redact.property.test.ts`.

- [ ] **Step 14: Type-check tests + lint** —
  `pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit`
  then `pnpm lint`.
  Expected: both exit 0.

- [ ] **Step 15: Commit** —
  `git add packages/policy/src/redaction-patterns.ts packages/policy/test/redaction-detectors.test.ts`
  then:

```
git commit -m "feat(policy): detect google and slack credentials" -m "Google API keys, Google OAuth client secrets, and all seven Slack credential
shapes (bot, user, legacy workspace, legacy, app-level, app-config, incoming
webhook URL) had no detector, so they reached every redaction sink in
cleartext.

Each bounded run carries a trailing negative lookahead over its own class: a
token longer than the cap would otherwise be truncated mid-secret, leaking the
tail. The guard converts that partial match into a total non-match, which is
the trade-off recorded in the spec's boundary-discipline note."
```
### Task 4c: GitHub (2) + npm + SendGrid + Datadog `ddapp_` — 5 detectors

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Test: `packages/policy/test/redaction-detectors.test.ts` (created in Task 4a — append)
- Test (must stay green): `packages/policy/test/redaction-corpus.test.ts`, `packages/policy/test/redaction-locked.test.ts`

Placement: the 5 entries go into `baseline` **immediately after the `slack_webhook_url` entry added by Task 4b and before the existing `github_token` entry**, in spec §4a order. `github_app_token` therefore precedes the existing `jwt` (spec §6 rule 2).

- [ ] **Step 1: Append the Task 4c test block (positives + near-misses + the two `ghs_` false-positive strings the security gate caught).**

First make sure the import line at the top of `packages/policy/test/redaction-detectors.test.ts` reads exactly:

```ts
import { redact, redactWithFindings } from "../src/redact.js";
```

(if Task 4a wrote only `redact`, add `redactWithFindings`). Then append to the end of the file:

```ts
const T4C_POSITIVES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "github_fine_grained_pat",
    `github_pat_${"A".repeat(22)}_${"b".repeat(59)}`,
    "github_pat_[REDACTED]",
  ],
  [
    "github_app_token",
    "ghs_123456_eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    "ghs_[REDACTED]",
  ],
  ["npm_token", `npm_${"a".repeat(36)}`, "npm_[REDACTED]"],
  ["sendgrid_api_key", `SG.${"a".repeat(22)}.${"b".repeat(43)}`, "SG.[REDACTED]"],
  ["datadog_app_key", `ddapp_${"c".repeat(34)}`, "ddapp_[REDACTED]"],
];

describe("redaction detectors §4a — GitHub, npm, SendGrid, Datadog app key", () => {
  for (const [name, sample, expected] of T4C_POSITIVES) {
    it(`redacts ${name} in full and labels the finding`, () => {
      const result = redactWithFindings(sample);
      expect(result.redacted).toBe(expected);
      expect(result.findings).toEqual([{ name, count: 1 }]);
    });
  }
});

const T4C_NEAR_MISSES: ReadonlyArray<readonly [string, string]> = [
  ["github_pat second run one short", `github_pat_${"A".repeat(22)}_${"b".repeat(58)}`],
  ["github_pat second run over cap", `github_pat_${"A".repeat(22)}_${"b".repeat(60)}`],
  ["ghs_ identifier (gate FP)", "ghs_handler_registry_for_the_whole_application_module"],
  ["ghs_ file path (gate FP)", "src/ghs_internal.helpers.for-tests-and-fixtures-only.ts"],
  ["ghs_ without numeric app id", "ghs_abcdef_notajwt"],
  ["npm_token one short", `npm_${"a".repeat(35)}`],
  ["npm_token one over", `npm_${"a".repeat(37)}`],
  ["sendgrid first run one short", `SG.${"a".repeat(19)}.${"b".repeat(43)}`],
  ["sendgrid second run over cap", `SG.${"a".repeat(22)}.${"b".repeat(51)}`],
  ["ddapp_ one short", `ddapp_${"c".repeat(33)}`],
  ["ddapp_ one over", `ddapp_${"c".repeat(35)}`],
];

describe("redaction detectors §4a — GitHub/npm/SendGrid/Datadog near-misses", () => {
  for (const [label, sample] of T4C_NEAR_MISSES) {
    it(`leaves ${label} untouched`, () => {
      expect(redact(sample)).toEqual({ redacted: sample, count: 0 });
    });
  }
});
```

- [ ] **Step 2: Run the test file — expect the 5 positives to FAIL.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: the 11 near-miss tests pass (no detector exists yet, so `count` is already 0); the 5 new positive tests fail with `expected [] to deeply equal [ { name: 'github_fine_grained_pat', count: 1 } ]` and `expected 'github_pat_AAAA…' to be 'github_pat_[REDACTED]'`. Task 4a/4b cases still pass.

- [ ] **Step 3: Add the 5 detectors to `packages/policy/src/redaction-patterns.ts`.**

Insert immediately after the `slack_webhook_url` entry, before the existing `github_token` entry:

```ts
  {
    name: "github_fine_grained_pat",
    pattern: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}(?![A-Za-z0-9])/g,
    replacement: "github_pat_[REDACTED]",
  },
  {
    // GitHub App installation token is `ghs_<numeric app id>_<JWT>`. GitHub's own
    // published regex (`ghs_[A-Za-z0-9.\-_]{36,}`) is unanchored and claims plain
    // identifiers and file paths, so the real shape is required here instead.
    name: "github_app_token",
    pattern: /\bghs_[0-9]{1,12}_eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "ghs_[REDACTED]",
  },
  {
    name: "npm_token",
    pattern: /npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g,
    replacement: "npm_[REDACTED]",
  },
  {
    name: "sendgrid_api_key",
    pattern: /\bSG\.[A-Za-z0-9_-]{20,24}\.[A-Za-z0-9_-]{39,50}(?![A-Za-z0-9_-])/g,
    replacement: "SG.[REDACTED]",
  },
  {
    name: "datadog_app_key",
    pattern: /ddapp_[A-Za-z0-9]{34}(?![A-Za-z0-9])/g,
    replacement: "ddapp_[REDACTED]",
  },
```

- [ ] **Step 4: Re-run the detector tests — expect PASS.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: all tests in the file pass, including the two `ghs_` gate false positives still reported as `{ redacted: <input>, count: 0 }`.

- [ ] **Step 5: Run the gates that these detectors could break — corpus, LOCKED snapshot, and the four untouched suites.**

```bash
pnpm --filter @megasaver/policy test
```

Expected: every suite passes — in particular `redaction-corpus.test.ts` (zero matches over the FP corpus, which contains the `ghs_` identifier and path strings), `redaction-locked.test.ts` (the original 19 unchanged), and `redact.test.ts`, `redact-pii.test.ts`, `redact-unstructured.test.ts`, `redact.property.test.ts` unmodified.

- [ ] **Step 6: Type-check source AND tests.**

```bash
pnpm --filter @megasaver/policy typecheck
pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit
pnpm lint
```

Expected: all three exit 0. The second command is separate on purpose — the package's `typecheck` script is `tsc -b --noEmit`, whose `tsconfig.json` excludes `test/`, so a type error in the new test file passes silently otherwise (see notes; `@megasaver/core` already runs both).

- [ ] **Step 7: Commit.**

```bash
git add packages/policy/src/redaction-patterns.ts packages/policy/test/redaction-detectors.test.ts
git commit -m "feat(policy): detect github, npm, sendgrid keys

Adds github_fine_grained_pat, github_app_token, npm_token,
sendgrid_api_key and datadog_app_key ahead of the existing tier.
github_app_token is anchored to ghs_<app id>_<JWT> rather than
GitHub's published unanchored form, which claims ordinary
identifiers and file paths; both caught strings are pinned as
negative assertions. It runs before the existing jwt detector so
the ghs_ prefix cannot survive in cleartext."
```

---

### Task 4d: GitLab (4) + HuggingFace (2) + DigitalOcean (3) + Azure (1) — 10 detectors

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Test: `packages/policy/test/redaction-detectors.test.ts` (append)
- Test (must stay green): `packages/policy/test/redaction-corpus.test.ts`, `packages/policy/test/redaction-locked.test.ts`

Placement: the 10 entries go into `baseline` **immediately after the `datadog_app_key` entry added by Task 4c and before the existing `github_token` entry**, in spec §4a order — `gitlab_routable_token` before `gitlab_pat` (spec §6 rule 1). This completes the §4a block; the §4b context-gated tier lands in Task 7.

- [ ] **Step 1: Append the GitLab + HuggingFace test block.**

Append to `packages/policy/test/redaction-detectors.test.ts`:

```ts
const T4D_GITLAB_HF_POSITIVES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "gitlab_routable_token",
    `glpat-${"a".repeat(27)}.${"b".repeat(9)}`,
    "glpat-[REDACTED]",
  ],
  ["gitlab_pat", `glpat-${"a".repeat(20)}`, "glpat-[REDACTED]"],
  ["gitlab_trigger_token", `glptt-${"a".repeat(40)}`, "glptt-[REDACTED]"],
  [
    "gitlab_runner_registration_token",
    `GR1348941${"a".repeat(24)}`,
    "GR1348941[REDACTED]",
  ],
  ["huggingface_token", `hf_${"a".repeat(37)}`, "hf_[REDACTED]"],
  ["huggingface_org_token", `api_org_${"a".repeat(34)}`, "api_org_[REDACTED]"],
];

describe("redaction detectors §4a — GitLab and HuggingFace", () => {
  for (const [name, sample, expected] of T4D_GITLAB_HF_POSITIVES) {
    it(`redacts ${name} in full and labels the finding`, () => {
      const result = redactWithFindings(sample);
      expect(result.redacted).toBe(expected);
      expect(result.findings).toEqual([{ name, count: 1 }]);
    });
  }
});

const T4D_GITLAB_HF_NEAR_MISSES: ReadonlyArray<readonly [string, string]> = [
  ["routable body one short", `glpat-${"a".repeat(26)}.${"b".repeat(9)}`],
  ["gitlab_pat one over", `glpat-${"a".repeat(21)}`],
  ["trigger token one over", `glptt-${"a".repeat(41)}`],
  ["runner token one short", `GR1348941${"a".repeat(19)}`],
  ["runner token over cap", `GR1348941${"a".repeat(51)}`],
  ["hf_ one short", `hf_${"a".repeat(33)}`],
  ["hf_ over cap", `hf_${"a".repeat(41)}`],
  ["hf_ as identifier suffix", `shf_${"a".repeat(37)}`],
  ["api_org_ one over", `api_org_${"a".repeat(35)}`],
];

describe("redaction detectors §4a — GitLab/HuggingFace near-misses", () => {
  for (const [label, sample] of T4D_GITLAB_HF_NEAR_MISSES) {
    it(`leaves ${label} untouched`, () => {
      expect(redact(sample)).toEqual({ redacted: sample, count: 0 });
    });
  }
});
```

- [ ] **Step 2: Append the DigitalOcean + Azure test block.**

Append to the same file:

```ts
const T4D_DO_AZURE_POSITIVES: ReadonlyArray<readonly [string, string, string]> = [
  ["digitalocean_pat", `dop_v1_${"a".repeat(64)}`, "dop_v1_[REDACTED]"],
  ["digitalocean_oauth_token", `doo_v1_${"a".repeat(64)}`, "doo_v1_[REDACTED]"],
  ["digitalocean_refresh_token", `dor_v1_${"a".repeat(64)}`, "dor_v1_[REDACTED]"],
  ["azure_client_secret", `abc8Q~${"a".repeat(33)}`, "[REDACTED]"],
];

describe("redaction detectors §4a — DigitalOcean and Azure", () => {
  for (const [name, sample, expected] of T4D_DO_AZURE_POSITIVES) {
    it(`redacts ${name} in full and labels the finding`, () => {
      const result = redactWithFindings(sample);
      expect(result.redacted).toBe(expected);
      expect(result.findings).toEqual([{ name, count: 1 }]);
    });
  }
});

const T4D_DO_AZURE_NEAR_MISSES: ReadonlyArray<readonly [string, string]> = [
  ["dop_v1_ with non-hex body", `dop_v1_${"A".repeat(64)}`],
  ["dop_v1_ one over", `dop_v1_${"a".repeat(65)}`],
  ["doo_v1_ one short", `doo_v1_${"a".repeat(63)}`],
  ["dor_v1_ one short", `dor_v1_${"a".repeat(63)}`],
  ["azure secret without left boundary", `zzabc8Q~${"a".repeat(33)}`],
  ["azure tail over cap", `abc8Q~${"a".repeat(35)}`],
  ["azure tail one short", `abc8Q~${"a".repeat(30)}`],
];

describe("redaction detectors §4a — DigitalOcean/Azure near-misses", () => {
  for (const [label, sample] of T4D_DO_AZURE_NEAR_MISSES) {
    it(`leaves ${label} untouched`, () => {
      expect(redact(sample)).toEqual({ redacted: sample, count: 0 });
    });
  }
});
```

- [ ] **Step 3: Run the test file — expect the 10 positives to FAIL.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: the 16 new near-miss tests pass; the 10 new positive tests fail with `expected [] to deeply equal [ { name: 'gitlab_routable_token', count: 1 } ]` (and the equivalent for the other nine). Task 4a–4c cases still pass.

- [ ] **Step 4: Add the GitLab and HuggingFace detectors.**

Insert into `packages/policy/src/redaction-patterns.ts` immediately after the `datadog_app_key` entry:

```ts
  // GitLab prefixes below are gitlab.com-specific: a self-managed instance may
  // reconfigure the `glpat-` prefix, and those deployments are out of coverage.
  {
    // Routable tokens carry a trailing CRC segment and MUST precede gitlab_pat,
    // which would otherwise bite off the first 20 characters and leave the rest.
    name: "gitlab_routable_token",
    pattern: /glpat-[0-9a-zA-Z_-]{27,300}\.[0-9a-z]{2}[0-9a-z]{7}(?![0-9a-zA-Z])/g,
    replacement: "glpat-[REDACTED]",
  },
  {
    name: "gitlab_pat",
    pattern: /glpat-[0-9a-zA-Z_-]{20}(?![0-9a-zA-Z_-])/g,
    replacement: "glpat-[REDACTED]",
  },
  {
    name: "gitlab_trigger_token",
    pattern: /glptt-[0-9a-zA-Z_-]{40}(?![0-9a-zA-Z_-])/g,
    replacement: "glptt-[REDACTED]",
  },
  {
    name: "gitlab_runner_registration_token",
    pattern: /GR1348941[0-9a-zA-Z_-]{20,50}(?![0-9a-zA-Z_-])/g,
    replacement: "GR1348941[REDACTED]",
  },
  {
    name: "huggingface_token",
    pattern: /\bhf_[a-zA-Z0-9]{34,40}(?![a-zA-Z0-9])/g,
    replacement: "hf_[REDACTED]",
  },
  {
    name: "huggingface_org_token",
    pattern: /\bapi_org_[a-zA-Z0-9]{34}(?![a-zA-Z0-9])/g,
    replacement: "api_org_[REDACTED]",
  },
```

- [ ] **Step 5: Add the DigitalOcean and Azure detectors.**

Insert immediately after `huggingface_org_token`, still before the existing `github_token` entry:

```ts
  {
    name: "digitalocean_pat",
    pattern: /dop_v1_[a-f0-9]{64}(?![a-f0-9])/g,
    replacement: "dop_v1_[REDACTED]",
  },
  {
    name: "digitalocean_oauth_token",
    pattern: /doo_v1_[a-f0-9]{64}(?![a-f0-9])/g,
    replacement: "doo_v1_[REDACTED]",
  },
  {
    name: "digitalocean_refresh_token",
    pattern: /dor_v1_[a-f0-9]{64}(?![a-f0-9])/g,
    replacement: "dor_v1_[REDACTED]",
  },
  {
    // Left guard is a LOOKBEHIND, not a consumed character: a consumed boundary
    // would be swallowed by the replacement along with the secret.
    name: "azure_client_secret",
    pattern: /(?<![a-zA-Z0-9_~.-])[a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{31,34}(?![a-zA-Z0-9_~.-])/g,
    replacement: "[REDACTED]",
  },
```

- [ ] **Step 6: Re-run the detector tests — expect PASS.**

```bash
pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts
```

Expected: every test in the file passes, including `glpat-<27>.<9>` labelled `gitlab_routable_token` (not `gitlab_pat`) and the azure sample redacted to exactly `[REDACTED]`.

- [ ] **Step 7: Run the full policy suite — corpus, LOCKED snapshot, and the four untouched suites.**

```bash
pnpm --filter @megasaver/policy test
```

Expected: all suites pass. `azure_client_secret` is the loosest pattern in the §4a block, so the corpus suite is the load-bearing check here — if it reports matches, stop and treat it as a detector defect per spec §11 step 1, not a corpus defect.

- [ ] **Step 8: Type-check source AND tests, then lint.**

```bash
pnpm --filter @megasaver/policy typecheck
pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit
pnpm lint
```

Expected: all three exit 0.

- [ ] **Step 9: Commit.**

```bash
git add packages/policy/src/redaction-patterns.ts packages/policy/test/redaction-detectors.test.ts
git commit -m "feat(policy): detect gitlab, hf, do, azure keys

Completes the §4a prefix-anchored tier: four GitLab formats, two
HuggingFace, three DigitalOcean and the Azure client secret.
gitlab_routable_token is ordered ahead of gitlab_pat because the
classic {20} rule would otherwise truncate a routable token and
leave its CRC tail in cleartext. Every GitLab prefix here is
gitlab.com-specific — self-managed instances can rename it."
```
### Task 5: Ordering tests — 6 behavioral rules (§6) + 1 structural whole-table test (§9.3)

**Files:**
- Create: `packages/policy/test/redaction-ordering.test.ts`
- Modify (temporarily, reverted inside each step): `packages/policy/src/redaction-patterns.ts`

Preconditions: T4d is committed, so the table holds 28 new prefix-anchored
detectors (spec §4a order) followed by the 19 existing ones — 47 entries.
Every mutation step below reverts with `git checkout --`, which is safe only
because T4d left `redaction-patterns.ts` clean.

Each behavioral step follows the same shape: add the test, run it green, then
**prove it can fail** by moving one object literal in the table, run it red,
revert, run it green again. That mutation check is what makes "written so it
FAILS if the order is wrong" evaluable rather than asserted.

---

- [ ] **Step 1: Create the file with the shared index helper and rule 1 — `gitlab_routable_token` BEFORE `gitlab_pat`** — write `packages/policy/test/redaction-ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactWithFindings } from "../src/redact.js";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

function indexOfDetector(name: string): number {
  const index = REDACTION_PATTERNS.findIndex((entry) => entry.name === name);
  if (index === -1) throw new Error(`detector not in table: ${name}`);
  return index;
}

function findingNames(text: string): string[] {
  return redactWithFindings(text).findings.map((finding) => finding.name);
}

// spec §4a shapes, built from repeated safe characters — never a real credential.
const ROUTABLE_TOKEN = `glpat-${"A".repeat(27)}.cr9tail99`;

describe("ordering rule 1 — gitlab_routable_token before gitlab_pat (§6.1)", () => {
  it("places the routable rule ahead of the classic 20-char rule", () => {
    expect(indexOfDetector("gitlab_routable_token")).toBeLessThan(
      indexOfDetector("gitlab_pat"),
    );
  });

  it("claims the whole routable token under its own finding name", () => {
    expect(findingNames(ROUTABLE_TOKEN)).toContain("gitlab_routable_token");
  });

  it("leaves no cleartext remainder — payload and CRC tail are both gone", () => {
    const { redacted } = redactWithFindings(ROUTABLE_TOKEN);
    expect(redacted).not.toContain("A".repeat(27));
    expect(redacted).not.toContain("cr9tail99");
    expect(redacted).not.toContain(".cr9");
  });
});
```

- [ ] **Step 2: Run rule 1 green, then mutate to prove it fails** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 3 tests pass.

Now open `packages/policy/src/redaction-patterns.ts`, cut the whole
`{ name: "gitlab_routable_token", … }` object literal and paste it immediately
**after** the `{ name: "gitlab_pat", … }` literal. Re-run the same command.

Expected: FAIL — `places the routable rule ahead of the classic 20-char rule`
reports `expected <index of routable> to be less than <index of gitlab_pat>`.
The two payload tests still pass: `gitlab_pat`'s `(?![0-9a-zA-Z_-])` trailing
lookahead cannot bite a `{27,300}` first segment, so the §6.1 leak is no longer
reachable behaviorally (recorded in this plan's notes). The index assertion is
the live guard; the remainder assertions guard a future relaxation of that
lookahead.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3: Rule 2 — `github_app_token` BEFORE the existing `jwt`** — append to `redaction-ordering.test.ts`:

```ts
const APP_TOKEN =
  "ghs_1234567890_eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhcHAifQ.c2lnbmF0dXJlLXZhbHVl";

describe("ordering rule 2 — github_app_token before jwt (§6.2)", () => {
  it("places the app-token rule ahead of the generic jwt rule", () => {
    expect(indexOfDetector("github_app_token")).toBeLessThan(indexOfDetector("jwt"));
  });

  it("labels the finding by provider, not by embedded jwt", () => {
    const names = findingNames(APP_TOKEN);
    expect(names).toContain("github_app_token");
    expect(names).not.toContain("jwt");
  });

  it("does not leave the ghs_ app-id prefix in cleartext", () => {
    const { redacted } = redactWithFindings(APP_TOKEN);
    expect(redacted).not.toContain("ghs_1234567890");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });
});
```

- [ ] **Step 4: Run rule 2 green, then mutate to prove it fails** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 6 tests pass.

Mutate: in `redaction-patterns.ts`, cut the `{ name: "github_app_token", … }`
literal and paste it immediately **after** the `{ name: "jwt", … }` literal.
Re-run.

Expected: FAIL on all three rule-2 tests — the index assertion fails, the
finding is labelled `jwt`, and `redacted` is
`ghs_1234567890_eyJ[REDACTED]` (verified: the app id survives in cleartext).

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Rule 3 — `slack_webhook_url` BEFORE `db_url` and `url_query_secret`** — append:

```ts
const WEBHOOK_URL = `https://hooks.slack.com/services/T00000000/B00000000/${"x".repeat(24)}`;

describe("ordering rule 3 — slack_webhook_url before the generic URL rules (§6.3)", () => {
  it("places the webhook rule ahead of db_url and url_query_secret", () => {
    const webhook = indexOfDetector("slack_webhook_url");
    expect(webhook).toBeLessThan(indexOfDetector("db_url"));
    expect(webhook).toBeLessThan(indexOfDetector("url_query_secret"));
  });

  it("labels a bare webhook as a Slack webhook", () => {
    const names = findingNames(WEBHOOK_URL);
    expect(names).toContain("slack_webhook_url");
    expect(names).not.toContain("db_url");
  });

  it("claims the webhook before the query-secret rule when both fire", () => {
    const names = findingNames(`${WEBHOOK_URL}?token=SUPERSECRETVALUE`);
    expect(names.indexOf("slack_webhook_url")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("slack_webhook_url")).toBeLessThan(
      names.indexOf("url_query_secret"),
    );
  });
});
```

`findings` is pushed in table order by `redactWithFindings`, so the third test
is a behavioral read of the order, not a restatement of the index assertion.

- [ ] **Step 6: Run rule 3 green, then mutate to prove it fails** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 9 tests pass.

Mutate: cut the `{ name: "slack_webhook_url", … }` literal and paste it
immediately **after** the `{ name: "url_query_secret", … }` literal. Re-run.

Expected: FAIL — the index assertion fails, and
`claims the webhook before the query-secret rule` fails because `findings` now
reads `["url_query_secret", "slack_webhook_url"]`.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 7: Rule 4 — new detectors BEFORE the generic contextual rules** — append:

```ts
const NPM_ENV_LINE = `NPM_TOKEN="npm_${"a".repeat(36)}"`;
const GOOGLE_HEADER_LINE = `x-api-key: AIza${"B".repeat(35)}`;
const SLACK_CLI_LINE = `mega run --token=xoxb-1234567890-1234567890-${"c".repeat(28)}`;

describe("ordering rule 4 — provider rules before the container rules (§6.4)", () => {
  const CONTAINERS = ["env_value", "api_key_header", "cli_secret_flag_eq"];

  it("places every new detector ahead of every container rule", () => {
    const firstContainer = Math.min(...CONTAINERS.map(indexOfDetector));
    const newTierEnd = indexOfDetector("github_token");
    expect(newTierEnd).toBeLessThan(firstContainer);
  });

  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ["npm_token", "env_value", NPM_ENV_LINE],
    ["google_api_key", "api_key_header", GOOGLE_HEADER_LINE],
    ["slack_bot_token", "cli_secret_flag_eq", SLACK_CLI_LINE],
  ];

  for (const [provider, container, line] of CASES) {
    it(`labels ${provider} before the ${container} container`, () => {
      const names = findingNames(line);
      expect(names).toContain(provider);
      expect(names.indexOf(provider)).toBeLessThan(names.indexOf(container));
    });

    it(`leaves no cleartext tail for ${provider}`, () => {
      const { redacted } = redactWithFindings(line);
      expect(redacted).not.toContain("a".repeat(36));
      expect(redacted).not.toContain("B".repeat(35));
      expect(redacted).not.toContain("c".repeat(28));
    });
  }
});
```

Note for the reviewer: both the provider rule **and** the container rule fire
here — the container matches the provider's own replacement text. Spec §2's
illustrative `findings=[{name:"npm_token"}]` is inaccurate against the real
`redactWithFindings` loop (verified: output is `NPM_TOKEN="[REDACTED]"`,
findings `["npm_token", "env_value"]`). Ordering, not exclusivity, is what §6.4
binds; T8 covers the reassignment surface in full.

- [ ] **Step 8: Run rule 4 green, then mutate to prove it fails** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 16 tests pass.

Mutate: cut the `{ name: "npm_token", … }` literal and paste it immediately
**after** the `{ name: "env_value", … }` literal. Re-run.

Expected: FAIL — `labels npm_token before the env_value container` fails with
`findings` = `["env_value"]`; `npm_token` never fires because `env_value`
already replaced the quoted value.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 16 tests pass.

- [ ] **Step 9: Rules 5 and 6 — `openai_project_key` before `openai_key`, and the existing block's relative order** — append:

```ts
const PROJECT_KEY = `sk-proj-${"a".repeat(24)}T3BlbkFJ${"b".repeat(24)}`;

describe("ordering rule 5 — openai_project_key before openai_key (§6.5)", () => {
  it("places the project rule ahead of the legacy sk- rule", () => {
    expect(indexOfDetector("openai_project_key")).toBeLessThan(
      indexOfDetector("openai_key"),
    );
  });

  it("labels a project key by provider and redacts it whole", () => {
    const { redacted, findings } = redactWithFindings(PROJECT_KEY);
    expect(findings.map((finding) => finding.name)).toContain("openai_project_key");
    expect(redacted).not.toContain("a".repeat(24));
    expect(redacted).not.toContain("b".repeat(24));
    expect(redacted).not.toContain("T3BlbkFJ");
  });
});

const LOCKED_ORDER = [
  "github_token",
  "anthropic_key",
  "openai_key",
  "aws_access_key",
  "aws_secret_key",
  "bearer_token",
  "jwt",
  "private_key_block",
  "env_value",
  "db_url",
  "url_basic_auth",
  "url_query_secret",
  "cli_secret_flag_eq",
  "cli_secret_flag_spaced",
  "api_key_header",
  "basic_auth_header",
  "credit_card",
  "iban",
  "tr_national_id",
];

describe("ordering rule 6 — the existing 19 keep their relative order (§6.6)", () => {
  it("keeps the locked block contiguous at the tail, in its original order", () => {
    expect(REDACTION_PATTERNS.slice(-LOCKED_ORDER.length).map((entry) => entry.name)).toEqual(
      LOCKED_ORDER,
    );
  });

  it("keeps anthropic_key ahead of openai_key", () => {
    expect(indexOfDetector("anthropic_key")).toBeLessThan(indexOfDetector("openai_key"));
  });

  it("keeps db_url ahead of the generic URL rules", () => {
    const dbUrl = indexOfDetector("db_url");
    expect(dbUrl).toBeLessThan(indexOfDetector("url_basic_auth"));
    expect(dbUrl).toBeLessThan(indexOfDetector("url_query_secret"));
  });
});
```

- [ ] **Step 10: Run rules 5 and 6 green, then mutate to prove they fail** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 21 tests pass.

Mutate: cut the `{ name: "anthropic_key", … }` literal and paste it immediately
**after** the `{ name: "openai_key", … }` literal. Re-run.

Expected: FAIL on `keeps the locked block contiguous at the tail, in its
original order` and on `keeps anthropic_key ahead of openai_key`.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 21 tests pass.

Rule 5 has no behavioral mutation: `sk-[A-Za-z0-9]{20,}` provably cannot match
`sk-proj-…` (the class breaks on the hyphen after `proj`), which is the §1 gap
itself, so reversal changes nothing observable. Spec §6.5 states the rule is
defensive; the index assertion is the whole guard.

- [ ] **Step 11: Structural whole-table test — literal derivation that reads through `(?:…|…)` and single-char classes (§9.3)** — append:

```ts
// §9.3: the derivation must read THROUGH non-capturing alternations and
// single-character classes. Stopping at the first metacharacter derives `sk-`
// from openai_project_key and `xox` from the Slack rules, which reports four
// false failures against this table.
const QUANTIFIER = /[*+?{]/;

function matchingParen(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function leadingLiterals(source: string): string[] {
  let branches = [""];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === undefined) break;
    if (char === "\\") {
      const next = source[i + 1];
      if (next === undefined) break;
      if (next === "b" || next === "B") {
        i += 2;
        continue;
      }
      if (/[A-Za-z0-9]/.test(next)) break;
      if (QUANTIFIER.test(source[i + 2] ?? "")) break;
      branches = branches.map((branch) => branch + next);
      i += 2;
      continue;
    }
    if (char === "(") {
      if (!source.startsWith("(?:", i)) break;
      const end = matchingParen(source, i);
      if (end === -1) break;
      if (QUANTIFIER.test(source[end + 1] ?? "")) break;
      const inner = source.slice(i + 3, end);
      if (/[()[\]*+?{}\\.^$]/.test(inner)) break;
      const alternatives = inner.split("|");
      branches = branches.flatMap((branch) => alternatives.map((alt) => branch + alt));
      i = end + 1;
      continue;
    }
    if (char === "[") {
      const end = source.indexOf("]", i + 1);
      if (end === -1) break;
      if (QUANTIFIER.test(source[end + 1] ?? "")) break;
      const inner = source.slice(i + 1, end);
      if (inner.length === 0 || /[-^\\]/.test(inner)) break;
      branches = branches.flatMap((branch) => [...inner].map((member) => branch + member));
      i = end + 1;
      continue;
    }
    if (/[*+?{}|)$^.]/.test(char)) break;
    if (QUANTIFIER.test(source[i + 1] ?? "")) break;
    branches = branches.map((branch) => branch + char);
    i += 1;
  }
  return branches.filter((branch) => branch.length > 0);
}

describe("ordering — structural, whole table (§9.3)", () => {
  const derived = REDACTION_PATTERNS.map((entry) => ({
    name: entry.name,
    literals: leadingLiterals(entry.pattern.source),
  }));

  it("reads through alternations and single-char classes", () => {
    const literalsFor = (name: string): string[] =>
      derived.find((entry) => entry.name === name)?.literals ?? [];
    expect(literalsFor("openai_project_key")).toEqual([
      "sk-proj-",
      "sk-svcacct-",
      "sk-admin-",
    ]);
    expect(literalsFor("slack_legacy_workspace_token")).toEqual(["xoxa-", "xoxr-"]);
    expect(literalsFor("slack_legacy_token")).toEqual(["xoxo-", "xoxs-"]);
    expect(literalsFor("anthropic_key")).toEqual(["sk-ant-"]);
    expect(literalsFor("openai_key")).toEqual(["sk-"]);
  });

  it("never places a broader literal ahead of a more specific one", () => {
    const violations: string[] = [];
    for (const [index, earlier] of derived.entries()) {
      for (const later of derived.slice(index + 1)) {
        for (const broad of earlier.literals) {
          for (const specific of later.literals) {
            if (specific.length > broad.length && specific.startsWith(broad)) {
              violations.push(`${earlier.name} (${broad}) before ${later.name} (${specific})`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Entries whose derived set is empty — every lookbehind-gated rule, plus
`credit_card`/`iban`/`tr_national_id` — carry no literal and are skipped by
construction (`filter((branch) => branch.length > 0)`). Comparing an empty
literal as a prefix of everything would report every contextual rule as a
violation.

- [ ] **Step 12: Run the structural test green, then mutate to prove it fails** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 23 tests pass, `violations` empty (measured against the real 47-entry
table: zero violations).

Mutate: cut the `{ name: "anthropic_key", … }` literal and paste it immediately
**after** the `{ name: "openai_key", … }` literal. Re-run.

Expected: FAIL — `never places a broader literal ahead of a more specific one`
reports `["openai_key (sk-) before anthropic_key (sk-ant-)"]`.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-ordering.test.ts
```

Expected: 23 tests pass.

- [ ] **Step 13: Type-check the new test file explicitly** — `@megasaver/policy`'s `typecheck` script is `tsc -b --noEmit`, whose `tsconfig.json` **excludes `test/`**, so a type error in this file passes silently (the same gap the entitlement package had). Until T10 wires the package script, run the test project directly:

```
pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit
pnpm lint
```

Expected: both exit 0, no output. If `tsc` reports `TS2532`/`TS18048` on
`source[i]`, the `char === undefined` guard was dropped —
`noUncheckedIndexedAccess` is on for this package.

- [ ] **Step 14: Commit** — run:

```
git add packages/policy/test/redaction-ordering.test.ts
git status --short
git commit -m "test(policy): pin redaction detector ordering" -m "Application order is load-bearing: a broader detector running first steals the match from a narrower one and can leave a partial secret in cleartext. Six behavioral tests cover the binding pairs in the design's ordering section; one structural test covers the whole table by deriving each entry's leading literal run through non-capturing alternations and single-character classes, which six hand-picked pairs cannot."
```

Expected: `git status --short` shows only the one new file staged (the
mutation reverts left `redaction-patterns.ts` clean); commit succeeds with
1 file changed.

---

### Task 6: ReDoS timing regression — new detector tier only (§9.5)

**Files:**
- Create: `packages/policy/test/redaction-redos.test.ts`

The new tier is derived from the table, not hard-coded: every entry before
`github_token` is new (spec §6 places the whole new block ahead of the existing
19). At T6 that is the 28 prefix-anchored detectors; T7 adds 3 context-gated
ones and must add their seeds, or Step 3's coverage test fails — which is the
intended gate.

- [ ] **Step 1: Create the file with the padding builder and the seed table** — write `packages/policy/test/redaction-redos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

// §9.5 — timed against the new detector tier AND the locked `jwt` detector. The
// jwt exclusion this gate originally carved out is gone: the quadratic it named
// was fixed on 2026-07-20 by a leading (?<![A-Za-z0-9_-]) lookbehind, taking
// 313 KiB of 'eyJaA0'.repeat(n) from 8,374 ms to 0.45 ms. jwt now clears this
// ceiling by three orders of magnitude, so there is no reason to exempt it.
const CEILING_MS = 750;
const SCALES_KIB = [20, 39, 78, 156] as const;
const OPENAI_SCALE_KIB = 313;

// Adversarial input is the detector's own literal prefix, repeated: every
// position is a candidate start that must fail, which is the shape that makes a
// backtracking detector blow up.
const ADVERSARIAL_SEEDS: Record<string, string> = {
  stripe_live_secret_key: "sk_live_",
  stripe_test_secret_key: "sk_test_",
  stripe_restricted_key: "rk_live_",
  openai_project_key: "sk-proj-",
  google_api_key: "AIza",
  google_oauth_client_secret: "GOCSPX-",
  slack_bot_token: "xoxb-1234567890-",
  slack_user_token: "xoxp-1234567890-",
  slack_legacy_workspace_token: "xoxa-",
  slack_legacy_token: "xoxo-1-2-3-",
  slack_app_token: "xapp-1-A",
  slack_app_config_token: "xoxe-1-",
  slack_webhook_url: "https://hooks.slack.com/services/",
  github_fine_grained_pat: "github_pat_",
  github_app_token: "ghs_1_eyJ",
  npm_token: "npm_",
  sendgrid_api_key: "SG.",
  datadog_app_key: "ddapp_",
  gitlab_routable_token: "glpat-",
  gitlab_pat: "glpat-",
  gitlab_trigger_token: "glptt-",
  gitlab_runner_registration_token: "GR1348941",
  huggingface_token: "hf_",
  huggingface_org_token: "api_org_",
  digitalocean_pat: "dop_v1_",
  digitalocean_oauth_token: "doo_v1_",
  digitalocean_refresh_token: "dor_v1_",
  azure_client_secret: "abc0Q~",
};

const NEW_TIER = REDACTION_PATTERNS.slice(
  0,
  REDACTION_PATTERNS.findIndex((entry) => entry.name === "github_token"),
);

function padding(seed: string, kib: number): string {
  const bytes = kib * 1024;
  return seed.repeat(Math.ceil(bytes / seed.length)).slice(0, bytes);
}

function elapsedMs(source: string, flags: string, input: string): number {
  // Fresh RegExp per run: the table's patterns are global and shared, so
  // reusing them would carry lastIndex across tests.
  const pattern = new RegExp(source, flags);
  const started = performance.now();
  input.replace(pattern, "[REDACTED]");
  return performance.now() - started;
}
```

- [ ] **Step 2: Add the per-detector timing test across the four scales** — append:

```ts
describe("redos — new detector tier stays linear (§9.5)", () => {
  for (const detector of NEW_TIER) {
    it(`${detector.name} stays under ${CEILING_MS}ms up to 156 KiB`, () => {
      const seed = ADVERSARIAL_SEEDS[detector.name];
      if (seed === undefined) throw new Error(`no adversarial seed: ${detector.name}`);
      for (const kib of SCALES_KIB) {
        const ms = elapsedMs(
          detector.pattern.source,
          detector.pattern.flags,
          padding(seed, kib),
        );
        expect.soft(ms, `${detector.name} @ ${kib} KiB`).toBeLessThan(CEILING_MS);
      }
    });
  }
});
```

`expect.soft` reports every scale that breached instead of stopping at the
first, so a failure shows the growth curve — a 4×-per-doubling detector is
diagnosable from one run.

- [ ] **Step 3: Add the 313 KiB `openai_project_key` case and the seed-coverage gate** — append:

```ts
describe("redos — openai_project_key at the measured blow-up scale (§9.5)", () => {
  it(`stays under ${CEILING_MS}ms at ${OPENAI_SCALE_KIB} KiB`, () => {
    const detector = NEW_TIER.find((entry) => entry.name === "openai_project_key");
    if (detector === undefined) throw new Error("openai_project_key not in the new tier");
    const seed = ADVERSARIAL_SEEDS.openai_project_key ?? "";
    const ms = elapsedMs(
      detector.pattern.source,
      detector.pattern.flags,
      padding(seed, OPENAI_SCALE_KIB),
    );
    expect(ms).toBeLessThan(CEILING_MS);
  });
});

// The locked jwt detector, timed here since 2026-07-20 removed its quadratic.
// Three seeds: narrowing the lookbehind to (?<![A-Za-z0-9]) leaves 'eyJaA0' at
// 0.46 ms while '-eyJaA' costs 7,494 ms and '_eyJaA' costs 7,561 ms.
describe("redos — locked jwt detector at the measured blow-up scale (§9.5)", () => {
  const detector = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
  if (detector === undefined) throw new Error("jwt not in REDACTION_PATTERNS");

  for (const seed of ["eyJaA0", "-eyJaA", "_eyJaA"]) {
    it(`stays under ${CEILING_MS}ms at ${OPENAI_SCALE_KIB} KiB of ${seed}`, () => {
      const ms = elapsedMs(
        detector.pattern.source,
        detector.pattern.flags,
        padding(seed, OPENAI_SCALE_KIB),
      );
      expect(ms).toBeLessThan(CEILING_MS);
    });
  }
});

describe("redos — coverage (§9.5)", () => {
  it("times every detector in the new tier", () => {
    const unseeded = NEW_TIER.map((entry) => entry.name).filter(
      (name) => ADVERSARIAL_SEEDS[name] === undefined,
    );
    expect(unseeded).toEqual([]);
  });

  it("carries no seed for a detector that left the table", () => {
    const tierNames = new Set(NEW_TIER.map((entry) => entry.name));
    const orphans = Object.keys(ADVERSARIAL_SEEDS).filter((name) => !tierNames.has(name));
    expect(orphans).toEqual([]);
  });
});
```

The unbounded `{20,}` form of `openai_project_key` measures 48.6 ms at 20 KiB
rising to 12,319 ms at 313 KiB. The bounded `{20,150}` form in the table
measures 12.4 ms at 313 KiB on this machine, so the 750 ms ceiling is ~60×
headroom for a slow CI runner while still catching the unbounded regression by
more than an order of magnitude.

- [ ] **Step 4: Run the suite and confirm the timings** — run:

```
pnpm --filter @megasaver/policy test -- test/redaction-redos.test.ts
```

Expected: 34 tests pass (28 per-detector + 313 KiB + 3 jwt seeds + 2 coverage), under ~2 s
total. Measured worst case on the dev machine is `gitlab_routable_token` at
17.8 ms / 156 KiB (linear: 2.46 / 4.49 / 8.98 / 17.83 across the four scales) —
the `{27,300}` first segment is the widest bounded run in the tier.

- [ ] **Step 5: Prove the ceiling can fail** — in `packages/policy/src/redaction-patterns.ts`, change `openai_project_key`'s two bounded runs from `{20,150}` to `{20,}` (two edits in one regex literal) and re-run:

```
pnpm --filter @megasaver/policy test -- test/redaction-redos.test.ts
```

Expected: FAIL — `openai_project_key stays under 750ms at 313 KiB` reports
multiple seconds, and the soft assertions at 78/156 KiB report the 4×-per-
doubling growth. This is the exact defect §4a's bounded runs exist to prevent.

Revert and confirm green:

```
git checkout -- packages/policy/src/redaction-patterns.ts
pnpm --filter @megasaver/policy test -- test/redaction-redos.test.ts
```

Expected: 34 tests pass.

- [ ] **Step 6: Type-check and lint the new file** — run:

```
pnpm --filter @megasaver/policy exec tsc -p tsconfig.test.json --noEmit
pnpm lint
```

Expected: both exit 0. `ADVERSARIAL_SEEDS` is a `Record<string, string>`, so
`noUncheckedIndexedAccess` types every lookup as `string | undefined`; the
explicit `undefined` guards are what keep this clean.

- [ ] **Step 7: Run the whole policy suite to confirm no interference** — run:

```
pnpm --filter @megasaver/policy test
```

Expected: every existing suite still passes unmodified — `redact.test.ts`,
`redact-pii.test.ts`, `redact-unstructured.test.ts`, `redact.property.test.ts`,
plus T1's locked snapshot, T2's corpus, T4's detector tests, and T5's ordering
tests. The timing file adds ~2 s; the package's `testTimeout` is 30 s, so no
per-test timeout tuning is needed.

- [ ] **Step 8: Commit** — run:

```
git add packages/policy/test/redaction-redos.test.ts
git status --short
git commit -m "test(policy): time new redaction tier for redos" -m "Every detector in the new tier is timed against its own repeated literal prefix at 20/39/78/156 KiB, with openai_project_key additionally at 313 KiB — the scale where the unbounded form of its runs measures 12.3 s against 12.4 ms bounded. The locked jwt detector is inside the ceiling too: its quadratic was fixed on 2026-07-20 and it now clears the gate by three orders of magnitude, so the exemption this test originally carried has been removed."
```

Expected: `git status --short` shows only the one new file staged; commit
succeeds with 1 file changed.
### Task 7: Context-gated detectors (§4b) — twilio + datadog

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Test: `packages/policy/test/redaction-detectors.test.ts` (created in Task 4a; this task appends one `describe` block)

Preconditions: Tasks 4a–4d landed, so the §4a block (28 entries, ending with
`azure_client_secret`) sits above the original 19. The three entries below go
**immediately after `azure_client_secret` and immediately before the existing
`github_token` entry** (spec §6: §4b runs after §4a, still ahead of all
existing detectors).

- [ ] **Step 1: Append the failing positive-case block to `packages/policy/test/redaction-detectors.test.ts`** — append verbatim at end of file:

```ts
// §4b context-gated. The canonical real-world shape is an UNQUOTED uppercase
// env var, which env_value (quoted-only) never covered — that is the leak
// these three close.
const HEX32 = "a".repeat(32);
const HEX32_UPPER = "A".repeat(32);
const HEX40 = "b".repeat(40);

const CONTEXT_GATED: ReadonlyArray<readonly [string, string, string]> = [
  ["twilio_auth_token", "bare uppercase env", `TWILIO_AUTH_TOKEN=${HEX32}`],
  ["twilio_auth_token", "docker-compose indented", `services:\n  api:\n    environment:\n      TWILIO_AUTH_TOKEN: ${HEX32}`],
  ["twilio_auth_token", "uppercase hex value", `TWILIO_AUTH_TOKEN=${HEX32_UPPER}`],
  ["datadog_api_key", "dd short form", `DD_API_KEY=${HEX32}`],
  ["datadog_api_key", "datadog long form", `DATADOG_API_KEY=${HEX32}`],
  ["datadog_api_key", "shell export", `export DD_API_KEY=${HEX32}`],
  ["datadog_api_key", "env prefix invocation", `env DATADOG_API_KEY=${HEX32} node app.js`],
  ["datadog_app_key_legacy", "dd app key", `DD_APP_KEY=${HEX40}`],
  ["datadog_app_key_legacy", "application spelling", `DATADOG_APPLICATION_KEY=${HEX40}`],
];

describe("redaction — §4b context-gated detectors", () => {
  for (const [name, shape, sample] of CONTEXT_GATED) {
    it(`${name} fires on the ${shape} form`, () => {
      const result = redactWithFindings(sample);
      expect(result.findings.map((f) => f.name)).toContain(name);
      expect(result.redacted).not.toContain(HEX32);
      expect(result.redacted).not.toContain(HEX32_UPPER);
      expect(result.redacted).not.toContain(HEX40);
    });
  }

  it("keeps the surrounding line readable", () => {
    const result = redactWithFindings(`env DATADOG_API_KEY=${HEX32} node app.js`);
    expect(result.redacted).toBe("env DATADOG_API_KEY=[REDACTED] node app.js");
  });
});
```

If `redactWithFindings` is not already imported at the top of the file, add it
to the existing `import { redact } from "../src/redact.js";` line so it reads
`import { redact, redactWithFindings } from "../src/redact.js";`.

- [ ] **Step 2: Run the positives — expect FAIL** — `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: the 9 new `it` cases fail. The docker-compose / `export` / `env` /
  bare cases fail on `expect(...).toContain("twilio_auth_token")` with
  `findings` empty (**no detector fires at all** — that is the §4b leak), and
  the readability case fails with received
  `env DATADOG_API_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa node app.js`. Every
  pre-existing test in the file still passes. Capture the real output.

- [ ] **Step 3: Append the negative / near-miss block to the same test file**:

```ts
const CONTEXT_GATED_NEGATIVES: ReadonlyArray<readonly [string, string]> = [
  // Left boundary: the indicator is a SUBSTRING of an unrelated identifier.
  // Without the left bound these redact benign digests (measured by the gate).
  ["add_app_key is not dd_app_key", `add_app_key: ${HEX40}`],
  ["odd-api-key is not dd-api-key", `odd-api-key = ${"c".repeat(32)}`],
  // Trailing lookahead: a longer hex run must not be truncated into a match.
  ["33 hex is not a twilio token", `TWILIO_AUTH_TOKEN=${"a".repeat(33)}`],
  ["41 hex is not a datadog app key", `DD_APP_KEY=${"b".repeat(41)}`],
  // One character short.
  ["31 hex is not a datadog api key", `DD_API_KEY=${"a".repeat(31)}`],
  ["39 hex is not a datadog app key", `DD_APP_KEY=${"b".repeat(39)}`],
  // Wrong charset.
  ["non-hex value is not a token", `TWILIO_AUTH_TOKEN=${"g".repeat(32)}`],
  // Indicator without an adjoining value.
  ["prose mentioning the variable", "Set TWILIO_AUTH_TOKEN in the deploy env."],
];

describe("redaction — §4b context-gated near-misses", () => {
  for (const [label, sample] of CONTEXT_GATED_NEGATIVES) {
    it(`leaves ${label} untouched`, () => {
      const result = redact(sample);
      expect(result.redacted).toBe(sample);
      expect(result.count).toBe(0);
    });
  }
});
```

- [ ] **Step 4: Run the negatives — expect PASS (they are green pre-change)** — `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: the 8 near-miss cases pass immediately (no detector exists yet, so
  nothing can over-redact); the 9 positives from Step 2 still fail. This
  ordering is deliberate — the near-misses are the regression guard, so they
  must be recorded green *before* the detectors land, and must stay green
  after.

- [ ] **Step 5: Add the three detectors to `packages/policy/src/redaction-patterns.ts`** — insert this block between the `azure_client_secret` entry (last of §4a) and the `{ name: "github_token", ... }` entry:

```ts
  // --- §4b context-gated. No distinctive prefix; the indicator lookbehind is
  // the only thing making these safe. Three properties are load-bearing and
  // each was proven so by the security gate: (1) the `i` flag — the canonical
  // shape is an UPPERCASE env var and case-sensitive lookbehinds leaked 7 of
  // 8 canonical shapes with no detector firing at all, because env_value
  // requires a quoted value and these shapes are conventionally unquoted;
  // (2) the left bound `(?:^|[^A-Za-z0-9])` — without it the indicator matches
  // as a substring of an unrelated token and a benign digest is redacted
  // (`add_app_key: <sha1>` via `dd_app_key:`, `odd-api-key = <md5>` via
  // `dd-api-key`); (3) the trailing lookahead — stops a longer hex run being
  // truncated into a false match.
  {
    name: "twilio_auth_token",
    pattern:
      /(?<=(?:^|[^A-Za-z0-9])(?:twilio[_-]?)?auth[_-]?token["'\s:=]{1,10})[0-9a-fA-F]{32}(?![0-9a-fA-F])/gi,
    replacement: "[REDACTED]",
  },
  {
    name: "datadog_api_key",
    pattern:
      /(?<=(?:^|[^A-Za-z0-9])(?:dd|datadog)[_-]?api[_-]?key["'\s:=]{1,10})[a-f0-9]{32}(?![a-f0-9])/gi,
    replacement: "[REDACTED]",
  },
  {
    // Matches exactly the shape of a git SHA-1. Entirely dependent on its
    // context gate — must never be relaxed to run unanchored.
    name: "datadog_app_key_legacy",
    pattern:
      /(?<=(?:^|[^A-Za-z0-9])(?:dd|datadog)[_-]?app(?:lication)?[_-]?key["'\s:=]{1,10})[a-f0-9]{40}(?![a-f0-9])/gi,
    replacement: "[REDACTED]",
  },
```

- [ ] **Step 6: Register the three detectors in the ReDoS seed table**

  Task 6's `packages/policy/test/redaction-redos.test.ts` derives the new tier dynamically and
  fails if any detector in it has no adversarial seed. These three land inside that tier, so add
  their seeds to `ADVERSARIAL_SEEDS` (keep the existing entries; insert alphabetically):

```ts
  datadog_api_key: "dd_api_key=",
  datadog_app_key_legacy: "dd_app_key=",
  twilio_auth_token: "auth_token=",
```

  Without this step the coverage assertion in `redaction-redos.test.ts` fails with the three
  names listed as `unseeded`.

- [ ] **Step 7: Run the detector suite — expect PASS** — `pnpm --filter @megasaver/policy test -- test/redaction-detectors.test.ts`
  Expected: all cases green, including the 9 positives from Step 2 and the 8
  near-misses from Step 3. `Test Files 1 passed`.

- [ ] **Step 8: Run the gate suites — expect PASS** — `pnpm --filter @megasaver/policy test`
  Expected: every suite green. Specifically `redaction-corpus.test.ts` (Task 2)
  must stay at zero matches — it already carries `add_app_key: <sha1>` and
  `odd-api-key = <md5>`, which are the exact strings the left bound protects —
  and `redaction-locked.test.ts` (Task 1), `redact.test.ts`,
  `redact-pii.test.ts`, `redact-unstructured.test.ts`,
  `redact.property.test.ts` pass unmodified.

- [ ] **Step 9: Type-check and lint** — `pnpm --filter @megasaver/policy typecheck && pnpm lint`
  Expected: both exit 0. NOTE: `@megasaver/policy`'s `typecheck` script is
  `tsc -b --noEmit` and its `tsconfig.json` sets `"exclude": ["test", ...]`, so
  it does **not** cover `test/`. If Task 1 has not yet added the
  `tsconfig.test.json` wiring that `packages/core` and `apps/cli` both use
  (`"typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit"`),
  additionally run `npx tsc -p packages/policy/tsconfig.test.json --noEmit`
  from the repo root and expect exit 0.

- [ ] **Step 10: Commit** — `git add packages/policy/src/redaction-patterns.ts packages/policy/test/redaction-detectors.test.ts packages/policy/test/redaction-redos.test.ts && git commit -m "$(cat <<'EOF'
feat(policy): add context-gated secret detectors

Adds twilio_auth_token, datadog_api_key, and datadog_app_key_legacy
(spec §4b). These have no distinctive prefix, so each depends on three
properties the security gate proved load-bearing: the `i` flag, because
the canonical shape is an uppercase env var and case-sensitive
lookbehinds leaked 7 of 8 canonical shapes with no detector firing at
all; a left-bounded indicator, without which `add_app_key: <sha1>` and
`odd-api-key = <md5>` redact benign digests; and a trailing lookahead so
a longer hex run is not truncated into a match. Placed after the §4a
block and ahead of every existing detector per §6.
EOF
)"`

---

### Task 8: Reassignment tests — container rule to provider label (§9.7)

**Files:**
- Test: `packages/policy/test/redaction-reassignment.test.ts` (create)

This task adds no production code. It pins the §6.4 reassignment: a value that
used to be labelled by its *container* (`env_value`, `api_key_header`,
`cli_secret_flag_eq`) is now labelled by its *provider*. The failure mode it
exists to catch is the dangerous one — a new detector that matches only part of
the value inside a container and leaves a cleartext tail where the container
rule previously redacted everything.

- [ ] **Step 1: Create `packages/policy/test/redaction-reassignment.test.ts`**:

```ts
import { describe, expect, it } from "vitest";
import { redactWithFindings } from "../src/redact.js";

const NPM_SECRET = `npm_${"a".repeat(36)}`;
const GOOGLE_SECRET = `AIza${"A".repeat(35)}`;
const SLACK_SECRET = `xoxb-${"1".repeat(11)}-${"2".repeat(11)}-${"a".repeat(24)}`;

// Each case: a value that a container rule (env_value / api_key_header /
// cli_secret_flag_eq) used to claim, now claimed first by a §4a provider
// detector. `expected` is the FULL redacted line — the container rule still
// runs afterwards over the marker, so the assertion pins the end-to-end
// output, not just the first replacement.
const REASSIGNED: ReadonlyArray<
  readonly [string, string, string, string, string]
> = [
  [
    "npm_token",
    "env_value",
    `NPM_TOKEN="${NPM_SECRET}"`,
    NPM_SECRET,
    'NPM_TOKEN="[REDACTED]"',
  ],
  [
    "google_api_key",
    "api_key_header",
    `x-api-key: ${GOOGLE_SECRET}`,
    GOOGLE_SECRET,
    "x-api-key: [REDACTED]",
  ],
  [
    "slack_bot_token",
    "cli_secret_flag_eq",
    `--token=${SLACK_SECRET}`,
    SLACK_SECRET,
    "--token=[REDACTED]",
  ],
];

describe("redaction — container-to-provider reassignment (spec §9.7)", () => {
  for (const [provider, container, sample, secret, expected] of REASSIGNED) {
    it(`labels the ${container} value as ${provider}`, () => {
      const result = redactWithFindings(sample);
      expect(result.findings[0]?.name).toBe(provider);
    });

    it(`fully redacts the ${provider} value inside ${container}`, () => {
      const result = redactWithFindings(sample);
      expect(result.redacted).toBe(expected);
      expect(result.redacted).not.toContain(secret);
    });
  }

  it("leaves no cleartext tail when the provider match is shorter than the container match", () => {
    const result = redactWithFindings(`--token=${SLACK_SECRET}`);
    expect(result.redacted).not.toContain("1".repeat(11));
    expect(result.redacted).not.toContain("2".repeat(11));
    expect(result.redacted).not.toContain("a".repeat(24));
  });
});
```

- [ ] **Step 2: Run the new suite — expect PASS** — `pnpm --filter @megasaver/policy test -- test/redaction-reassignment.test.ts`
  Expected: 7 cases green. `findings[0]` is the provider because the §4a block
  is ordered ahead of every container rule. This suite is a regression pin over
  behavior Task 4 already implemented, so green here is the correct first
  result — Step 3 is what proves it is load-bearing.

- [ ] **Step 3: Prove the suite is load-bearing by mutation** — temporarily delete the four lines of the `npm_token` entry from `packages/policy/src/redaction-patterns.ts` (the `{ name: "npm_token", ... },` object), then run `pnpm --filter @megasaver/policy test -- test/redaction-reassignment.test.ts`
  Expected: `labels the env_value value as npm_token` FAILS with
  `expected 'env_value' to be 'npm_token'`. Capture the output. Then restore
  with `git checkout -- packages/policy/src/redaction-patterns.ts` and re-run
  the same command, expecting all 7 green again.

- [ ] **Step 4: Run the full package suite — expect PASS** — `pnpm --filter @megasaver/policy test`
  Expected: every suite green, confirming the restore in Step 3 was clean and
  that `redaction-locked.test.ts` still matches the frozen table.

- [ ] **Step 5: Type-check and lint** — `pnpm --filter @megasaver/policy typecheck && pnpm lint`
  Expected: both exit 0. Same caveat as Task 7 Step 8 — if the
  `tsconfig.test.json` wiring is not yet in place, also run
  `npx tsc -p packages/policy/tsconfig.test.json --noEmit` from the repo root
  and expect exit 0. This matters here: the file is test-only, so without that
  wiring nothing type-checks it at all.

- [ ] **Step 6: Commit** — `git add packages/policy/test/redaction-reassignment.test.ts && git commit -m "$(cat <<'EOF'
test(policy): pin container-to-provider handoffs

Covers the three §6.4 reassignments — NPM_TOKEN= (env_value),
x-api-key: (api_key_header), and --token= (cli_secret_flag_eq) — each
asserting the provider finding name and the full redacted line. The
dangerous version of the reassignment is a provider detector that
matches only part of the value inside a container and leaves a
cleartext tail where the container rule used to redact everything;
these assertions are what catch it.
EOF
)"`
### Task 9: CLI disclosure constant + three call sites

**Prerequisite:** `mega handoff pack` / `mega handoff open` do NOT exist on `main`.
They live only in the `feat-hot-handoff` worktree
(`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/feat-hot-handoff`,
branch `worktree-feat-hot-handoff`). Task 9 cannot start until that branch is
merged into the base of the redaction worktree. Verify before Step 1:

```bash
test -f apps/cli/src/commands/handoff/pack.ts && test -f apps/cli/src/commands/handoff/open.ts && echo READY
```

If this prints nothing, stop and rebase on the merged hot-handoff branch.

**Files:**
- Create: `apps/cli/src/commands/shared/redaction-note.ts`
- Modify: `apps/cli/src/commands/handoff/pack.ts`
- Modify: `apps/cli/src/commands/handoff/open.ts`
- Modify: `apps/cli/src/commands/brain/export.ts`
- Test: `apps/cli/test/handoff-integration.test.ts` (modify)
- Test: `apps/cli/test/commands/brain-export.test.ts` (modify)

**Placement decision (contract §File-structure said `handoff/shared.ts` — source
disagrees).** `apps/cli/src/commands/handoff/shared.ts` statically imports
`agentSlugSchema` from `@megasaver/core`. `apps/cli/src/commands/brain/export.ts`
line 46 carries an explicit comment — *"Lazy import after the gate: never load
core's brain bundler on the free path"* — and lazy-imports `@megasaver/core`
only after the entitlement check. Importing `handoff/shared.js` from
`brain/export.ts` would eagerly load core on the free path and undo that.
`apps/cli/src/commands/shared/` is the existing cross-command shared module
directory (`schemas.ts`, imported by 10+ command groups), so the constant goes
there in a zero-dependency file. Spec §8's requirement — one exported constant
in `apps/cli`, referenced from all three sites — is met exactly.

- [ ] **Step 1: Add the failing handoff assertion.** Append this `describe` block to the end of `apps/cli/test/handoff-integration.test.ts`, and add the import line `import { REDACTION_BASELINE_NOTE } from "../src/commands/shared/redaction-note.js";` immediately after the existing `import { runHandoffPack } from "../src/commands/handoff/pack.js";` line (line 8).

```ts
describe("redaction baseline disclosure (spec §8)", () => {
  it("mega handoff pack prints the disclosure once", async () => {
    await seed();
    expect(await pack("codex", join(files, "disclose.megahandoff"))).toBe(0);
    expect(out.filter((l) => l === REDACTION_BASELINE_NOTE)).toHaveLength(1);
  });

  it("mega handoff open prints the disclosure once", async () => {
    await seed();
    const packetPath = join(files, "disclose-open.megahandoff");
    expect(await pack("codex", packetPath)).toBe(0);
    out = [];
    let n = 0;
    const openCode = await runHandoffOpen({
      storeRoot: root,
      cwd: dirB,
      now,
      publicKey: keys.publicKey,
      filePath: packetPath,
      merge: false,
      json: false,
      newId: () => `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(10 + n++)}`,
      ensureStore: () => ensureStoreReady(root),
      stdout,
      stderr,
    });
    expect(openCode).toBe(0);
    expect(out.filter((l) => l === REDACTION_BASELINE_NOTE)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, expect a red import failure.**

```bash
pnpm --filter @megasaver/cli test -- test/handoff-integration.test.ts
```

Expected: Vitest fails to collect the file with
`Failed to load url ../src/commands/shared/redaction-note.js` (or
`Cannot find module`). This is the correct red — the module does not exist yet.

- [ ] **Step 3: Create the constant module.** Write `apps/cli/src/commands/shared/redaction-note.ts` with exactly this content:

```ts
// Three commands emit this; three hand-copied sentences drift (spec §8).
export const REDACTION_BASELINE_NOTE =
  "note: redaction is a regex baseline — it does not catch every provider's credential format; review the output before sharing it.";
```

- [ ] **Step 4: Reference it from `mega handoff pack`.** In `apps/cli/src/commands/handoff/pack.ts`, add the import between the `known-targets.js` import and the `store.js` import block (Biome sorts `../shared/…` before `../warmup.js`):

```ts
import { REDACTION_BASELINE_NOTE } from "../shared/redaction-note.js";
```

placed on the line immediately before `import { findProjectByCwd } from "../warmup.js";`.

Then extend the shared `notes` helper so both the dry-run and the real path emit it. Replace:

```ts
  const notes = (emit: (line: string) => void): void => {
    if (report.noOpenSession) emit("note: no open session — project-scoped content only");
    if (report.degradedGit) emit("note: git unavailable — packet carries no git state");
    if (report.gitDiffUnavailable)
      emit("note: git diff unavailable — working-tree changes present but diff not captured");
  };
```

with:

```ts
  const notes = (emit: (line: string) => void): void => {
    if (report.noOpenSession) emit("note: no open session — project-scoped content only");
    if (report.degradedGit) emit("note: git unavailable — packet carries no git state");
    if (report.gitDiffUnavailable)
      emit("note: git diff unavailable — working-tree changes present but diff not captured");
    emit(REDACTION_BASELINE_NOTE);
  };
```

`notes(input.stdout)` is already called on the dry-run path and on the real
pack path, and neither JSON branch calls it, so the JSON contract is untouched.

- [ ] **Step 5: Reference it from `mega handoff open`.** In `apps/cli/src/commands/handoff/open.ts`, add on the line immediately before `import { findProjectByCwd } from "../warmup.js";`:

```ts
import { REDACTION_BASELINE_NOTE } from "../shared/redaction-note.js";
```

Then replace the human-readable tail:

```ts
  input.stdout(
    `applied handoff from ${packet.manifest.sourceAgent} to ${target.relativePath} (expires ${packet.manifest.expiresAt})`,
  );
  if (mergeReport !== null) {
    input.stdout(
      `merged ${mergeReport.imported} memories (suggested, skipped ${mergeReport.skipped}) — run: mega memory approve`,
    );
  }
  return 0;
```

with:

```ts
  input.stdout(
    `applied handoff from ${packet.manifest.sourceAgent} to ${target.relativePath} (expires ${packet.manifest.expiresAt})`,
  );
  if (mergeReport !== null) {
    input.stdout(
      `merged ${mergeReport.imported} memories (suggested, skipped ${mergeReport.skipped}) — run: mega memory approve`,
    );
  }
  input.stdout(REDACTION_BASELINE_NOTE);
  return 0;
```

- [ ] **Step 6: Run the handoff test green.**

```bash
pnpm --filter @megasaver/cli test -- test/handoff-integration.test.ts
```

Expected: all tests in the file pass, including the two new
`redaction baseline disclosure (spec §8)` cases.

- [ ] **Step 7: Add the failing brain-export assertion.** In `apps/cli/test/commands/brain-export.test.ts`, add after the existing import of `runBrainExport` (line 7):

```ts
import { REDACTION_BASELINE_NOTE } from "../../src/commands/shared/redaction-note.js";
```

and append this `it` inside the existing top-level `describe` (immediately after the `"default filename is <project>-<YYYYMMDD>.megabrain under cwd"` case):

```ts
  it("prints the redaction baseline disclosure on the human path", async () => {
    activatePro();
    await seedProject("alpha");
    expect(await run({ project: "alpha", outPath: join(outDir, "a.megabrain") })).toBe(0);
    expect(out.filter((l) => l === REDACTION_BASELINE_NOTE)).toHaveLength(1);
  });
```

Then run:

```bash
pnpm --filter @megasaver/cli test -- test/commands/brain-export.test.ts
```

Expected: the new case fails with `expected [] to have a length of 1 but got +0`
(the constant now exists, so collection succeeds; only the assertion is red).

- [ ] **Step 8: Reference it from `mega brain export`.** In `apps/cli/src/commands/brain/export.ts`, add on the line immediately after `import { PRO_ANALYTICS_URL } from "../savings/index.js";`:

```ts
import { REDACTION_BASELINE_NOTE } from "../shared/redaction-note.js";
```

Then replace:

```ts
  input.stdout(`exported ${path}`);
  input.stdout(
    `memories ${manifest.counts.memories} | rules ${manifest.counts.rules} | failures ${manifest.counts.failures} | redactions ${manifest.redactionFindings}`,
  );
  return 0;
```

with:

```ts
  input.stdout(`exported ${path}`);
  input.stdout(
    `memories ${manifest.counts.memories} | rules ${manifest.counts.rules} | failures ${manifest.counts.failures} | redactions ${manifest.redactionFindings}`,
  );
  input.stdout(REDACTION_BASELINE_NOTE);
  return 0;
```

The `--json` branch returns above this point and is untouched — the existing
`"--json emits a stable object"` case must stay green unmodified.

- [ ] **Step 9: Run both CLI suites green.**

```bash
pnpm --filter @megasaver/cli test -- test/commands/brain-export.test.ts test/handoff-integration.test.ts
```

Expected: 2 files, all cases pass, 0 failed.

- [ ] **Step 10: Lint and typecheck the CLI package.**

```bash
pnpm lint && pnpm --filter @megasaver/cli typecheck
```

Expected: `biome check .` reports no diagnostics (if it reports import-order
fixes, run `pnpm lint:fix` and re-run), and `tsc -b --noEmit && tsc -p
tsconfig.test.json --noEmit` exits 0 with no output. Note the CLI package's
`typecheck` script already covers `test/`, so a type error in the new test
cases cannot pass silently.

- [ ] **Step 11: Commit.**

```bash
git add apps/cli/src/commands/shared/redaction-note.ts \
        apps/cli/src/commands/handoff/pack.ts \
        apps/cli/src/commands/handoff/open.ts \
        apps/cli/src/commands/brain/export.ts \
        apps/cli/test/handoff-integration.test.ts \
        apps/cli/test/commands/brain-export.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): disclose redaction baseline limits

Redaction is a regex baseline, not exhaustive coverage of every provider's
credential format. handoff pack, handoff open, and brain export each write a
bundle a user is likely to hand to another agent, so each states the limit on
the human-readable path. One exported constant in commands/shared, because
three hand-copied sentences drift. JSON output is unchanged: the disclosure is
for a human reader, and the --json objects are asserted as stable contracts.
EOF
)"
```

---

### Task 10: Changeset, wiki, and full verification

**Files:**
- Create: `.changeset/redaction-baseline-extension.md`
- Modify: `wiki/entities/policy.md`
- Modify: `wiki/log.md`
- No production code in this task.

- [ ] **Step 1: Confirm the test-typecheck gap from the contract's "known trap" was closed by an earlier task.**

```bash
grep -n '"typecheck"' packages/policy/package.json
```

Expected: `"typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit"`.

If it still reads `"typecheck": "tsc -b --noEmit"`, the gap is open — every new
test file in `packages/policy/test/` is unchecked. Fix it here before going
further by editing `packages/policy/package.json` to:

```json
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
```

matching the `@megasaver/cli` precedent, then run
`pnpm --filter @megasaver/policy typecheck` and fix any errors it surfaces
before continuing.

- [ ] **Step 2: Write the changeset.** Create `.changeset/redaction-baseline-extension.md`:

```markdown
---
"@megasaver/policy": minor
"@megasaver/cli": minor
---

Extend the secret-redaction baseline from 19 detectors to 50. Adds 28
prefix-anchored provider detectors (Stripe, OpenAI project, Google, Slack,
GitHub, npm, SendGrid, Datadog, GitLab, HuggingFace, DigitalOcean, Azure) and 3
context-gated detectors, and fixes `private_key_block` to match bare PKCS#8
`-----BEGIN PRIVATE KEY-----` blocks including the escaped-newline form found
in GCP service-account JSON.

The original 19 detectors are frozen by a snapshot test, and the whole pattern
set is asserted to produce zero matches over a persisted non-secret corpus, so
the added coverage cannot silently regress the existing behaviour or start
over-redacting ordinary source and log output. `redact`, `redactWithFindings`,
and `redactForLedger` keep their exact signatures; some inputs are now labelled
by a provider rule instead of a generic container rule, so `findings[].name`
values recorded before and after this change may differ for the same input.

`mega handoff pack`, `mega handoff open`, and `mega brain export` now state on
their human-readable output that redaction is a regex baseline and does not
cover every provider's credential format.
```

- [ ] **Step 3: Verify changesets picks up both packages.**

```bash
pnpm changeset status --since=main
```

Expected: the report lists `@megasaver/policy` and `@megasaver/cli` under
minor bumps. `@megasaver/policy` is `"private": true`; changesets still versions
private packages by default (`privatePackages.version` defaults to true, and
`.changeset/config.json` sets no override), so it must appear. If it does not,
stop — the changeset is inert and the version bump will be lost.

- [ ] **Step 4: Update `wiki/entities/policy.md` — frontmatter.** Replace:

```yaml
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-05-11
```

with:

```yaml
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design.md
status: active
created: 2026-05-11
updated: 2026-07-20
```

- [ ] **Step 5: Update `wiki/entities/policy.md` — append the change section.** Append to the end of the file (after the `policy@1.1.0.` line):

```markdown

## Redaction baseline extension (2026-07-20)

`REDACTION_PATTERNS` grows from 19 to 50 detectors. Source:
[[docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design]].
Risk CRITICAL — the pattern table IS the contract; a bad regex either leaks a
credential or destroys legitimate output.

**What landed:**

- 28 prefix-anchored provider detectors (§4a): Stripe (3), OpenAI project (1),
  Google (2), Slack (7), GitHub (2), npm (1), SendGrid (1), Datadog `ddapp_`
  (1), GitLab (4), HuggingFace (2), DigitalOcean (3), Azure (1).
- 3 context-gated detectors (§4b), asserted against the uppercase env-var form
  (`DD_API_KEY=…`, `export TWILIO_AUTH_TOKEN=…`, the docker-compose indented
  form) as well as the lowercase shape. These carry essentially all the
  remaining over-redaction risk and are the intended revert unit.
- `private_key_block` fixed to match bare PKCS#8 `-----BEGIN PRIVATE KEY-----`,
  including the escaped-newline form in GCP service-account JSON.

**Why it is safe to change a CRITICAL table:**

- **LOCKED snapshot** (`test/redaction-locked.test.ts`) — a frozen inline table
  of `{name, pattern.source, pattern.flags, replacement, hasValidate}` for the
  original 19, with the one intended `private_key_block` change pinned in its
  fixed form. §2's safety invariant is now a CI gate, not a promise.
- **False-positive corpus** (`test/redaction-corpus.ts` + `.test.ts`) — landed
  and asserted green against the pre-change 19 *before* any detector was added,
  so a corpus failure is unambiguously caused by a new detector. Asserted via
  `redact()` rather than raw `pattern.test`, so `iban` / `credit_card` /
  `tr_national_id` exercise their `validate` gates.
- **Ordering** (`test/redaction-ordering.test.ts`) — 6 behavioural rules plus
  one structural test over every ordered pair, deriving the leading literal run
  through non-capturing alternations and single-character classes. The naive
  derivation (stop at the first metacharacter) produced four measured false
  failures on this exact table.
- **ReDoS timing** (`test/redaction-redos.test.ts`) — new tier only, four
  padding scales, with the 313 KiB `openai_project_key` case explicit. The
  original 19 are deliberately out of scope; see the known exposure below.
- **Reassignment** (`test/redaction-reassignment.test.ts`) — one case per
  container→provider handoff (§9.7), asserting both the new finding name and
  that the value is still redacted end to end. This is what catches a new
  detector partially matching inside a container rule and leaving a cleartext
  tail.

**Known exposure, not introduced here:** the locked `jwt` detector is strongly
super-linear (≈31 / 114 / 437 / 1850 ms at the four scales) and is reachable
from realistic base64-JSON log output. §13 locks the detector, so the timing
gate deliberately excludes it; applying the gate would fail CI on day one for a
pre-existing defect out of this change's scope. Filed as a follow-up in spec
§14.

**Consumers:** `redact`, `redactWithFindings`, and `redactForLedger` keep their
exact signatures and `RedactResult` is unchanged. `findings[]` gains new `name`
values, and some inputs are relabelled from a container rule to a provider
rule. The firewall ledger and brain export persist `findings[].name`, so
records written either side of this change may label the same input
differently — descriptive names, not a stable API. Not data corruption.

**UX disclosure (§8):** `REDACTION_BASELINE_NOTE` in
`apps/cli/src/commands/shared/redaction-note.ts` — one exported constant,
referenced from `mega handoff pack`, `mega handoff open`, and
`mega brain export`. It lives in `commands/shared/` rather than
`commands/handoff/shared.ts` because the latter statically imports
`@megasaver/core`, and `brain/export.ts` deliberately lazy-imports core after
its entitlement gate. Human-readable output only; the `--json` objects are
asserted as stable contracts. Nothing user-facing was added to
`@megasaver/policy`.
```

- [ ] **Step 6: Append the `wiki/log.md` entry.** Append to the end of `wiki/log.md`:

```markdown

## [2026-07-20] feature | Redaction baseline extended 19 → 50 detectors

`@megasaver/policy`'s `REDACTION_PATTERNS` grew from 19 to 50: 28
prefix-anchored provider detectors, 3 context-gated detectors, and a
`private_key_block` fix for bare PKCS#8 blocks including the escaped-newline
GCP service-account form. Risk CRITICAL. Landed in risk order — LOCKED
snapshot of the original 19 first, then the false-positive corpus asserted
green against the pre-change table, then the prefix-anchored tier, then the
context-gated tier as an independently revertible unit. Gated by ordering
tests (6 behavioural + 1 structural over every pair), a ReDoS timing
regression scoped to the new tier, and reassignment tests proving
container→provider handoffs still redact the full value. Four detector
families were audited and found already covered; four more (Google's legacy
unprefixed OAuth secret, Mailgun's key and webhook signing key, bare-base64
Azure keys) have no stable prefix and are honestly out of reach. Known
pre-existing exposure carried forward, not introduced: the locked `jwt`
detector is strongly super-linear and reachable from base64-JSON log output —
the timing gate excludes it and spec §14 files the follow-up. `mega handoff
pack`, `mega handoff open`, and `mega brain export` now disclose that
redaction is a regex baseline. Sources:
[[docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design]],
[[entities/policy]].
```

- [ ] **Step 7: Run full verification and capture the evidence.**

```bash
pnpm verify 2>&1 | tail -60
```

Expected: `biome check .` clean, `turbo typecheck` all packages passing,
`turbo test` all packages passing, `conventions:check` reporting no drift, exit
code 0. Record the final package/test counts — they are the DoD item-4
evidence and go into the PR body verbatim. If any step fails, stop and fix;
do not proceed to Step 8 on a red verify.

- [ ] **Step 8: Capture the policy-suite evidence explicitly.**

```bash
pnpm --filter @megasaver/policy test 2>&1 | tail -25
```

Expected: every file in `packages/policy/test/` passes, including the four
suites this change must not modify — `redact.test.ts`, `redact-pii.test.ts`,
`redact-unstructured.test.ts`, `redact.property.test.ts` — plus the seven new
ones. Confirm the four are untouched:

```bash
git diff --stat main -- packages/policy/test/redact.test.ts \
  packages/policy/test/redact-pii.test.ts \
  packages/policy/test/redact-unstructured.test.ts \
  packages/policy/test/redact.property.test.ts
```

Expected: no output. Any diff here violates spec §9.8 and must be reverted.

- [ ] **Step 9: Walk the Definition of Done (§9) and record the result.** Check each item; every one must be true before any "done" claim:

  1. Spec exists — `docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design.md`.
  2. Plan exists — `docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md`.
  3. Tests written first — every task in this plan is red-then-green; the LOCKED snapshot and the FP corpus both landed before the change they gate.
  4. `pnpm verify` green — Step 7 output.
  5. Feature smoke evidence — Step 8 policy suite output, plus the Task 9 CLI cases proving all three commands print the disclosure.
  6. External reviewer pass — CRITICAL risk requires BOTH `code-reviewer` AND `critic`, in separate passes, in a fresh context that did not author this branch.
  7. Verifier pass — `omc:verify`, evidence-based.
  8. Zero pending TodoWrite items.
  9. Changeset added — Step 2.
  10. Conventions unchanged, so no `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` edit is due; `conventions:check` inside Step 7 confirms no drift.

  CRITICAL risk (§12) additionally requires `omc:tracer` evidence loop,
  `omc:security-reviewer`, and manual user confirmation recorded in the spec.
  Confirm all three before requesting merge.

- [ ] **Step 10: Commit.**

```bash
git add .changeset/redaction-baseline-extension.md wiki/entities/policy.md wiki/log.md
git commit -m "$(cat <<'EOF'
docs(policy): changeset and wiki for redaction baseline

Minor for policy (19 -> 50 detectors) and cli (the §8 disclosure line). The
wiki entity page records why a CRITICAL pattern table could be changed at all:
the LOCKED snapshot and the false-positive corpus both landed before the
detectors they gate, so a regression names its own cause. It also carries
forward the pre-existing super-linear jwt detector as a known exposure that
this change deliberately does not fix, so nobody reads the green timing gate
as covering the whole table.
EOF
)"
```
