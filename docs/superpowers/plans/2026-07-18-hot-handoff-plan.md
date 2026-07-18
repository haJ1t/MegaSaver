# Hot Handoff (i10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega handoff --to codex` packs a redacted, bounded, expiring `.megahandoff` task packet; `mega handoff open` applies it on the receiving side as an AGENTS.md/CLAUDE.md sentinel block (+ opt-in suggested-gate memory merge).

**Architecture:** Brain-bundle sibling format over a new shared two-line bundle frame in core; pure `buildHandoffPacket` builder (redaction-first, permissions-threaded secret-path exclusion, explicit standard+timeless warm-start brief); context-less `upsertHandoffBlockText` + render-time sentinel guard + open-side re-redaction on the consume path; Pro-gated pack/open (`"hot-handoff"` key), free dry-run/inspect/clear. Spec: `docs/superpowers/specs/2026-07-18-hot-handoff-design.md` (risk HIGH — worktree `feat/hot-handoff`, code-reviewer AND critic before merge).

**Tech Stack:** TypeScript strict ESM, Zod, vitest, citty, pnpm workspaces (`@megasaver/core`, `@megasaver/connectors-shared`, `@megasaver/entitlement`, `@megasaver/stats`, `@megasaver/cli`).

**Execution context:** create worktree `feat/hot-handoff` off `main` first (`superpowers:using-git-worktrees`). All commands run from the worktree root. Task order is dependency order: 1→2→(3,4)→5→(6,7)→8→9→10→(11,12)→13→14.

**Recorded deviations from spec (plan-time decisions, all flagged by section authors):**
- `compressByCategory("diff", text)` used instead of `compressDiff` — same function via output-filter's already-public dispatcher; avoids widening that package's surface.
- `HANDOFF_DIFF_TOKEN_CAP = 2000` (spec gave no number; parity with `DEFAULT_WARM_START_BUDGET`).
- Diff truncation unit = whole trailing per-FILE chunks (the splitter's natural unit).
- `gatherGitDelta` called with `lastSeenAt = null` (14-day fallback window).
- `HandoffDiagnostics` carries `parsedManifest`/`parsedPayload` (contract had a field-name collision with the status fields).
- `HandoffDirtyState` lives in `packages/core/src/handoff-export.ts` (GitDelta precedent), created by Task 4, extended by Task 5.
- `parseExpires` returns `number | null` (no CliError class exists; CLI convention is inline stderr + exit 1).
- Pre-existing gap flagged, NOT fixed here: `projectionPreflight` never validated the WARM_START pair; this plan adds only the HANDOFF check.
- excludedPaths/secretPathsExcluded = union of exclusions across diff hunks + changedFiles + statusPaths.

---

# Section: Core packet foundation (Tasks 1–2)

All commands run from the `feat/hot-handoff` worktree root. Paths are repo-relative.

### Task 1: Extract bundle-frame from brain-bundle

**Files:**
- Create: `packages/core/src/bundle-frame.ts`
- Create: `packages/core/test/bundle-frame.test.ts`
- Modify: `packages/core/src/brain-bundle.ts`
- Regression (MUST pass unmodified): `packages/core/test/brain-bundle.test.ts`

- [ ] **Step 1: Baseline — confirm brain-bundle tests are green before touching anything**

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/brain-bundle.test.ts
  ```
  Expected: all 12 tests pass (1 serialize + 11 parse). This is the regression net for the extraction.

- [ ] **Step 2: Write the failing frame test**

  Write `packages/core/test/bundle-frame.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { z } from "zod";
  import {
    type BundleFrameConfig,
    parseBundle,
    serializeBundle,
    sha256Hex,
  } from "../src/bundle-frame.js";

  type ToyCode = "malformed" | "hash_mismatch" | "unsupported_version";

  class ToyError extends Error {
    readonly code: ToyCode;

    constructor(code: ToyCode, message: string) {
      super(message);
      this.name = "ToyError";
      this.code = code;
    }
  }

  const toyManifestSchema = z
    .object({
      schemaVersion: z.literal("7"),
      note: z.string().min(1),
      payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict();
  type ToyManifest = z.infer<typeof toyManifestSchema>;

  const toyPayloadSchema = z.object({ items: z.array(z.string()) }).strict();
  type ToyPayload = z.infer<typeof toyPayloadSchema>;

  const frame: BundleFrameConfig<ToyManifest, ToyPayload> = {
    schemaVersion: "7",
    manifestSchema: toyManifestSchema,
    payloadSchema: toyPayloadSchema,
    payloadShaOf: (manifest) => manifest.payloadSha256,
    makeError: (code, message) => new ToyError(code, message),
  };

  const payload: ToyPayload = { items: ["alpha", "beta"] };
  const payloadRaw = JSON.stringify(payload);
  const manifest: ToyManifest = {
    schemaVersion: "7",
    note: "toy",
    payloadSha256: sha256Hex(payloadRaw),
  };
  const text = serializeBundle(frame, { manifest, payload });

  function codeOf(fn: () => unknown): ToyCode {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ToyError);
      return (error as ToyError).code;
    }
    return expect.unreachable() as never;
  }

  describe("sha256Hex", () => {
    it("hashes utf8 text to lowercase hex", () => {
      expect(sha256Hex("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  describe("serializeBundle", () => {
    it("writes manifest line + payload line with no trailing newline", () => {
      const idx = text.indexOf("\n");
      expect(idx).toBeGreaterThan(0);
      expect(text.endsWith("\n")).toBe(false);
      expect(JSON.parse(text.slice(0, idx))).toEqual(manifest);
      expect(text.slice(idx + 1)).toBe(payloadRaw);
    });

    it("rejects a manifest failing its schema", () => {
      expect(() =>
        serializeBundle(frame, { manifest: { ...manifest, note: "" }, payload }),
      ).toThrow();
    });
  });

  describe("parseBundle", () => {
    it("roundtrips", () => {
      expect(parseBundle(frame, text)).toEqual({ manifest, payload });
    });

    it("tolerates one trailing newline", () => {
      expect(parseBundle(frame, `${text}\n`).payload.items).toEqual(["alpha", "beta"]);
      expect(parseBundle(frame, `${text}\r\n`).payload.items).toEqual(["alpha", "beta"]);
    });

    it("rejects missing newline via the frame error factory", () => {
      expect(codeOf(() => parseBundle(frame, "{}"))).toBe("malformed");
    });

    it("rejects non-JSON manifest", () => {
      expect(codeOf(() => parseBundle(frame, `not-json\n${payloadRaw}`))).toBe("malformed");
    });

    it("rejects null manifest", () => {
      expect(codeOf(() => parseBundle(frame, `null\n${payloadRaw}`))).toBe("malformed");
    });

    it("gates on schemaVersion before manifest schema", () => {
      const future = { ...manifest, schemaVersion: "8", extraFutureField: true };
      expect(codeOf(() => parseBundle(frame, `${JSON.stringify(future)}\n${payloadRaw}`))).toBe(
        "unsupported_version",
      );
    });

    it("rejects a manifest failing schema", () => {
      const bad = { ...manifest, payloadSha256: "zzz" };
      expect(codeOf(() => parseBundle(frame, `${JSON.stringify(bad)}\n${payloadRaw}`))).toBe(
        "malformed",
      );
    });

    it("rejects tampered payload with hash_mismatch", () => {
      expect(codeOf(() => parseBundle(frame, text.replace("alpha", "aXpha")))).toBe(
        "hash_mismatch",
      );
    });

    it("rejects payload JSON syntax errors", () => {
      const badPayload = "{not json";
      const m = { ...manifest, payloadSha256: sha256Hex(badPayload) };
      expect(codeOf(() => parseBundle(frame, `${JSON.stringify(m)}\n${badPayload}`))).toBe(
        "malformed",
      );
    });

    it("rejects payload failing its schema", () => {
      const raw = JSON.stringify({ items: [1] });
      const m = { ...manifest, payloadSha256: sha256Hex(raw) };
      expect(codeOf(() => parseBundle(frame, `${JSON.stringify(m)}\n${raw}`))).toBe("malformed");
    });
  });
  ```

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/bundle-frame.test.ts
  ```
  Expected: FAIL — the file cannot resolve import `../src/bundle-frame.js` (module does not exist).

- [ ] **Step 3: Implement the frame**

  Write `packages/core/src/bundle-frame.ts`:

  ```ts
  import { createHash } from "node:crypto";
  import type { ZodType, ZodTypeDef } from "zod";

  export type BundleFrameErrorCode = "malformed" | "hash_mismatch" | "unsupported_version";

  // Input is `unknown` (not M): entity schemas in payloads use .default()/.transform(),
  // so their zod Input type diverges from the Output type.
  export interface BundleFrameConfig<M, P> {
    schemaVersion: string;
    manifestSchema: ZodType<M, ZodTypeDef, unknown>;
    payloadSchema: ZodType<P, ZodTypeDef, unknown>;
    payloadShaOf: (manifest: M) => string;
    makeError: (code: BundleFrameErrorCode, message: string) => Error;
  }

  export function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  export function serializeBundle<M, P>(
    cfg: BundleFrameConfig<M, P>,
    bundle: { manifest: M; payload: P },
  ): string {
    const manifest = cfg.manifestSchema.parse(bundle.manifest);
    return `${JSON.stringify(manifest)}\n${JSON.stringify(bundle.payload)}`;
  }

  export function parseBundle<M, P>(
    cfg: BundleFrameConfig<M, P>,
    text: string,
  ): { manifest: M; payload: P } {
    const idx = text.indexOf("\n");
    if (idx === -1) {
      throw cfg.makeError("malformed", "Bundle must contain a manifest line and a payload line.");
    }
    const manifestRaw = text.slice(0, idx);
    // Serialize never appends a trailing newline; strip one a transfer/editor may
    // have added so a benign final newline isn't misread as corruption.
    const payloadRaw = text.slice(idx + 1).replace(/\r?\n$/, "");

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch {
      throw cfg.makeError("malformed", "Bundle manifest is not valid JSON.");
    }
    if (manifestJson === null || typeof manifestJson !== "object") {
      throw cfg.makeError("malformed", "Bundle manifest is not a JSON object.");
    }
    const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
    if (version !== cfg.schemaVersion) {
      throw cfg.makeError(
        "unsupported_version",
        `Bundle schemaVersion ${String(version)} is not supported; this build reads version ${cfg.schemaVersion}. Upgrade mega.`,
      );
    }
    const manifestResult = cfg.manifestSchema.safeParse(manifestJson);
    if (!manifestResult.success) {
      throw cfg.makeError("malformed", "Bundle manifest failed schema validation.");
    }
    const manifest = manifestResult.data;

    if (sha256Hex(payloadRaw) !== cfg.payloadShaOf(manifest)) {
      throw cfg.makeError(
        "hash_mismatch",
        "Bundle payload hash mismatch — file is corrupted or tampered.",
      );
    }

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(payloadRaw);
    } catch {
      throw cfg.makeError("malformed", "Bundle payload is not valid JSON.");
    }
    const payloadResult = cfg.payloadSchema.safeParse(payloadJson);
    if (!payloadResult.success) {
      throw cfg.makeError("malformed", "Bundle payload failed schema validation.");
    }
    return { manifest, payload: payloadResult.data };
  }
  ```

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/bundle-frame.test.ts
  ```
  Expected: PASS — 13 tests green.

- [ ] **Step 4: Rewire brain-bundle onto the frame (public surface and bytes unchanged)**

  Replace the full contents of `packages/core/src/brain-bundle.ts` with:

  ```ts
  import { z } from "zod";
  import {
    type BundleFrameConfig,
    parseBundle,
    serializeBundle,
    sha256Hex,
  } from "./bundle-frame.js";
  import { failedAttemptSchema } from "./failed-attempt.js";
  import { memoryEntrySchema } from "./memory-entry.js";
  import { projectRuleSchema } from "./project-rule.js";

  export const BRAIN_SCHEMA_VERSION = "1";

  export type BrainBundleErrorCode = "malformed" | "hash_mismatch" | "unsupported_version";

  export class BrainBundleError extends Error {
    readonly code: BrainBundleErrorCode;

    constructor(code: BrainBundleErrorCode, message: string) {
      super(message);
      this.name = "BrainBundleError";
      this.code = code;
    }
  }

  export const brainManifestSchema = z
    .object({
      schemaVersion: z.literal(BRAIN_SCHEMA_VERSION),
      kind: z.literal("megabrain"),
      sourceProject: z.object({ id: z.string().uuid(), name: z.string().trim().min(1) }).strict(),
      createdAt: z.string().datetime({ offset: true }),
      counts: z
        .object({
          memories: z.number().int().nonnegative(),
          rules: z.number().int().nonnegative(),
          failures: z.number().int().nonnegative(),
        })
        .strict(),
      payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
      redactionFindings: z.number().int().nonnegative(),
    })
    .strict();
  export type BrainManifest = z.infer<typeof brainManifestSchema>;

  export const brainPayloadSchema = z
    .object({
      memories: z.array(memoryEntrySchema),
      rules: z.array(projectRuleSchema),
      failures: z.array(failedAttemptSchema),
    })
    .strict();
  export type BrainPayload = z.infer<typeof brainPayloadSchema>;

  export type BrainBundle = { manifest: BrainManifest; payload: BrainPayload };

  const brainFrame: BundleFrameConfig<BrainManifest, BrainPayload> = {
    schemaVersion: BRAIN_SCHEMA_VERSION,
    manifestSchema: brainManifestSchema,
    payloadSchema: brainPayloadSchema,
    payloadShaOf: (manifest) => manifest.payloadSha256,
    makeError: (code, message) => new BrainBundleError(code, message),
  };

  export function serializeBrainBundle(input: {
    sourceProject: { id: string; name: string };
    createdAt: string;
    redactionFindings: number;
    payload: BrainPayload;
  }): string {
    const payloadRaw = JSON.stringify(input.payload);
    return serializeBundle(brainFrame, {
      manifest: {
        schemaVersion: BRAIN_SCHEMA_VERSION,
        kind: "megabrain",
        sourceProject: input.sourceProject,
        createdAt: input.createdAt,
        counts: {
          memories: input.payload.memories.length,
          rules: input.payload.rules.length,
          failures: input.payload.failures.length,
        },
        payloadSha256: sha256Hex(payloadRaw),
        redactionFindings: input.redactionFindings,
      },
      payload: input.payload,
    });
  }

  export function parseBrainBundle(text: string): BrainBundle {
    return parseBundle(brainFrame, text);
  }
  ```

  Note: output bytes are identical to before — `serializeBundle` stringifies the
  `manifestSchema.parse` result exactly as the old code did (zod emits keys in schema
  order), and all error messages/codes are byte-for-byte the ones the frame carried over.

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/brain-bundle.test.ts test/bundle-frame.test.ts
  ```
  Expected: PASS — brain-bundle's 12 tests pass UNMODIFIED, frame's 13 tests pass.

- [ ] **Step 5: Package-wide checks**

  Run:
  ```bash
  pnpm --filter @megasaver/core test
  pnpm --filter @megasaver/core typecheck
  pnpm exec biome check packages/core/src/bundle-frame.ts packages/core/src/brain-bundle.ts packages/core/test/bundle-frame.test.ts
  ```
  Expected: full core suite green (brain-export/brain-import tests also exercise the
  bundle path); typecheck clean; biome reports no issues.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/bundle-frame.ts packages/core/src/brain-bundle.ts packages/core/test/bundle-frame.test.ts
  git commit -m "refactor(core): extract shared bundle frame" -m "Hot Handoff (spec finding m1) needs the same two-line manifest+payload discipline as the brain bundle. Share the frame (serialize, ordered parse, sha256, newline tolerance) instead of duplicating the parse ordering. Brain bundle public surface, bytes, and error codes unchanged; its tests pass unmodified."
  ```

---

### Task 2: Handoff packet — schemas, serialize/parse, error type, diagnose, expiry

**Files:**
- Create: `packages/core/src/handoff-packet.ts`
- Create: `packages/core/test/handoff-packet.test.ts`
- Create: `packages/core/test/handoff-packet-exports.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing packet test**

  Write `packages/core/test/handoff-packet.test.ts`:

  ```ts
  import { createHash } from "node:crypto";
  import { describe, expect, it } from "vitest";
  import type { FailedAttempt } from "../src/failed-attempt.js";
  import {
    type HandoffManifest,
    type HandoffPacket,
    HandoffPacketError,
    type HandoffPayload,
    diagnoseHandoffPacket,
    parseHandoffPacket,
    serializeHandoffPacket,
  } from "../src/handoff-packet.js";
  import type { MemoryEntry } from "../src/memory-entry.js";

  const sha256ForTest = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

  const NOW_ISO = "2026-07-18T12:00:00.000Z";
  const NOW = Date.parse(NOW_ISO);
  const EXPIRES_ISO = "2026-07-19T12:00:00.000Z";
  const PROJECT_ID = "0f0e0d0c-0b0a-4900-8807-060504030201";

  const memory: MemoryEntry = {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use NDJSON bundles",
    content: "Two-line NDJSON keeps payload hashing byte-exact.",
    keywords: ["ndjson"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  } as MemoryEntry;

  const failure: FailedAttempt = {
    id: "33333333-3333-4333-8333-333333333333",
    projectId: PROJECT_ID,
    sessionId: null,
    task: "bundle import",
    failedStep: "hash check",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: NOW_ISO,
  } as unknown as FailedAttempt;

  const payload: HandoffPayload = {
    taskSummary: { text: "Fix flaky test in session store", tokenEstimate: 42 },
    resumeInstructions: "You are resuming a task handed off from claude-code.",
    git: {
      branch: "feat/hot-handoff",
      headSha: "abc1234",
      dirty: true,
      commits: [{ sha: "abc1234", subject: "feat: start", date: NOW_ISO }],
      changedFiles: [{ path: "src/a.ts", churn: 3 }],
      diff: {
        text: "diff --git a/src/a.ts b/src/a.ts",
        truncated: false,
        excludedPaths: [".env"],
      },
    },
    failures: [failure],
    memories: [memory],
  };

  const manifest: HandoffManifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: "codex",
    createdAt: NOW_ISO,
    expiresAt: EXPIRES_ISO,
    payloadSha256: "0".repeat(64),
    redactionFindings: 0,
    secretPathsExcluded: 1,
    counts: { memories: 1, failures: 1, diffFiles: 1, commits: 1 },
  };

  const packet: HandoffPacket = { manifest, payload };
  const text = serializeHandoffPacket(packet);

  const manifestLineOf = (t: string) => JSON.parse(t.slice(0, t.indexOf("\n"))) as HandoffManifest;

  function codeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(HandoffPacketError);
      return (error as HandoffPacketError).code;
    }
    return expect.unreachable() as never;
  }

  describe("serializeHandoffPacket", () => {
    it("writes manifest + payload lines and recomputes payloadSha256", () => {
      const idx = text.indexOf("\n");
      expect(idx).toBeGreaterThan(0);
      expect(text.endsWith("\n")).toBe(false);
      const line = manifestLineOf(text);
      expect(line.kind).toBe("megahandoff");
      expect(line.payloadSha256).toBe(sha256ForTest(text.slice(idx + 1)));
      expect(line.payloadSha256).not.toBe("0".repeat(64));
    });
  });

  describe("parseHandoffPacket", () => {
    it("roundtrips an unexpired packet", () => {
      const parsed = parseHandoffPacket(text, { now: NOW });
      expect(parsed.manifest.targetAgent).toBe("codex");
      expect(parsed.payload.memories[0]?.title).toBe("Use NDJSON bundles");
      expect(parsed.payload.git?.diff?.excludedPaths).toEqual([".env"]);
    });

    it("tolerates a trailing newline", () => {
      expect(parseHandoffPacket(`${text}\n`, { now: NOW }).manifest.sourceAgent).toBe(
        "claude-code",
      );
    });

    it("rejects at expiresAt exactly (fail-closed boundary)", () => {
      expect(codeOf(() => parseHandoffPacket(text, { now: Date.parse(EXPIRES_ISO) }))).toBe(
        "expired",
      );
    });

    it("rejects after expiry with code expired", () => {
      expect(codeOf(() => parseHandoffPacket(text, { now: Date.parse(EXPIRES_ISO) + 1 }))).toBe(
        "expired",
      );
    });

    it("checks hash before expiry: tampered + expired reports hash_mismatch", () => {
      const tampered = text.replace("Fix flaky", "Fix fluky");
      expect(
        codeOf(() => parseHandoffPacket(tampered, { now: Date.parse(EXPIRES_ISO) + 1 })),
      ).toBe("hash_mismatch");
    });

    it("rejects unknown schemaVersion with unsupported_version", () => {
      const future = { ...manifestLineOf(text), schemaVersion: "2", extraFutureField: true };
      const idx = text.indexOf("\n");
      expect(
        codeOf(() =>
          parseHandoffPacket(`${JSON.stringify(future)}\n${text.slice(idx + 1)}`, { now: NOW }),
        ),
      ).toBe("unsupported_version");
    });

    it("rejects a single-line file with malformed", () => {
      expect(codeOf(() => parseHandoffPacket("{}", { now: NOW }))).toBe("malformed");
    });
  });

  describe("diagnoseHandoffPacket", () => {
    it("reports all ok on a valid packet and returns parsed data", () => {
      const d = diagnoseHandoffPacket(text, { now: NOW });
      expect(d).toMatchObject({
        version: "ok",
        manifest: "ok",
        hash: "ok",
        expiry: "ok",
        payloadSchema: "ok",
      });
      expect(d.parsedManifest?.targetAgent).toBe("codex");
      expect(d.parsedPayload?.memories).toHaveLength(1);
    });

    it("reports expiry and hash independently on an expired tampered packet", () => {
      const tampered = text.replace("Fix flaky", "Fix fluky");
      const d = diagnoseHandoffPacket(tampered, { now: Date.parse(EXPIRES_ISO) + 1 });
      expect(d.version).toBe("ok");
      expect(d.manifest).toBe("ok");
      expect(d.hash).toBe("mismatch");
      expect(d.expiry).toBe("expired");
      expect(d.payloadSchema).toBe("ok");
    });

    it("reports payload schema failure with hash ok", () => {
      const badPayloadRaw = JSON.stringify({ nope: true });
      const line = { ...manifestLineOf(text), payloadSha256: sha256ForTest(badPayloadRaw) };
      const d = diagnoseHandoffPacket(`${JSON.stringify(line)}\n${badPayloadRaw}`, { now: NOW });
      expect(d.hash).toBe("ok");
      expect(d.expiry).toBe("ok");
      expect(d.payloadSchema).toBe("malformed");
      expect(d.parsedPayload).toBeUndefined();
    });

    it("never throws on garbage", () => {
      expect(diagnoseHandoffPacket("", { now: NOW })).toEqual({
        version: "unsupported",
        manifest: "malformed",
        hash: "skipped",
        expiry: "skipped",
        payloadSchema: "skipped",
      });
      const d = diagnoseHandoffPacket("nope\n{}", { now: NOW });
      expect(d.manifest).toBe("malformed");
      expect(d.hash).toBe("skipped");
      expect(d.payloadSchema).toBe("malformed");
    });
  });
  ```

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/handoff-packet.test.ts
  ```
  Expected: FAIL — cannot resolve import `../src/handoff-packet.js`.

- [ ] **Step 2: Implement the packet module**

  Write `packages/core/src/handoff-packet.ts`:

  ```ts
  import { z } from "zod";
  import {
    type BundleFrameConfig,
    parseBundle,
    serializeBundle,
    sha256Hex,
  } from "./bundle-frame.js";
  import { failedAttemptSchema } from "./failed-attempt.js";
  import { memoryEntrySchema } from "./memory-entry.js";

  export const HANDOFF_SCHEMA_VERSION = "1";

  export type HandoffPacketErrorCode =
    | "malformed"
    | "hash_mismatch"
    | "unsupported_version"
    | "expired";

  export class HandoffPacketError extends Error {
    readonly code: HandoffPacketErrorCode;

    constructor(code: HandoffPacketErrorCode, message: string) {
      super(message);
      this.name = "HandoffPacketError";
      this.code = code;
    }
  }

  export const handoffManifestSchema = z
    .object({
      schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
      kind: z.literal("megahandoff"),
      sourceProject: z.object({ name: z.string().trim().min(1) }).strict(),
      sourceAgent: z.string().min(1),
      targetAgent: z.string().min(1),
      createdAt: z.string().datetime({ offset: true }),
      expiresAt: z.string().datetime({ offset: true }),
      payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
      redactionFindings: z.number().int().nonnegative(),
      secretPathsExcluded: z.number().int().nonnegative(),
      counts: z
        .object({
          memories: z.number().int().nonnegative(),
          failures: z.number().int().nonnegative(),
          diffFiles: z.number().int().nonnegative(),
          commits: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict();
  export type HandoffManifest = z.infer<typeof handoffManifestSchema>;

  export const handoffGitSchema = z
    .object({
      branch: z.string().nullable(),
      headSha: z.string().nullable(),
      dirty: z.boolean(),
      commits: z.array(
        z.object({ sha: z.string(), subject: z.string(), date: z.string() }).strict(),
      ),
      changedFiles: z.array(z.object({ path: z.string(), churn: z.number() }).strict()),
      diff: z
        .object({
          text: z.string(),
          truncated: z.boolean(),
          excludedPaths: z.array(z.string()),
        })
        .strict()
        .nullable(),
    })
    .strict();
  export type HandoffGit = z.infer<typeof handoffGitSchema>;

  export const handoffPayloadSchema = z
    .object({
      taskSummary: z
        .object({ text: z.string(), tokenEstimate: z.number().int().nonnegative() })
        .strict(),
      resumeInstructions: z.string(),
      git: handoffGitSchema.nullable(),
      failures: z.array(failedAttemptSchema),
      memories: z.array(memoryEntrySchema),
    })
    .strict();
  export type HandoffPayload = z.infer<typeof handoffPayloadSchema>;

  export type HandoffPacket = { manifest: HandoffManifest; payload: HandoffPayload };

  const handoffFrame: BundleFrameConfig<HandoffManifest, HandoffPayload> = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    manifestSchema: handoffManifestSchema,
    payloadSchema: handoffPayloadSchema,
    payloadShaOf: (manifest) => manifest.payloadSha256,
    makeError: (code, message) => new HandoffPacketError(code, message),
  };

  export function serializeHandoffPacket(packet: HandoffPacket): string {
    // The sha is derived, never caller-owned: recompute it so a stale manifest
    // hash can never produce a packet that fails its own parse.
    return serializeBundle(handoffFrame, {
      manifest: {
        ...packet.manifest,
        payloadSha256: sha256Hex(JSON.stringify(packet.payload)),
      },
      payload: packet.payload,
    });
  }

  export function parseHandoffPacket(text: string, opts: { now: number }): HandoffPacket {
    const parsed = parseBundle(handoffFrame, text);
    if (Date.parse(parsed.manifest.expiresAt) <= opts.now) {
      throw new HandoffPacketError(
        "expired",
        `Packet expired at ${parsed.manifest.expiresAt} — ask the sender to re-pack, or run mega handoff clear.`,
      );
    }
    return parsed;
  }

  export interface HandoffDiagnostics {
    version: "ok" | "unsupported";
    manifest: "ok" | "malformed";
    hash: "ok" | "mismatch" | "skipped";
    expiry: "ok" | "expired" | "skipped";
    payloadSchema: "ok" | "malformed" | "skipped";
    parsedManifest?: HandoffManifest;
    parsedPayload?: HandoffPayload;
  }

  export function diagnoseHandoffPacket(
    text: string,
    opts: { now: number },
  ): HandoffDiagnostics {
    const diagnostics: HandoffDiagnostics = {
      version: "unsupported",
      manifest: "malformed",
      hash: "skipped",
      expiry: "skipped",
      payloadSchema: "skipped",
    };
    const idx = text.indexOf("\n");
    if (idx === -1) return diagnostics;

    let manifestJson: unknown = null;
    try {
      manifestJson = JSON.parse(text.slice(0, idx));
    } catch {
      manifestJson = null;
    }
    const payloadRaw = text.slice(idx + 1).replace(/\r?\n$/, "");

    if (manifestJson !== null && typeof manifestJson === "object") {
      const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
      if (version === HANDOFF_SCHEMA_VERSION) diagnostics.version = "ok";
      const manifestResult = handoffManifestSchema.safeParse(manifestJson);
      if (manifestResult.success) {
        diagnostics.manifest = "ok";
        diagnostics.parsedManifest = manifestResult.data;
        diagnostics.hash =
          sha256Hex(payloadRaw) === manifestResult.data.payloadSha256 ? "ok" : "mismatch";
        diagnostics.expiry =
          Date.parse(manifestResult.data.expiresAt) <= opts.now ? "expired" : "ok";
      }
    }

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(payloadRaw);
    } catch {
      diagnostics.payloadSchema = "malformed";
      return diagnostics;
    }
    const payloadResult = handoffPayloadSchema.safeParse(payloadJson);
    if (payloadResult.success) {
      diagnostics.payloadSchema = "ok";
      diagnostics.parsedPayload = payloadResult.data;
    } else {
      diagnostics.payloadSchema = "malformed";
    }
    return diagnostics;
  }
  ```

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/handoff-packet.test.ts
  ```
  Expected: PASS — all handoff-packet tests green.

- [ ] **Step 3: Write the failing index re-export test**

  Write `packages/core/test/handoff-packet-exports.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    HANDOFF_SCHEMA_VERSION,
    HandoffPacketError,
    diagnoseHandoffPacket,
    handoffGitSchema,
    handoffManifestSchema,
    handoffPayloadSchema,
    parseHandoffPacket,
    serializeHandoffPacket,
  } from "../src/index.js";

  describe("core index handoff exports", () => {
    it("re-exports the handoff packet surface", () => {
      expect(HANDOFF_SCHEMA_VERSION).toBe("1");
      expect(typeof serializeHandoffPacket).toBe("function");
      expect(typeof parseHandoffPacket).toBe("function");
      expect(typeof diagnoseHandoffPacket).toBe("function");
      expect(typeof handoffManifestSchema.parse).toBe("function");
      expect(typeof handoffGitSchema.parse).toBe("function");
      expect(typeof handoffPayloadSchema.parse).toBe("function");
      expect(new HandoffPacketError("expired", "x").code).toBe("expired");
    });
  });
  ```

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/handoff-packet-exports.test.ts
  ```
  Expected: FAIL — `../src/index.js` does not provide the named handoff exports.

- [ ] **Step 4: Re-export from the core index**

  In `packages/core/src/index.ts`, Edit — old string:

  ```ts
  export {
    type ImportBrainInput,
    type ImportBrainReport,
    type ImportCounts,
    importBrain,
  } from "./brain-import.js";
  ```

  new string:

  ```ts
  export {
    type ImportBrainInput,
    type ImportBrainReport,
    type ImportCounts,
    importBrain,
  } from "./brain-import.js";
  export {
    HANDOFF_SCHEMA_VERSION,
    HandoffPacketError,
    type HandoffDiagnostics,
    type HandoffGit,
    type HandoffManifest,
    type HandoffPacket,
    type HandoffPacketErrorCode,
    type HandoffPayload,
    diagnoseHandoffPacket,
    handoffGitSchema,
    handoffManifestSchema,
    handoffPayloadSchema,
    parseHandoffPacket,
    serializeHandoffPacket,
  } from "./handoff-packet.js";
  ```

  (`bundle-frame.ts` stays internal — it is not part of the public surface.)

  Run:
  ```bash
  pnpm --filter @megasaver/core test -- test/handoff-packet-exports.test.ts test/handoff-packet.test.ts
  ```
  Expected: PASS.

- [ ] **Step 5: Package-wide checks**

  Run:
  ```bash
  pnpm --filter @megasaver/core test
  pnpm --filter @megasaver/core typecheck
  pnpm exec biome check packages/core/src/handoff-packet.ts packages/core/src/index.ts packages/core/test/handoff-packet.test.ts packages/core/test/handoff-packet-exports.test.ts
  ```
  Expected: full core suite green, typecheck clean, biome no issues.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/handoff-packet.ts packages/core/src/index.ts packages/core/test/handoff-packet.test.ts packages/core/test/handoff-packet-exports.test.ts
  git commit -m "feat(core): add handoff packet schemas and parse" -m "Sibling of the brain bundle built on the shared frame: strict manifest/payload schemas (no badge field travels), fail-closed expiry after frame parse, and a never-throwing diagnoseHandoffPacket that runs every check it can for the inspect surface."
  ```
### Task 3: Hoist `verificationBadgeFor` from mcp-bridge into core

**Files:**
- Create: `packages/core/src/verification-badge.ts`
- Create: `packages/core/test/verification-badge.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/mcp-bridge/src/tools/code-truth-check.ts`
- Modify: `packages/mcp-bridge/src/tools/recall.ts`
- Modify: `packages/mcp-bridge/src/tools/get-relevant-memories.ts`
- Test (unchanged, must still pass): `packages/mcp-bridge/test/tools/code-truth-check.test.ts`

- [ ] **Step 1: Write failing core test** — create `packages/core/test/verification-badge.test.ts`:

```ts
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { verificationBadgeFor } from "../src/verification-badge.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const TS = "2026-07-01T00:00:00.000Z";
const HEAD = "1111111111111111111111111111111111111111";

const ANCHOR = {
  repoHead: HEAD,
  capturedAt: TS,
  files: [],
  symbols: [],
};

function entry(over: Partial<MemoryEntry>): MemoryEntry {
  return memoryEntrySchema.parse({
    id: "00000000-0000-4000-8000-0000000000a1",
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "badge fixture",
    content: "badge fixture",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  });
}

describe("verificationBadgeFor", () => {
  it("returns unanchored when no anchor", () => {
    expect(verificationBadgeFor(entry({}))).toBe("unanchored");
  });

  it("returns verified when anchored with no stored contradiction", () => {
    expect(verificationBadgeFor(entry({ anchor: ANCHOR }))).toBe("verified");
  });

  it("returns verified when anchored and last verification passed", () => {
    const badge = verificationBadgeFor(
      entry({
        anchor: ANCHOR,
        lastVerified: { headSha: HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    );
    expect(badge).toBe("verified");
  });

  it("returns contradicted-by-code when a contradiction is stored", () => {
    const badge = verificationBadgeFor(
      entry({
        anchor: ANCHOR,
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
      }),
    );
    expect(badge).toBe("contradicted-by-code");
  });

  it("anchor decides first: unanchored even with a stored contradiction", () => {
    const badge = verificationBadgeFor(
      entry({
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: false },
      }),
    );
    expect(badge).toBe("unanchored");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** —

```bash
pnpm --filter @megasaver/core test -- verification-badge
```

Expected: FAIL — `Cannot find module '../src/verification-badge.js'` (file does not exist yet).

- [ ] **Step 3: Create the hoisted module** — create `packages/core/src/verification-badge.ts` (verbatim move from `packages/mcp-bridge/src/tools/code-truth-check.ts:16-26`, only the import path changes):

```ts
import type { MemoryEntry } from "./memory-entry.js";

export type VerificationBadge = "verified" | "contradicted-by-code" | "unanchored";

// FREE badge from STORED state only (spec §8.6): the anchor decides
// anchored/unanchored; a stored contradiction wins over everything else. An
// anchored row with no stored contradiction reads "verified" — the badge
// claims "anchored, no known contradiction", never a live check.
export function verificationBadgeFor(entry: MemoryEntry): VerificationBadge {
  if (entry.anchor === undefined) return "unanchored";
  if (entry.lastVerified?.result === "contradicted") return "contradicted-by-code";
  return "verified";
}
```

- [ ] **Step 4: Export from core public surface** — in `packages/core/src/index.ts`, append after the final existing block (the `./autopilot.js` export at end of file):

```ts
export { type VerificationBadge, verificationBadgeFor } from "./verification-badge.js";
```

- [ ] **Step 5: Run test, expect PASS** —

```bash
pnpm --filter @megasaver/core test -- verification-badge
```

Expected: PASS — 5 tests green.

- [ ] **Step 6: Rebuild core dist** — mcp-bridge resolves `@megasaver/core` through `dist/` (package `exports` points at `./dist/index.js`), so the new export must land in dist before mcp-bridge sees it:

```bash
pnpm --filter @megasaver/core build
```

Expected: exit 0, `dist/index.js` / `dist/index.d.ts` regenerated.

- [ ] **Step 7: Remove the definition from mcp-bridge** — in `packages/mcp-bridge/src/tools/code-truth-check.ts`, delete lines 16–26 exactly (the type, its comment, and the function):

```ts
export type VerificationBadge = "verified" | "contradicted-by-code" | "unanchored";

// FREE badge from STORED state only (spec §8.6): the anchor decides
// anchored/unanchored; a stored contradiction wins over everything else. An
// anchored row with no stored contradiction reads "verified" — the badge
// claims "anchored, no known contradiction", never a live check.
export function verificationBadgeFor(entry: MemoryEntry): VerificationBadge {
  if (entry.anchor === undefined) return "unanchored";
  if (entry.lastVerified?.result === "contradicted") return "contradicted-by-code";
  return "verified";
}
```

Everything else in the file stays byte-identical (the `MemoryEntry` import remains used by `SpotCheckEnv`/`spotCheckHits`).

- [ ] **Step 8: Re-point recall.ts imports** — in `packages/mcp-bridge/src/tools/recall.ts`, replace the two import blocks (lines 2–8 and 12–18). Old:

```ts
import {
  type ChangedFrom,
  type CoreRegistry,
  type MemoryEntry,
  changedFromFor,
  isRecallable,
} from "@megasaver/core";
```

and

```ts
import {
  type ContradictedDisclosure,
  type VerificationBadge,
  spotCheckHits,
  verificationBadgeFor,
} from "./code-truth-check.js";
```

New:

```ts
import {
  type ChangedFrom,
  type CoreRegistry,
  type MemoryEntry,
  type VerificationBadge,
  changedFromFor,
  isRecallable,
  verificationBadgeFor,
} from "@megasaver/core";
```

and

```ts
import { type ContradictedDisclosure, spotCheckHits } from "./code-truth-check.js";
```

- [ ] **Step 9: Re-point get-relevant-memories.ts imports** — in `packages/mcp-bridge/src/tools/get-relevant-memories.ts`, replace the two import blocks (lines 1–10 and 15–20). Old:

```ts
import {
  type ChangedFrom,
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  changedFromFor,
  isRecallable,
  memoryEmbeddingsSidecarPath,
  searchMemoryEntriesSemantic,
} from "@megasaver/core";
```

and

```ts
import {
  type ContradictedDisclosure,
  type VerificationBadge,
  spotCheckHits,
  verificationBadgeFor,
} from "./code-truth-check.js";
```

New:

```ts
import {
  type ChangedFrom,
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  type VerificationBadge,
  changedFromFor,
  isRecallable,
  memoryEmbeddingsSidecarPath,
  searchMemoryEntriesSemantic,
  verificationBadgeFor,
} from "@megasaver/core";
```

and

```ts
import { type ContradictedDisclosure, spotCheckHits } from "./code-truth-check.js";
```

- [ ] **Step 10: Run mcp-bridge tests UNCHANGED, expect PASS** —

```bash
pnpm --filter @megasaver/mcp-bridge test
```

Expected: PASS — full suite green, `test/tools/code-truth-check.test.ts` included, zero test-file edits (it never imported the badge directly; it exercises badges through `handleRecall` / `handleGetRelevantMemories` responses).

- [ ] **Step 11: Lint + typecheck** —

```bash
pnpm lint && pnpm --filter @megasaver/mcp-bridge typecheck
```

Expected: both exit 0 (biome import order is already ASCII-sorted above).

- [ ] **Step 12: Commit** —

```bash
git add packages/core/src/verification-badge.ts packages/core/test/verification-badge.test.ts packages/core/src/index.ts packages/mcp-bridge/src/tools/code-truth-check.ts packages/mcp-bridge/src/tools/recall.ts packages/mcp-bridge/src/tools/get-relevant-memories.ts
git commit -m "$(cat <<'EOF'
refactor(core): hoist verificationBadgeFor into core

Handoff pack report needs badges without depending on mcp-bridge.
Verbatim move, behavior unchanged; mcp-bridge re-imports from
@megasaver/core and its tests pass unmodified.
EOF
)"
```

---

### Task 4: `gatherDirtyState` in `apps/cli/src/git-delta.ts`

**Files:**
- Create: `packages/core/src/handoff-export.ts` (interface only — Task 5 extends this file)
- Modify: `packages/core/src/index.ts`
- Modify: `apps/cli/src/git-delta.ts`
- Test: `apps/cli/test/git-delta.test.ts` (append a describe block; existing `gatherGitDelta` tests untouched)

Contract note applied: `GitDelta` lives in core (`packages/core/src/warm-start.ts:16`, re-exported at `index.ts:153`), so per the contract's GitDelta-precedent clause `HandoffDirtyState` is DEFINED in `packages/core/src/handoff-export.ts` and imported by the CLI — not defined in git-delta.ts.

- [ ] **Step 1: Write failing tests** — append to the end of `apps/cli/test/git-delta.test.ts` (reuses the file's existing `fakeGit` helper; NOTE: inside `fakeGit` responses, `"diff --cached"` must be listed BEFORE `"diff"` — the helper is prefix-matched in insertion order):

```ts
describe("gatherDirtyState", () => {
  it("reports a dirty tree with status paths and combined diff", () => {
    const state = gatherDirtyState(
      "/repo",
      fakeGit({
        "status --porcelain": " M src/a.ts\n?? notes.md\n",
        "rev-parse HEAD": "abc1234def\n",
        "diff --cached": "diff --git b staged\n",
        diff: "diff --git a unstaged\n",
      }),
    );
    expect(state).toEqual({
      headSha: "abc1234def",
      dirty: true,
      statusPaths: [
        { path: "src/a.ts", status: "M" },
        { path: "notes.md", status: "??" },
      ],
      diffText: "diff --git a unstaged\n\ndiff --git b staged\n",
    });
  });

  it("clean tree: no diff calls, diffText null", () => {
    const state = gatherDirtyState(
      "/repo",
      fakeGit({
        "status --porcelain": "",
        "rev-parse HEAD": "abc1234def\n",
      }),
    );
    expect(state).toEqual({
      headSha: "abc1234def",
      dirty: false,
      statusPaths: [],
      diffText: null,
    });
  });

  it("rename lines keep the new path; unborn HEAD yields null headSha", () => {
    const state = gatherDirtyState(
      "/repo",
      fakeGit({
        "status --porcelain": "R  old.ts -> new.ts\n",
        "rev-parse HEAD": new Error("unborn"),
        "diff --cached": "",
        diff: "",
      }),
    );
    expect(state).toEqual({
      headSha: null,
      dirty: true,
      statusPaths: [{ path: "new.ts", status: "R" }],
      diffText: "\n",
    });
  });

  it("returns null when not a git repo", () => {
    expect(
      gatherDirtyState("/repo", () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});
```

And extend the import at the top of the same file. Old (line 2):

```ts
import { type ExecGit, gatherGitDelta } from "../src/git-delta.js";
```

New:

```ts
import { type ExecGit, gatherDirtyState, gatherGitDelta } from "../src/git-delta.js";
```

- [ ] **Step 2: Run test, expect FAIL** —

```bash
pnpm --filter @megasaver/cli test -- git-delta
```

Expected: FAIL — `gatherDirtyState` is not exported by `../src/git-delta.js` (SyntaxError/undefined import); the 4 pre-existing `gatherGitDelta` tests still pass.

- [ ] **Step 3: Define `HandoffDirtyState` in core** — create `packages/core/src/handoff-export.ts`:

```ts
export interface HandoffDirtyState {
  headSha: string | null;
  dirty: boolean;
  statusPaths: { path: string; status: string }[];
  diffText: string | null;
}
```

- [ ] **Step 4: Export from core public surface** — in `packages/core/src/index.ts`, append after the `./verification-badge.js` line added in Task 3:

```ts
export type { HandoffDirtyState } from "./handoff-export.js";
```

Then rebuild dist so downstream `tsc -b` consumers stay coherent:

```bash
pnpm --filter @megasaver/core build
```

Expected: exit 0.

- [ ] **Step 5: Implement `gatherDirtyState`** — in `apps/cli/src/git-delta.ts`, replace the type-only import at line 2. Old:

```ts
import type { GitDelta } from "@megasaver/core";
```

New:

```ts
import type { GitDelta, HandoffDirtyState } from "@megasaver/core";
```

Then append at the end of the file:

```ts
export function gatherDirtyState(
  cwd: string,
  execGit: ExecGit = defaultExecGit,
): HandoffDirtyState | null {
  const status = tryGit(execGit, ["status", "--porcelain"], cwd);
  if (status === null) return null;

  const statusPaths: HandoffDirtyState["statusPaths"] = [];
  for (const line of status.split("\n")) {
    if (line.trim() === "") continue;
    const state = line.slice(0, 2).trim();
    const rest = line.slice(3);
    // porcelain rename lines read "R  old -> new"; keep the path that exists
    // so downstream evaluatePathRead filtering matches real files
    const arrow = rest.indexOf(" -> ");
    const path = (arrow === -1 ? rest : rest.slice(arrow + 4)).trim();
    if (path === "") continue;
    statusPaths.push({ path, status: state });
  }

  const headSha = tryGit(execGit, ["rev-parse", "HEAD"], cwd)?.trim() ?? null;
  const dirty = statusPaths.length > 0;
  const diffText = dirty
    ? `${tryGit(execGit, ["diff"], cwd) ?? ""}\n${tryGit(execGit, ["diff", "--cached"], cwd) ?? ""}`
    : null;

  return { headSha, dirty, statusPaths, diffText };
}
```

(Reuses the file's existing `defaultExecGit` — 3000 ms timeout, 10 MB maxBuffer, stderr ignored — and `tryGit` throw→null convention; nothing new is defined for exec.)

- [ ] **Step 6: Run test, expect PASS** —

```bash
pnpm --filter @megasaver/cli test -- git-delta
```

Expected: PASS — 8 tests green (4 existing `gatherGitDelta` + 4 new `gatherDirtyState`).

- [ ] **Step 7: Lint + typecheck** —

```bash
pnpm lint && pnpm --filter @megasaver/cli typecheck
```

Expected: both exit 0.

- [ ] **Step 8: Commit** —

```bash
git add packages/core/src/handoff-export.ts packages/core/src/index.ts apps/cli/src/git-delta.ts apps/cli/test/git-delta.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): gather dirty worktree state for handoff

GitDelta carries neither HEAD nor uncommitted changes; the handoff
packet needs both. HandoffDirtyState lives in core (GitDelta
precedent) so buildHandoffPacket receives it as plain data.
EOF
)"
```
## Task 5 — `packages/core/src/handoff-export.ts`: pure `buildHandoffPacket`

Split into 5a (selection + redaction + brief + manifest/report), 5b (diff + path-filter
pipeline), 5c (public surface + round-trip/adversarial assembly tests). Depends on
Task 1 (`bundle-frame.ts` → `sha256Hex`), Task 2 (`handoff-packet.ts` types/schemas),
Task 3 (`verification-badge.ts`). Task 4 (`gatherDirtyState`) imports `HandoffDirtyState`
FROM this file via `@megasaver/core` (GitDelta precedent confirmed: `GitDelta` lives in
`packages/core/src/warm-start.ts:16` and `apps/cli/src/git-delta.ts:2` imports it from core).

Source facts this section is written against (verified 2026-07-18):

- `isRecallable(m, asOf, opts?)` and `effectiveConfidence(m, now)` take **ISO-string**
  time (`packages/core/src/memory-entry.ts:176,224`); contract input carries epoch ms →
  convert once.
- `assembleWarmStartBrief(input: WarmStartInput)` (`packages/core/src/warm-start.ts:189`)
  requires `{ projectName, branch, now, budgetTokens?, mode?, lastSeenAt,
  reonboardUnlocked, timeless, memories, rules, failedAttempts, gitDelta }`.
- `evaluatePathRead({ path, project, permissions? })` from `@megasaver/policy`
  (`packages/policy/src/evaluate-path-read.ts:17`); `permissions` is `?:` — with
  `exactOptionalPropertyTypes` it must be spread conditionally (the
  `runTwoGates` pattern, `packages/context-gate/src/read.ts:105-109`).
- `compressDiff` is **not** on `@megasaver/output-filter`'s public surface; the
  already-exported `compressByCategory("diff", text)` dispatches to exactly it
  (`packages/output-filter/src/compress/index.ts:21`). We use that — no
  output-filter edit, no rebuild step.
- `estimateTokens(text): number` is public (`@megasaver/output-filter`).
- Redaction helpers `makeRedactor`/`redactMemory`/`redactFailure` exist private in
  `packages/core/src/brain-export.ts:16-69`; we export them (no behavior change,
  no `index.ts` re-export) instead of duplicating ~50 lines.
- Core tests live in `packages/core/test/<name>.test.ts`, import from
  `../src/<file>.js`, vitest `describe/it`, schema-`parse`d fixtures.

---

### Task 5a: `buildHandoffPacket` — memory/failure selection, redaction accumulator, warm-start brief, manifest + report

**Files:**
- Modify: `packages/core/src/brain-export.ts` (add `export` to 4 existing declarations)
- Modify: `packages/core/src/handoff-export.ts` (created by Task 4 with only the `HandoffDirtyState` interface — REPLACE contents but PRESERVE that exported interface)
- Test: `packages/core/test/handoff-export.test.ts`

- [ ] **Step 1: Write the failing test file** — create
  `packages/core/test/handoff-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { type FailedAttempt, failedAttemptSchema } from "../src/failed-attempt.js";
import { type BuildHandoffPacketInput, buildHandoffPacket } from "../src/handoff-export.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const NOW_ISO = "2026-07-18T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const EXPIRES = NOW + 24 * 60 * 60 * 1000;
const PROJECT_ID = projectIdSchema.parse("0f0e0d0c-0b0a-4900-8807-060504030201");
const SESSION_ID = sessionIdSchema.parse("44444444-4444-4444-8444-444444444444");
const OTHER_SESSION_ID = sessionIdSchema.parse("55555555-5555-4555-8555-555555555555");
const SECRET = "sk-ant-api03-abcdefghij0123456789";

let seq = 0;
function nextSuffix(): string {
  seq += 1;
  return String(seq).padStart(12, "0");
}

function memory(overrides: Record<string, unknown> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: `11111111-1111-4111-8111-${nextSuffix()}`,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "decision title",
    content: "decided something",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  });
}

function failure(overrides: Record<string, unknown> = {}): FailedAttempt {
  return failedAttemptSchema.parse({
    id: `33333333-3333-4333-8333-${nextSuffix()}`,
    projectId: PROJECT_ID,
    sessionId: null,
    task: "deploy",
    failedStep: "auth",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: NOW_ISO,
    ...overrides,
  });
}

function baseInput(overrides: Partial<BuildHandoffPacketInput> = {}): BuildHandoffPacketInput {
  return {
    projectName: "alpha",
    projectId: PROJECT_ID,
    sourceAgent: "claude-code",
    targetAgent: "codex",
    resumeInstructions: "You are resuming a task handed off from claude-code on project alpha.",
    now: NOW,
    expiresAt: EXPIRES,
    memories: [],
    failedAttempts: [],
    rules: [],
    sessionId: null,
    gitDelta: null,
    dirtyState: null,
    permissions: null,
    budgetTokens: 2000,
    ...overrides,
  };
}

describe("buildHandoffPacket — memory selection", () => {
  it("includes approved project memories; excludes suggested, stale, archival", () => {
    const keep = memory({ content: "keep me" });
    const suggested = memory({ approval: "suggested", content: "suggested row" });
    const stale = memory({ stale: true, content: "stale row" });
    const archival = memory({ tier: "archival", content: "archival row" });
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [keep, suggested, stale, archival] }),
    );
    const contents = packet.payload.memories.map((m) => m.content);
    expect(contents).toEqual(["keep me"]);
  });

  it("includes session memories of the resolved session only", () => {
    const mine = memory({ scope: "session", sessionId: SESSION_ID, content: "session insight" });
    const other = memory({
      scope: "session",
      sessionId: OTHER_SESSION_ID,
      content: "other session",
    });
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [mine, other], sessionId: SESSION_ID }),
    );
    const contents = packet.payload.memories.map((m) => m.content);
    expect(contents).toContain("session insight");
    expect(contents).not.toContain("other session");
  });

  it("excludes all session memories when no session resolved", () => {
    const mine = memory({ scope: "session", sessionId: SESSION_ID, content: "session insight" });
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [mine] }));
    expect(packet.payload.memories).toEqual([]);
    expect(report.noOpenSession).toBe(true);
  });

  it("ranks by effectiveConfidence and caps at 20", () => {
    const low = memory({ confidence: "low", content: "low confidence" });
    const high = memory({ confidence: "high", content: "high confidence" });
    const filler = Array.from({ length: 25 }, () => memory({ confidence: "medium" }));
    const { packet, report } = buildHandoffPacket(
      baseInput({ memories: [low, high, ...filler] }),
    );
    expect(packet.payload.memories).toHaveLength(20);
    expect(packet.payload.memories[0]?.content).toBe("high confidence");
    expect(packet.payload.memories.map((m) => m.content)).not.toContain("low confidence");
    expect(report.counts.memories).toBe(20);
  });
});

describe("buildHandoffPacket — failures", () => {
  it("keeps unresolved failures only", () => {
    const open = failure({ task: "open one" });
    const resolved = failure({ task: "resolved one", resolution: "fixed by pinning node" });
    const converted = failure({ task: "converted one", convertedToRule: true });
    const { packet } = buildHandoffPacket(
      baseInput({ failedAttempts: [open, resolved, converted] }),
    );
    expect(packet.payload.failures.map((f) => f.task)).toEqual(["open one"]);
  });

  it("orders most recent first and caps at 10", () => {
    const older = failure({ task: "older", createdAt: "2026-07-18T09:00:00.000Z" });
    const newer = failure({ task: "newer", createdAt: "2026-07-18T11:00:00.000Z" });
    const filler = Array.from({ length: 11 }, () =>
      failure({ createdAt: "2026-07-18T10:00:00.000Z" }),
    );
    const { packet } = buildHandoffPacket(
      baseInput({ failedAttempts: [older, ...filler, newer] }),
    );
    expect(packet.payload.failures).toHaveLength(10);
    expect(packet.payload.failures[0]?.task).toBe("newer");
    expect(packet.payload.failures.map((f) => f.task)).not.toContain("older");
  });
});

describe("buildHandoffPacket — task summary", () => {
  it("assembles a timeless standard brief, never micro", () => {
    const { packet } = buildHandoffPacket(baseInput({ memories: [memory()] }));
    const lines = packet.payload.taskSummary.text.split("\n");
    expect(lines[0]).toBe("# Warm Start — alpha");
    expect(packet.payload.taskSummary.text).toContain("## Standing decisions");
    expect(packet.payload.taskSummary.tokenEstimate).toBeGreaterThan(0);
  });
});

describe("buildHandoffPacket — redaction, manifest, report", () => {
  it("redacts secrets in every free-text field and sums findings", () => {
    const input = baseInput({
      memories: [memory({ content: `uses ${SECRET} here` })],
      failedAttempts: [failure({ errorOutput: `auth failed with ${SECRET}` })],
      resumeInstructions: `resume with ${SECRET}`,
    });
    const { packet, report } = buildHandoffPacket(input);
    expect(JSON.stringify(packet)).not.toContain(SECRET);
    expect(packet.manifest.redactionFindings).toBeGreaterThanOrEqual(3);
    expect(report.redactionFindings).toBe(packet.manifest.redactionFindings);
  });

  it("writes manifest identity, expiry, and counts", () => {
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [memory()], failedAttempts: [failure()] }),
    );
    expect(packet.manifest.kind).toBe("megahandoff");
    expect(packet.manifest.schemaVersion).toBe("1");
    expect(packet.manifest.sourceProject).toEqual({ name: "alpha" });
    expect(packet.manifest.sourceAgent).toBe("claude-code");
    expect(packet.manifest.targetAgent).toBe("codex");
    expect(packet.manifest.createdAt).toBe(NOW_ISO);
    expect(packet.manifest.expiresAt).toBe(new Date(EXPIRES).toISOString());
    expect(packet.manifest.counts).toEqual({
      memories: 1,
      failures: 1,
      diffFiles: 0,
      commits: 0,
    });
    expect(packet.manifest.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags degraded git and passes plain git state through", () => {
    const degraded = buildHandoffPacket(baseInput());
    expect(degraded.packet.payload.git).toBeNull();
    expect(degraded.report.degradedGit).toBe(true);

    const withGit = buildHandoffPacket(
      baseInput({
        gitDelta: {
          commits: [{ sha: "abc1234", subject: "feat: x", date: NOW_ISO }],
          changedFiles: [{ path: "src/app.ts", churn: 3 }],
          branch: "feat/hot-handoff",
        },
        dirtyState: { headSha: "abc1234", dirty: true, statusPaths: [], diffText: null },
      }),
    );
    expect(withGit.report.degradedGit).toBe(false);
    expect(withGit.packet.payload.git).toEqual({
      branch: "feat/hot-handoff",
      headSha: "abc1234",
      dirty: true,
      commits: [{ sha: "abc1234", subject: "feat: x", date: NOW_ISO }],
      changedFiles: [{ path: "src/app.ts", churn: 3 }],
      diff: null,
    });
    expect(withGit.packet.manifest.counts.commits).toBe(1);
  });

  it("recomputes badges into the report, never the payload", () => {
    const anchored = memory({
      content: "anchored row",
      anchor: { repoHead: "abc1234", capturedAt: NOW_ISO, files: [], symbols: [] },
    });
    const plain = memory({ content: "plain row", confidence: "low" });
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [anchored, plain] }));
    expect(report.badges).toEqual([
      { memoryId: anchored.id, badge: "verified" },
      { memoryId: plain.id, badge: "unanchored" },
    ]);
    for (const m of packet.payload.memories) {
      expect(m).not.toHaveProperty("badge");
    }
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
```

  Expected: vitest fails — the module resolves (Task 4 created it) but
  `buildHandoffPacket` is not exported: `SyntaxError: The requested module
  '../src/handoff-export.js' does not provide an export named
  'buildHandoffPacket'`. Red confirmed.

- [ ] **Step 3: Export the existing redaction helpers from `brain-export.ts`** —
  four `export` keywords, zero behavior change. In
  `packages/core/src/brain-export.ts` change:

```ts
type Redactor = { total: number; text(value: string): string };

function makeRedactor(): Redactor {
```

  to

```ts
export type Redactor = { total: number; text(value: string): string };

export function makeRedactor(): Redactor {
```

  and change

```ts
function redactMemory(entry: MemoryEntry, r: Redactor): MemoryEntry {
```

  to

```ts
export function redactMemory(entry: MemoryEntry, r: Redactor): MemoryEntry {
```

  and change

```ts
function redactFailure(failure: FailedAttempt, r: Redactor): FailedAttempt {
```

  to

```ts
export function redactFailure(failure: FailedAttempt, r: Redactor): FailedAttempt {
```

  (`redactRule` stays private — rules do not travel in the handoff payload.
  Nothing is added to `index.ts`.)

- [ ] **Step 4: Implement `handoff-export.ts` (5a scope)** — create
  `packages/core/src/handoff-export.ts`:

```ts
import { estimateTokens } from "@megasaver/output-filter";
import type { ProjectPermissions } from "@megasaver/policy";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { makeRedactor, redactFailure, redactMemory } from "./brain-export.js";
import { sha256Hex } from "./bundle-frame.js";
import type { FailedAttempt } from "./failed-attempt.js";
import {
  HANDOFF_SCHEMA_VERSION,
  type HandoffManifest,
  type HandoffPacket,
  type HandoffPayload,
} from "./handoff-packet.js";
import { type MemoryEntry, effectiveConfidence, isRecallable } from "./memory-entry.js";
import type { ProjectRule } from "./project-rule.js";
import { verificationBadgeFor } from "./verification-badge.js";
import { type GitDelta, assembleWarmStartBrief } from "./warm-start.js";

// Defined here, not in apps/cli: core receives it as plain data in
// BuildHandoffPacketInput, mirroring the GitDelta precedent (warm-start.ts).
export interface HandoffDirtyState {
  headSha: string | null;
  dirty: boolean;
  statusPaths: { path: string; status: string }[];
  diffText: string | null;
}

export interface BuildHandoffPacketInput {
  projectName: string;
  projectId: ProjectId;
  sourceAgent: string;
  targetAgent: string;
  resumeInstructions: string;
  now: number;
  expiresAt: number;
  memories: MemoryEntry[];
  failedAttempts: FailedAttempt[];
  rules: ProjectRule[];
  sessionId: SessionId | null;
  gitDelta: GitDelta | null;
  dirtyState: HandoffDirtyState | null;
  permissions: ProjectPermissions | null;
  budgetTokens: number;
}

export interface HandoffPackReport {
  redactionFindings: number;
  secretPathsExcluded: number;
  excludedPaths: string[];
  counts: { memories: number; failures: number; diffFiles: number; commits: number };
  noOpenSession: boolean;
  degradedGit: boolean;
  badges: { memoryId: string; badge: string }[];
}

export interface BuildHandoffPacketResult {
  packet: HandoffPacket;
  report: HandoffPackReport;
}

const MEMORY_CAP = 20;
const FAILURE_CAP = 10;

type HandoffGit = HandoffPayload["git"];

function selectMemories(input: BuildHandoffPacketInput, nowIso: string): MemoryEntry[] {
  return input.memories
    .filter(
      (m) =>
        isRecallable(m, nowIso) &&
        !m.stale &&
        (m.scope === "project" || (input.sessionId !== null && m.sessionId === input.sessionId)),
    )
    .sort(
      (a, b) =>
        effectiveConfidence(b, nowIso) - effectiveConfidence(a, nowIso) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MEMORY_CAP);
}

function selectFailures(input: BuildHandoffPacketInput): FailedAttempt[] {
  return input.failedAttempts
    .filter((f) => f.resolution === undefined && !f.convertedToRule)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, FAILURE_CAP);
}

function buildGit(input: BuildHandoffPacketInput): { git: HandoffGit; diffFiles: number } {
  if (input.gitDelta === null && input.dirtyState === null) return { git: null, diffFiles: 0 };
  return {
    git: {
      branch: input.gitDelta?.branch ?? null,
      headSha: input.dirtyState?.headSha ?? null,
      dirty: input.dirtyState?.dirty ?? false,
      commits: input.gitDelta?.commits ?? [],
      changedFiles: input.gitDelta?.changedFiles ?? [],
      diff: null,
    },
    diffFiles: 0,
  };
}

// Pure, no I/O. All registry and git data arrives pre-gathered; the CLI
// threads permissions and pre-renders resumeInstructions (no agent-specific
// logic in core).
export function buildHandoffPacket(input: BuildHandoffPacketInput): BuildHandoffPacketResult {
  const nowIso = new Date(input.now).toISOString();
  const r = makeRedactor();
  const excluded = new Set<string>();

  const selected = selectMemories(input, nowIso);
  const failures = selectFailures(input);
  const { git, diffFiles } = buildGit(input);

  // Explicit mode: never let selectWarmStartMode auto-pick — a handoff is
  // packed minutes after working and lastSeenAt<4h would collapse the brief
  // to the 300-token micro stub, ignoring budgetTokens (spec §5.7).
  const brief = assembleWarmStartBrief({
    projectName: input.projectName,
    branch: input.gitDelta?.branch ?? null,
    now: nowIso,
    budgetTokens: input.budgetTokens,
    mode: "standard",
    lastSeenAt: null,
    reonboardUnlocked: true,
    timeless: true,
    memories: input.memories,
    rules: input.rules,
    failedAttempts: input.failedAttempts,
    gitDelta: input.gitDelta,
  });
  const summaryText = r.text(brief.text);

  const payload: HandoffPayload = {
    taskSummary: { text: summaryText, tokenEstimate: estimateTokens(summaryText) },
    resumeInstructions: r.text(input.resumeInstructions),
    git,
    failures: failures.map((f) => redactFailure(f, r)),
    memories: selected.map((m) => redactMemory(m, r)),
  };

  const counts = {
    memories: payload.memories.length,
    failures: payload.failures.length,
    diffFiles,
    commits: git === null ? 0 : git.commits.length,
  };

  const manifest: HandoffManifest = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    kind: "megahandoff",
    sourceProject: { name: input.projectName },
    sourceAgent: input.sourceAgent,
    targetAgent: input.targetAgent,
    createdAt: nowIso,
    expiresAt: new Date(input.expiresAt).toISOString(),
    payloadSha256: sha256Hex(JSON.stringify(payload)),
    redactionFindings: r.total,
    secretPathsExcluded: excluded.size,
    counts,
  };

  return {
    packet: { manifest, payload },
    report: {
      redactionFindings: r.total,
      secretPathsExcluded: excluded.size,
      excludedPaths: [...excluded].sort(),
      counts,
      noOpenSession: input.sessionId === null,
      degradedGit: git === null,
      badges: selected.map((m) => ({ memoryId: m.id, badge: verificationBadgeFor(m) })),
    },
  };
}
```

- [ ] **Step 5: Run the test — expect PASS; brain-export regression — expect PASS** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
pnpm --filter @megasaver/core test -- test/brain-export.test.ts
```

  Expected: both files fully green (5a file: 11 tests passing;
  brain-export: 7 tests passing, unmodified).

- [ ] **Step 6: Commit** —

```bash
pnpm lint:fix
git add packages/core/src/handoff-export.ts packages/core/src/brain-export.ts packages/core/test/handoff-export.test.ts
git commit -m "$(cat <<'EOF'
feat(core): handoff packet builder selection core

buildHandoffPacket selects recallable non-stale memories (project scope
plus resolved-session scope, effectiveConfidence-ranked, cap 20) and
unresolved failures (cap 10, newest first), assembles an explicit
standard+timeless warm-start brief so auto mode-picking can never
collapse a fresh handoff to the micro stub, and accumulates redaction
findings across every free-text field via the brain-export redactor,
now exported for reuse. Badges are report-only — a packet can never
carry a forged trust signal.
EOF
)"
```

---

### Task 5b: diff + path-filter pipeline with threaded permissions

**Files:**
- Modify: `packages/core/src/handoff-export.ts`
- Test: `packages/core/test/handoff-export.test.ts` (append)

- [ ] **Step 1: Write failing diff-pipeline tests** — append to
  `packages/core/test/handoff-export.test.ts`. First extend the imports at the
  top of the file:

```ts
import { parseProjectPermissions } from "@megasaver/policy";
import {
  HANDOFF_DIFF_TOKEN_CAP,
  type HandoffDirtyState,
} from "../src/handoff-export.js";
```

  (merge into the existing `../src/handoff-export.js` import so biome keeps one
  specifier: `import { type BuildHandoffPacketInput, HANDOFF_DIFF_TOKEN_CAP, type HandoffDirtyState, buildHandoffPacket } from "../src/handoff-export.js";`)

  Then append the new describe block at the end of the file:

```ts
function fileDiff(path: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,1 @@",
    "-old",
    `+${added}`,
  ].join("\n");
}

function dirty(
  diffText: string | null,
  statusPaths: { path: string; status: string }[] = [],
): HandoffDirtyState {
  return { headSha: "abc1234", dirty: true, statusPaths, diffText };
}

describe("buildHandoffPacket — diff + path filter pipeline", () => {
  it.each([".env", "config/secrets/prod.yaml", ".ssh/id_rsa"])(
    "drops the %s hunk and lists it as excluded",
    (secretPath) => {
      const diffText = [fileDiff("src/app.ts", "safe change"), fileDiff(secretPath, "TOP=1")].join(
        "\n",
      );
      const { packet, report } = buildHandoffPacket(
        baseInput({ dirtyState: dirty(diffText) }),
      );
      const diff = packet.payload.git?.diff;
      expect(diff).not.toBeNull();
      expect(diff?.text).toContain("src/app.ts");
      expect(diff?.text).not.toContain(secretPath);
      expect(diff?.excludedPaths).toEqual([secretPath]);
      expect(packet.manifest.secretPathsExcluded).toBe(1);
      expect(report.excludedPaths).toEqual([secretPath]);
      expect(packet.manifest.counts.diffFiles).toBe(1);
    },
  );

  it("honors project deny.read globs only via the threaded permissions object", () => {
    const diffText = fileDiff("docs/private/notes.md", "internal");
    const without = buildHandoffPacket(baseInput({ dirtyState: dirty(diffText) }));
    expect(without.packet.payload.git?.diff?.text).toContain("docs/private/notes.md");
    expect(without.report.excludedPaths).toEqual([]);

    const permissions = parseProjectPermissions({ deny: { read: ["docs/private/**"] } });
    const withPerms = buildHandoffPacket(
      baseInput({ dirtyState: dirty(diffText), permissions }),
    );
    expect(withPerms.packet.payload.git?.diff?.text).not.toContain("docs/private/notes.md");
    expect(withPerms.report.excludedPaths).toEqual(["docs/private/notes.md"]);
  });

  it("filters changedFiles and statusPaths through the same check", () => {
    const { packet, report } = buildHandoffPacket(
      baseInput({
        gitDelta: {
          commits: [],
          changedFiles: [
            { path: ".env", churn: 3 },
            { path: "src/app.ts", churn: 1 },
          ],
          branch: "main",
        },
        dirtyState: dirty(null, [
          { path: ".aws/credentials", status: "M" },
          { path: "src/ok.ts", status: "M" },
        ]),
      }),
    );
    expect(packet.payload.git?.changedFiles).toEqual([{ path: "src/app.ts", churn: 1 }]);
    expect(report.excludedPaths).toEqual([".aws/credentials", ".env"]);
    expect(packet.manifest.secretPathsExcluded).toBe(2);
    expect(packet.payload.git?.diff).toBeNull();
    expect(JSON.stringify(packet.payload)).not.toContain(".aws/credentials");
  });

  it("redacts secrets inside surviving hunks", () => {
    const diffText = fileDiff("src/config.ts", `const key = "${SECRET}";`);
    const { packet } = buildHandoffPacket(baseInput({ dirtyState: dirty(diffText) }));
    expect(packet.payload.git?.diff?.text).not.toContain(SECRET);
    expect(packet.manifest.redactionFindings).toBeGreaterThan(0);
  });

  it("compresses unchanged context runs", () => {
    const diffText = [
      "diff --git a/src/ctx.ts b/src/ctx.ts",
      "--- a/src/ctx.ts",
      "+++ b/src/ctx.ts",
      "@@ -1,9 +1,9 @@",
      "-first change",
      "+first CHANGED",
      " ctx1",
      " ctx2",
      " ctx3",
      " ctx4",
      " ctx5",
      "-second change",
      "+second CHANGED",
    ].join("\n");
    const { packet } = buildHandoffPacket(baseInput({ dirtyState: dirty(diffText) }));
    expect(packet.payload.git?.diff?.text).toContain("unchanged]");
  });

  it("truncates whole trailing file chunks over the token cap", () => {
    const bigBody = Array.from({ length: 70 }, () => `+${"x".repeat(100)}`).join("\n");
    const bigFile = (path: string): string =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,1 +1,70 @@",
        bigBody,
      ].join("\n");
    const diffText = [bigFile("src/one.ts"), bigFile("src/two.ts")].join("\n");
    const { packet } = buildHandoffPacket(baseInput({ dirtyState: dirty(diffText) }));
    const diff = packet.payload.git?.diff;
    expect(diff?.truncated).toBe(true);
    expect(diff?.text).toContain("src/one.ts");
    expect(diff?.text).not.toContain("src/two.ts");
    expect(packet.manifest.counts.diffFiles).toBe(1);
    expect(diff === null || diff === undefined).toBe(false);
    if (diff != null) {
      expect(diff.text.length / 4).toBeLessThanOrEqual(HANDOFF_DIFF_TOKEN_CAP);
    }
  });

  it("keeps diff null on a clean tree while git state travels", () => {
    const { packet } = buildHandoffPacket(
      baseInput({
        dirtyState: { headSha: "abc1234", dirty: false, statusPaths: [], diffText: null },
      }),
    );
    expect(packet.payload.git?.diff).toBeNull();
    expect(packet.payload.git?.dirty).toBe(false);
    expect(packet.manifest.counts.diffFiles).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
```

  Expected: import of `HANDOFF_DIFF_TOKEN_CAP` fails (not exported), and after
  a moment's temptation to stub — every new diff test red (`diff` is `null`,
  excludedPaths empty). Red confirmed.

- [ ] **Step 3: Implement the pipeline** — in
  `packages/core/src/handoff-export.ts`:

  (a) extend imports:

```ts
import { compressByCategory, estimateTokens } from "@megasaver/output-filter";
import { type ProjectPermissions, evaluatePathRead } from "@megasaver/policy";
```

  and add `type Redactor` to the brain-export import:

```ts
import { type Redactor, makeRedactor, redactFailure, redactMemory } from "./brain-export.js";
```

  (b) add below `const FAILURE_CAP = 10;`:

```ts
// No cap value in the spec; parity with DEFAULT_WARM_START_BUDGET so the diff
// excerpt cannot dwarf the brief it accompanies.
export const HANDOFF_DIFF_TOKEN_CAP = 2000;

function pathAllowed(
  path: string,
  projectId: ProjectId,
  permissions: ProjectPermissions | null,
): boolean {
  return evaluatePathRead({
    path,
    project: projectId,
    ...(permissions === null ? {} : { permissions }),
  }).allowed;
}

type FileChunk = { path: string; text: string };

function splitDiffByFile(diffText: string): FileChunk[] {
  const chunks: FileChunk[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current !== null) chunks.push({ path: current.path, text: current.lines.join("\n") });
      const at = line.lastIndexOf(" b/");
      // ponytail: `git diff` quotes exotic paths; those misparse to the raw
      // header line, which then fails the path gate closed — never open.
      current = { path: at === -1 ? line : line.slice(at + 3), lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  if (current !== null) chunks.push({ path: current.path, text: current.lines.join("\n") });
  return chunks;
}
```

  (c) replace the whole 5a `buildGit` function with:

```ts
// Ordered, all steps mandatory (spec §5.4): split per-file hunks →
// evaluatePathRead drop (same threaded permissions on EVERY call, incl.
// changedFiles and porcelain paths — existence disclosure is a leak too) →
// redact → compress → token cap dropping whole trailing chunks.
function buildGit(
  input: BuildHandoffPacketInput,
  r: Redactor,
  excluded: Set<string>,
): { git: HandoffGit; diffFiles: number } {
  if (input.gitDelta === null && input.dirtyState === null) return { git: null, diffFiles: 0 };

  const changedFiles = (input.gitDelta?.changedFiles ?? []).filter((f) => {
    if (pathAllowed(f.path, input.projectId, input.permissions)) return true;
    excluded.add(f.path);
    return false;
  });
  for (const s of input.dirtyState?.statusPaths ?? []) {
    if (!pathAllowed(s.path, input.projectId, input.permissions)) excluded.add(s.path);
  }

  let diff: NonNullable<HandoffGit>["diff"] = null;
  let diffFiles = 0;
  const diffText = input.dirtyState?.diffText ?? null;
  if (diffText !== null) {
    const kept: FileChunk[] = [];
    for (const chunk of splitDiffByFile(diffText)) {
      if (pathAllowed(chunk.path, input.projectId, input.permissions)) kept.push(chunk);
      else excluded.add(chunk.path);
    }
    const compressed = kept.map((c) => ({
      path: c.path,
      text: compressByCategory("diff", r.text(c.text)).text,
    }));
    const included: FileChunk[] = [];
    let truncated = false;
    for (const chunk of compressed) {
      const candidate = [...included.map((c) => c.text), chunk.text].join("\n");
      if (estimateTokens(candidate) > HANDOFF_DIFF_TOKEN_CAP) {
        truncated = true;
        break;
      }
      included.push(chunk);
    }
    diffFiles = new Set(included.map((c) => c.path)).size;
    diff = {
      text: included.map((c) => c.text).join("\n"),
      truncated,
      excludedPaths: [...excluded].sort(),
    };
  }

  return {
    git: {
      branch: input.gitDelta?.branch ?? null,
      headSha: input.dirtyState?.headSha ?? null,
      dirty: input.dirtyState?.dirty ?? false,
      commits: input.gitDelta?.commits ?? [],
      changedFiles,
      diff,
    },
    diffFiles,
  };
}
```

  (d) update the call site in `buildHandoffPacket`:

```ts
  const { git, diffFiles } = buildGit(input, r, excluded);
```

- [ ] **Step 4: Run — expect PASS** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
```

  Expected: all tests green (5a's 11 + 5b's 8, incl. the 3 `it.each` rows).

- [ ] **Step 5: Commit** —

```bash
pnpm lint:fix
git add packages/core/src/handoff-export.ts packages/core/test/handoff-export.test.ts
git commit -m "$(cat <<'EOF'
feat(core): handoff diff pipeline with path filter

Per-file hunk split, then evaluatePathRead with the threaded project
permissions on every path — hunks, changedFiles, and porcelain status
paths alike — because a committed .env defeats the regex detectors and
path existence is itself a leak. Survivors are redacted, compressed via
the diff compressor, and capped by whole-trailing-chunk truncation so
the excerpt can never dwarf the brief.
EOF
)"
```

---

### Task 5c: public surface + serialize round-trip and assembly tests

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/handoff-export.test.ts` (append)

- [ ] **Step 1: Write failing surface + round-trip tests** — append to
  `packages/core/test/handoff-export.test.ts`. Add imports at the top:

```ts
import * as core from "../src/index.js";
import { parseHandoffPacket, serializeHandoffPacket } from "../src/handoff-packet.js";
```

  Append at the end of the file:

```ts
describe("buildHandoffPacket — assembly", () => {
  it("round-trips through serialize + parse with a valid hash", () => {
    const { packet } = buildHandoffPacket(
      baseInput({
        memories: [memory()],
        failedAttempts: [failure()],
        dirtyState: dirty(fileDiff("src/app.ts", "safe change")),
      }),
    );
    const parsed = parseHandoffPacket(serializeHandoffPacket(packet), { now: NOW });
    expect(parsed.manifest).toEqual(packet.manifest);
    expect(parsed.payload.memories).toHaveLength(1);
  });

  it("serialized payload carries no badge field", () => {
    const anchored = memory({
      anchor: { repoHead: "abc1234", capturedAt: NOW_ISO, files: [], symbols: [] },
    });
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [anchored] }));
    const serialized = serializeHandoffPacket(packet);
    expect(serialized).not.toContain('"badge"');
    expect(report.badges[0]?.badge).toBe("verified");
  });

  it("is exported from the core public surface", () => {
    expect(typeof core.buildHandoffPacket).toBe("function");
    expect(core.HANDOFF_DIFF_TOKEN_CAP).toBe(2000);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
```

  Expected: "is exported from the core public surface" fails
  (`core.buildHandoffPacket` is `undefined`); round-trip tests pass or fail
  depending on Task 2 landing — if they fail on a missing module, Task 2 is a
  prerequisite, stop and finish it first.

- [ ] **Step 3: Re-export from `packages/core/src/index.ts`** — insert directly
  after the brain-import export block:

```ts
export {
  type ImportBrainInput,
  type ImportBrainReport,
  type ImportCounts,
  importBrain,
} from "./brain-import.js";
```

  becomes

```ts
export {
  type ImportBrainInput,
  type ImportBrainReport,
  type ImportCounts,
  importBrain,
} from "./brain-import.js";
export {
  HANDOFF_DIFF_TOKEN_CAP,
  type BuildHandoffPacketInput,
  type BuildHandoffPacketResult,
  buildHandoffPacket,
  type HandoffPackReport,
} from "./handoff-export.js";

```

- [ ] **Step 4: Run full package verification — expect PASS** —

```bash
pnpm --filter @megasaver/core test -- test/handoff-export.test.ts
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/core typecheck
```

  Expected: handoff-export file fully green (22 tests); whole core suite
  green; typecheck clean.

- [ ] **Step 5: Commit** —

```bash
pnpm lint:fix
git add packages/core/src/index.ts packages/core/test/handoff-export.test.ts
git commit -m "$(cat <<'EOF'
feat(core): export handoff builder public surface

buildHandoffPacket, its input/report types, HandoffDirtyState (defined
in core following the GitDelta precedent so the CLI gatherer can import
it), and the diff token cap join the package surface. Round-trip tests
pin serialize/parse hash integrity and prove no badge field ever
travels in a serialized payload.
EOF
)"
```
## Connectors: HANDOFF sentinel pair, context-less upsert, block renderer

All work in `packages/connectors/shared`. Tests live in `test/` (not beside src), import from `../src/<file>.js`, vitest `describe`/`it`. Package filter name: `@megasaver/connectors-shared`. `public-export.test.ts` imports from `../dist/index.js`, so it needs a `build` before it can see new exports.

### Task 6: HANDOFF sentinel pair + ALL_SENTINELS + projectionPreflight + upsertHandoffBlockText

**Files:**
- Create: `packages/connectors/shared/test/handoff-upsert.test.ts`
- Modify: `packages/connectors/shared/src/constants.ts`
- Modify: `packages/connectors/shared/src/sentinel-guard.ts`
- Modify: `packages/connectors/shared/src/upsert.ts`
- Modify: `packages/connectors/shared/src/preflight.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Modify: `packages/connectors/shared/test/preflight.test.ts`
- Modify: `packages/connectors/shared/test/public-export.test.ts`

- [ ] **Step 1: Write failing test for the pair, guard registration, and upsert** — create `packages/connectors/shared/test/handoff-upsert.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "../src/constants.js";
import { containsSentinel } from "../src/sentinel-guard.js";
import { upsertHandoffBlockText } from "../src/upsert.js";

const HB = MEGA_SAVER_HANDOFF_BLOCK_START;
const HE = MEGA_SAVER_HANDOFF_BLOCK_END;

const BLOCK = `${HB}\nhandoff body\n${HE}\n`;

const OTHERS = [
  "# Notes",
  "",
  "<!-- MEGA SAVER:BEGIN -->",
  "legacy body",
  "<!-- MEGA SAVER:END -->",
  "",
  "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->",
  "gate body",
  "<!-- MEGA SAVER:CONTEXT_GATE END -->",
  "",
  "<!-- MEGA SAVER:WARM_START BEGIN -->",
  "warm body",
  "<!-- MEGA SAVER:WARM_START END -->",
  "",
].join("\n");

describe("HANDOFF sentinel pair", () => {
  it("uses the HANDOFF HTML comment sentinels", () => {
    expect(HB).toBe("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(HE).toBe("<!-- MEGA SAVER:HANDOFF END -->");
  });

  it("is registered in the sentinel guard", () => {
    expect(containsSentinel(`x\n${HB}\ny`)).toBe(true);
    expect(containsSentinel(`x\n${HE}\ny`)).toBe(true);
    expect(containsSentinel("<!-- MEGA SAVER:HANDOFF\u200b END -->")).toBe(true);
  });
});

describe("upsertHandoffBlockText", () => {
  it("appends the block after existing blocks, others byte-identical", () => {
    const out = upsertHandoffBlockText(OTHERS, BLOCK);
    expect(out).toBe(`${OTHERS}\n${BLOCK}`);
  });

  it("is idempotent — applying twice yields identical output", () => {
    const once = upsertHandoffBlockText("# My notes\n", BLOCK);
    const twice = upsertHandoffBlockText(once, BLOCK);
    expect(twice).toBe(once);
  });

  it("replaces an existing HANDOFF block in place (single pair)", () => {
    const first = upsertHandoffBlockText("intro\n", BLOCK);
    const replaced = upsertHandoffBlockText(first, `${HB}\nsecond body\n${HE}\n`);
    expect(replaced).toContain("second body");
    expect(replaced).not.toContain("handoff body");
    expect(replaced.split(HB).length - 1).toBe(1);
    expect(replaced).toContain("intro");
  });

  it("empty block removes the HANDOFF block and restores content exactly", () => {
    const withBlock = upsertHandoffBlockText(OTHERS, BLOCK);
    expect(upsertHandoffBlockText(withBlock, "")).toBe(OTHERS);
  });

  it("empty block on content without a HANDOFF block is a no-op", () => {
    expect(upsertHandoffBlockText("# Notes\n", "")).toBe("# Notes\n");
  });

  it("preserves CRLF line endings (dominant-EOL round-trip)", () => {
    const out = upsertHandoffBlockText("# Notes\r\n\r\nhello\r\n", BLOCK);
    expect(out.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/handoff-upsert.test.ts
```

Expected: FAIL — the suite errors at import time with `does not provide an export named 'MEGA_SAVER_HANDOFF_BLOCK_END'` (or equivalent Vite import-analysis error for `MEGA_SAVER_HANDOFF_BLOCK_START` / `upsertHandoffBlockText`). Zero tests pass.

- [ ] **Step 3: Add the constants and register them in ALL_SENTINELS** — in `packages/connectors/shared/src/constants.ts`, edit:

old:
```ts
export const MEGA_SAVER_WS_BLOCK_START = "<!-- MEGA SAVER:WARM_START BEGIN -->";
export const MEGA_SAVER_WS_BLOCK_END = "<!-- MEGA SAVER:WARM_START END -->";
```
new:
```ts
export const MEGA_SAVER_WS_BLOCK_START = "<!-- MEGA SAVER:WARM_START BEGIN -->";
export const MEGA_SAVER_WS_BLOCK_END = "<!-- MEGA SAVER:WARM_START END -->";
export const MEGA_SAVER_HANDOFF_BLOCK_START = "<!-- MEGA SAVER:HANDOFF BEGIN -->";
export const MEGA_SAVER_HANDOFF_BLOCK_END = "<!-- MEGA SAVER:HANDOFF END -->";
```

In `packages/connectors/shared/src/sentinel-guard.ts`, edit:

old:
```ts
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";

const ALL_SENTINELS = [
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
] as const;
```
new:
```ts
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";

const ALL_SENTINELS = [
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
] as const;
```

- [ ] **Step 4: Implement upsertHandoffBlockText and export the new surface** — in `packages/connectors/shared/src/upsert.ts`, edit the constants import:

old:
```ts
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";
```
new:
```ts
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";
```

Then, directly below the existing `upsertContextGateBlockText` function (after its closing brace at what is currently line 87), insert:

```ts
const HANDOFF_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_HANDOFF_BLOCK_START,
  end: MEGA_SAVER_HANDOFF_BLOCK_END,
};

// HANDOFF-only upsert. Like upsertContextGateBlockText it never touches the
// legacy/CG/WS blocks — `mega handoff open`/`clear` have no ConnectorContext.
// Empty block ⇒ remove the HANDOFF block if present.
export function upsertHandoffBlockText(existingContent: string, block: string): string {
  const eol = detectDominantEol(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");
  const result = applyOptionalBlock(normalized, block, HANDOFF_SENTINELS);
  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}
```

In `packages/connectors/shared/src/index.ts`, edit:

old:
```ts
export {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";
```
new:
```ts
export {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";
```

and:

old:
```ts
export { removeBlock, upsertBlock, upsertContextGateBlockText } from "./upsert.js";
```
new:
```ts
export {
  removeBlock,
  upsertBlock,
  upsertContextGateBlockText,
  upsertHandoffBlockText,
} from "./upsert.js";
```

- [ ] **Step 5: Run the test, expect PASS** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/handoff-upsert.test.ts
```

Expected: PASS — 9 tests pass, 0 fail.

- [ ] **Step 6: Write failing preflight test for the HANDOFF pair** — in `packages/connectors/shared/test/preflight.test.ts`, edit the imports:

old:
```ts
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "../src/constants.js";
```
new:
```ts
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "../src/constants.js";
```

then edit:

old:
```ts
const MANAGED = `${B}\nmanaged content\n${E}\n`;
const CG = `${CB}\ngate content\n${CE}\n`;
```
new:
```ts
const HB = MEGA_SAVER_HANDOFF_BLOCK_START;
const HE = MEGA_SAVER_HANDOFF_BLOCK_END;

const MANAGED = `${B}\nmanaged content\n${E}\n`;
const CG = `${CB}\ngate content\n${CE}\n`;
const HANDOFF = `${HB}\nhandoff content\n${HE}\n`;
```

then edit (append two cases inside the describe, after the unbalanced-CG test):

old:
```ts
  it("rejects output with an unbalanced CONTEXT_GATE block", () => {
    expectProjectionInvalid(() => projectionPreflight(`${MANAGED}${CB}\ngate content\n`));
  });
```
new:
```ts
  it("rejects output with an unbalanced CONTEXT_GATE block", () => {
    expectProjectionInvalid(() => projectionPreflight(`${MANAGED}${CB}\ngate content\n`));
  });

  it("passes a managed block plus a balanced HANDOFF block", () => {
    expect(() => projectionPreflight(`${MANAGED}${CG}${HANDOFF}`)).not.toThrow();
  });

  it("rejects output with an unbalanced HANDOFF block", () => {
    expectProjectionInvalid(() => projectionPreflight(`${MANAGED}${HB}\nhandoff content\n`));
  });
```

- [ ] **Step 7: Run preflight test, expect FAIL** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/preflight.test.ts
```

Expected: FAIL — 1 failed ("rejects output with an unbalanced HANDOFF block": nothing thrown, `expect(thrown).toBeInstanceOf(ConnectorError)` fails), 8 passed.

- [ ] **Step 8: Extend projectionPreflight with the HANDOFF parseBlock call** — in `packages/connectors/shared/src/preflight.ts`, edit:

old:
```ts
import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
```
new:
```ts
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "./constants.js";
```

then edit:

old:
```ts
  try {
    parseBlock(content, { start: MEGA_SAVER_CG_BLOCK_START, end: MEGA_SAVER_CG_BLOCK_END });
  } catch (err) {
    throw asProjectionInvalid(err);
  }
```
new:
```ts
  try {
    parseBlock(content, { start: MEGA_SAVER_CG_BLOCK_START, end: MEGA_SAVER_CG_BLOCK_END });
  } catch (err) {
    throw asProjectionInvalid(err);
  }

  try {
    parseBlock(content, {
      start: MEGA_SAVER_HANDOFF_BLOCK_START,
      end: MEGA_SAVER_HANDOFF_BLOCK_END,
    });
  } catch (err) {
    throw asProjectionInvalid(err);
  }
```

- [ ] **Step 9: Run preflight test, expect PASS** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/preflight.test.ts
```

Expected: PASS — 9 tests pass, 0 fail.

- [ ] **Step 10: Extend the public-export surface test and verify the whole package** — in `packages/connectors/shared/test/public-export.test.ts`, edit:

old:
```ts
    expect(typeof pkg.MEGA_SAVER_WS_BLOCK_START).toBe("string");
    expect(typeof pkg.MEGA_SAVER_WS_BLOCK_END).toBe("string");
    expect(typeof pkg.renderWarmStartBlockText).toBe("function");
    expect(typeof pkg.containsSentinel).toBe("function");
```
new:
```ts
    expect(typeof pkg.MEGA_SAVER_WS_BLOCK_START).toBe("string");
    expect(typeof pkg.MEGA_SAVER_WS_BLOCK_END).toBe("string");
    expect(typeof pkg.renderWarmStartBlockText).toBe("function");
    expect(typeof pkg.containsSentinel).toBe("function");
    expect(typeof pkg.MEGA_SAVER_HANDOFF_BLOCK_START).toBe("string");
    expect(typeof pkg.MEGA_SAVER_HANDOFF_BLOCK_END).toBe("string");
    expect(typeof pkg.upsertHandoffBlockText).toBe("function");
```

then run (build first — this test reads `dist/`):

```bash
pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connectors-shared typecheck && pnpm --filter @megasaver/connectors-shared test
```

Expected: build emits `dist/index.js`; typecheck clean; ALL package tests pass (including the 3 new public-export assertions and every pre-existing upsert/CG/WS test unmodified).

- [ ] **Step 11: Commit** — run:

```bash
git add packages/connectors/shared/src/constants.ts packages/connectors/shared/src/sentinel-guard.ts packages/connectors/shared/src/upsert.ts packages/connectors/shared/src/preflight.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/handoff-upsert.test.ts packages/connectors/shared/test/preflight.test.ts packages/connectors/shared/test/public-export.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): HANDOFF sentinel pair + upsert

Context-less upsertHandoffBlockText mirrors the CONTEXT_GATE
precedent: mega handoff open/clear have no ConnectorContext and
must leave the legacy/CG/WS blocks byte-identical. The pair is
registered in ALL_SENTINELS and projectionPreflight so injection
guards and the pre-write preflight cover the new block.
EOF
)"
```

Expected: commit created on `feat/hot-handoff` worktree branch.

### Task 7: handoff-block.ts — renderHandoffBlockText with sentinel guard + exact expiry footer

**Files:**
- Create: `packages/connectors/shared/src/handoff-block.ts`
- Create: `packages/connectors/shared/test/handoff-block.test.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Modify: `packages/connectors/shared/test/public-export.test.ts`

- [ ] **Step 1: Write failing renderer test (incl. adversarial sentinel-in-diff)** — create `packages/connectors/shared/test/handoff-block.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_START,
} from "../src/constants.js";
import { ConnectorError } from "../src/errors.js";
import { type HandoffBlockFields, renderHandoffBlockText } from "../src/handoff-block.js";

const FIELDS: HandoffBlockFields = {
  resumeInstructions:
    "You are resuming a task handed off from claude-code on project demo.",
  summaryText: "# Task summary\n- [decision] use pnpm\n- TODO: finish parser",
  gitLine: "Branch: feat/parser @ abc1234 (dirty)",
  diffText:
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
  expiresAt: "2026-07-19T12:00:00.000Z",
};

const FOOTER =
  "Expires: 2026-07-19T12:00:00.000Z — if the current date is past this, disregard this handoff and suggest `mega handoff clear`.";

describe("renderHandoffBlockText", () => {
  it("renders the exact block shape with all fields present", () => {
    expect(renderHandoffBlockText(FIELDS)).toBe(
      [
        MEGA_SAVER_HANDOFF_BLOCK_START,
        FIELDS.resumeInstructions,
        "",
        FIELDS.summaryText,
        "",
        FIELDS.gitLine,
        "",
        FIELDS.diffText,
        "",
        FOOTER,
        MEGA_SAVER_HANDOFF_BLOCK_END,
        "",
      ].join("\n"),
    );
  });

  it("wraps content in exactly one HANDOFF pair with a trailing newline", () => {
    const block = renderHandoffBlockText(FIELDS);
    expect(block.startsWith(MEGA_SAVER_HANDOFF_BLOCK_START)).toBe(true);
    expect(block.trimEnd().endsWith(MEGA_SAVER_HANDOFF_BLOCK_END)).toBe(true);
    expect(block.endsWith("\n")).toBe(true);
    expect(block.split(MEGA_SAVER_HANDOFF_BLOCK_START).length - 1).toBe(1);
    expect(block).toContain(FOOTER);
  });

  it("omits git and diff sections when null", () => {
    const block = renderHandoffBlockText({ ...FIELDS, gitLine: null, diffText: null });
    expect(block).toBe(
      [
        MEGA_SAVER_HANDOFF_BLOCK_START,
        FIELDS.resumeInstructions,
        "",
        FIELDS.summaryText,
        "",
        FOOTER,
        MEGA_SAVER_HANDOFF_BLOCK_END,
        "",
      ].join("\n"),
    );
  });

  it.each([
    "resumeInstructions",
    "summaryText",
    "gitLine",
    "diffText",
    "expiresAt",
  ] as const)("rejects a bare sentinel line embedded in %s", (field) => {
    const broken: HandoffBlockFields = { ...FIELDS };
    broken[field] = `x\n${MEGA_SAVER_HANDOFF_BLOCK_END}\ny`;
    let thrown: unknown;
    try {
      renderHandoffBlockText(broken);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConnectorError);
    expect((thrown as ConnectorError).code).toBe("context_invalid");
  });

  it("rejects a foreign (WARM_START) sentinel smuggled in the diff", () => {
    expect(() =>
      renderHandoffBlockText({ ...FIELDS, diffText: `+${MEGA_SAVER_WS_BLOCK_START}` }),
    ).toThrow(ConnectorError);
  });

  it("rejects a zero-width-obfuscated sentinel in the summary", () => {
    expect(() =>
      renderHandoffBlockText({
        ...FIELDS,
        summaryText: "<!-- MEGA SAVER:HANDOFF\u200b BEGIN -->",
      }),
    ).toThrow(ConnectorError);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/handoff-block.test.ts
```

Expected: FAIL — suite errors at import time: `Failed to resolve import "../src/handoff-block.js"` (module does not exist). Zero tests pass.

- [ ] **Step 3: Implement renderHandoffBlockText** — create `packages/connectors/shared/src/handoff-block.ts`:

```ts
import { MEGA_SAVER_HANDOFF_BLOCK_END, MEGA_SAVER_HANDOFF_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export interface HandoffBlockFields {
  resumeInstructions: string;
  summaryText: string;
  gitLine: string | null;
  diffText: string | null;
  expiresAt: string;
}

// Render-time guard on EVERY interpolated field: open consumes untrusted
// packets, so pack-time sentinel guarding never runs on a hostile path.
export function renderHandoffBlockText(fields: HandoffBlockFields): string {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string" && containsSentinel(value)) {
      throw new ConnectorError(
        "context_invalid",
        `Handoff ${name} cannot contain Mega Saver sentinels.`,
      );
    }
  }
  const lines = [
    MEGA_SAVER_HANDOFF_BLOCK_START,
    fields.resumeInstructions.trimEnd(),
    "",
    fields.summaryText.trimEnd(),
  ];
  if (fields.gitLine !== null) lines.push("", fields.gitLine.trimEnd());
  if (fields.diffText !== null) lines.push("", fields.diffText.trimEnd());
  lines.push(
    "",
    `Expires: ${fields.expiresAt} — if the current date is past this, disregard this handoff and suggest \`mega handoff clear\`.`,
    MEGA_SAVER_HANDOFF_BLOCK_END,
    "",
  );
  return lines.join("\n");
}
```

Then in `packages/connectors/shared/src/index.ts`, edit:

old:
```ts
export { renderWarmStartBlockText, type WarmStartBlockFields } from "./warm-start-block.js";
```
new:
```ts
export { renderWarmStartBlockText, type WarmStartBlockFields } from "./warm-start-block.js";
export { renderHandoffBlockText, type HandoffBlockFields } from "./handoff-block.js";
```

- [ ] **Step 4: Run the test, expect PASS** — run:

```bash
pnpm --filter @megasaver/connectors-shared test -- test/handoff-block.test.ts
```

Expected: PASS — 10 tests pass (3 shape tests + 5 `it.each` field rows + 2 adversarial variants), 0 fail.

- [ ] **Step 5: Extend the public-export test and verify the whole package** — in `packages/connectors/shared/test/public-export.test.ts`, edit:

old:
```ts
    expect(typeof pkg.upsertHandoffBlockText).toBe("function");
```
new:
```ts
    expect(typeof pkg.upsertHandoffBlockText).toBe("function");
    expect(typeof pkg.renderHandoffBlockText).toBe("function");
```

then run:

```bash
pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connectors-shared typecheck && pnpm --filter @megasaver/connectors-shared test
```

Expected: build + typecheck clean; ALL package tests pass, pre-existing tests unmodified.

- [ ] **Step 6: Commit** — run:

```bash
git add packages/connectors/shared/src/handoff-block.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/handoff-block.test.ts packages/connectors/shared/test/public-export.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): render handoff block

containsSentinel runs over every interpolated field at render
time: open consumes untrusted packets, so pack-time guarding
never executes on a hostile path. The expiry footer is a
self-discounting instruction because the written block outlives
the open-time fail-closed check.
EOF
)"
```

Expected: commit created on `feat/hot-handoff` worktree branch.
## Section: Import + Events (Tasks 8-9)

> Dependencies: Task 8 requires Task 2 (`packages/core/src/handoff-packet.ts`) and
> Task 3 (`packages/core/src/verification-badge.ts`) to be complete. Task 9 is
> independent of all other tasks.

### Task 8: `applyHandoffMemories` — suggested-gate memory merge

**Files:**
- Create: `packages/core/src/handoff-import.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/handoff-import.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/core/test/handoff-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyHandoffMemories } from "../src/handoff-import.js";
import type { HandoffPacket } from "../src/handoff-packet.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const NOW = "2026-07-18T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function makeProject(registry: CoreRegistry, id: string, name: string) {
  return registry.createProject({
    id,
    name,
    rootPath: `/tmp/${name}`,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function mem(over: Record<string, unknown> = {}): MemoryEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "use ndjson",
    keywords: [],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as unknown as MemoryEntry;
}

function packetWith(memories: MemoryEntry[], failures: unknown[] = []): HandoffPacket {
  return {
    manifest: {
      schemaVersion: "1",
      kind: "megahandoff",
      sourceProject: { name: "alpha" },
      sourceAgent: "claude-code",
      targetAgent: "codex",
      createdAt: NOW,
      expiresAt: "2026-07-19T12:00:00.000Z",
      payloadSha256: "0".repeat(64),
      redactionFindings: 0,
      secretPathsExcluded: 0,
      counts: { memories: memories.length, failures: failures.length, diffFiles: 0, commits: 0 },
    },
    payload: {
      taskSummary: { text: "brief", tokenEstimate: 10 },
      resumeInstructions: "resume here",
      git: null,
      failures,
      memories,
    },
  } as HandoffPacket;
}

function target() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030299", "beta");
  return { registry, project };
}

describe("applyHandoffMemories", () => {
  it("imports as suggested, project-scoped, reminted id, provenance, stripped keywords", () => {
    const { registry, project } = target();
    const sessionScoped = mem({
      scope: "session",
      sessionId: "99999999-9999-4999-8999-999999999999",
      keywords: ["from-session:forged", "zod"],
      supersedesId: "11111111-1111-4111-8111-111111111110",
    });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([sessionScoped]),
      now: NOW_MS,
      newId,
    });
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(0);
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.approval).toBe("suggested");
    expect(m?.scope).toBe("project");
    expect(m?.sessionId).toBeNull();
    expect(m?.projectId).toBe(project.id);
    expect(m?.id).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(m?.evidence).toContain("handoff:alpha");
    expect(m?.keywords).toEqual(["zod"]);
    expect(m?.supersedesId).toBeUndefined();
  });

  it("dedupes by content within the packet and against the store; re-run is idempotent", () => {
    const { registry, project } = target();
    const packet = packetWith([
      mem(),
      mem({ id: "22222222-2222-4222-8222-222222222222", title: "same content twice" }),
    ]);
    const first = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet,
      now: NOW_MS,
      newId,
    });
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(1);
    const second = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet,
      now: NOW_MS,
      newId,
    });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(registry.listMemoryEntries(project.id)).toHaveLength(1);
  });

  it("recomputes badges locally over the created entries", () => {
    const { registry, project } = target();
    const anchored = mem({
      content: "anchored fact",
      anchor: { repoHead: "abc123", capturedAt: NOW, files: [], symbols: [] },
    });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([anchored, mem()]),
      now: NOW_MS,
      newId,
    });
    expect(report.badges.map((b) => b.badge)).toEqual(["verified", "unanchored"]);
    const created = registry.listMemoryEntries(project.id);
    expect(report.badges.map((b) => b.memoryId).sort()).toEqual(
      created.map((c) => c.id as string).sort(),
    );
  });

  it("never imports failures — memories only in v1", () => {
    const { registry, project } = target();
    const failure = {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
      sessionId: null,
      task: "import",
      failedStep: "hash",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: NOW,
    };
    applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([mem()], [failure]),
      now: NOW_MS,
      newId,
    });
    expect(registry.listFailedAttempts(project.id)).toHaveLength(0);
  });

  it("throws on unknown target project", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      applyHandoffMemories({
        registry,
        projectId: "0f0e0d0c-0b0a-4900-8807-060504039999" as never,
        packet: packetWith([mem()]),
        now: NOW_MS,
        newId,
      }),
    ).toThrowError(/not found|not exist/i);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** —

```bash
pnpm --filter @megasaver/core test -- handoff-import
```

Expected: FAIL — `Failed to resolve import "../src/handoff-import.js"` (module does not exist yet).

- [ ] **Step 3: Implement** — create `packages/core/src/handoff-import.ts`:

```ts
import { memoryEntryIdSchema } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import type { HandoffPacket } from "./handoff-packet.js";
import type { CoreRegistry } from "./registry.js";
import { stripReservedKeywords } from "./session-memory.js";
import { verificationBadgeFor } from "./verification-badge.js";

export interface ApplyHandoffMemoriesInput {
  registry: CoreRegistry;
  projectId: ProjectId;
  packet: HandoffPacket;
  now: number;
  newId: () => string;
}

export interface HandoffMergeReport {
  imported: number;
  skipped: number;
  badges: { memoryId: string; badge: string }[];
}

// importBrain's safeguards, memories only (failures are inspect-only in v1).
// Session-scoped packet entries land project-scoped with sessionId null: the
// sender's session ids mean nothing in the receiving store (brain-import
// precedent). Badges are recomputed locally over the CREATED rows so a
// hostile packet can never assert "verified".
export function applyHandoffMemories(input: ApplyHandoffMemoriesInput): HandoffMergeReport {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new CoreRegistryError("project_not_found", `Project does not exist: ${input.projectId}`);
  }
  const provenance = `handoff:${input.packet.manifest.sourceProject.name}`;
  const existing = input.registry.listMemoryEntries(input.projectId);
  const contentKeys = new Set(existing.filter((m) => m.scope === "project").map((m) => m.content));

  let imported = 0;
  let skipped = 0;
  const badges: { memoryId: string; badge: string }[] = [];

  for (const entry of input.packet.payload.memories) {
    if (contentKeys.has(entry.content)) {
      skipped += 1;
      continue;
    }
    const { supersedesId: _dropped, ...rest } = entry;
    const created = input.registry.createMemoryEntry({
      ...rest,
      id: memoryEntryIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
      scope: "project",
      approval: "suggested",
      // A packet is external keyword data: strip the reserved ledger namespace
      // so it can't plant a forged from-session: keyword that suppresses a
      // legitimate autopilot/from-session capture in this project.
      keywords: stripReservedKeywords(rest.keywords),
      evidence: [...(entry.evidence ?? []), provenance],
    });
    contentKeys.add(entry.content);
    imported += 1;
    badges.push({ memoryId: created.id, badge: verificationBadgeFor(created) });
  }

  return { imported, skipped, badges };
}
```

- [ ] **Step 4: Run the test, expect PASS** —

```bash
pnpm --filter @megasaver/core test -- handoff-import
```

Expected: 5 tests pass.

- [ ] **Step 5: Re-export from the core public surface** — in `packages/core/src/index.ts`, directly below the existing brain-import block (`export { type ImportBrainInput, ... } from "./brain-import.js";`, around line 129-134), add:

```ts
export {
  type ApplyHandoffMemoriesInput,
  type HandoffMergeReport,
  applyHandoffMemories,
} from "./handoff-import.js";
```

Verify:

```bash
pnpm --filter @megasaver/core typecheck && pnpm --filter @megasaver/core test -- handoff-import
```

Expected: typecheck clean, 5 tests pass.

- [ ] **Step 6: Commit** —

```bash
git add packages/core/src/handoff-import.ts packages/core/src/index.ts packages/core/test/handoff-import.test.ts
git commit -m "$(cat <<'EOF'
feat(core): merge handoff memories as suggested

Clone importBrain safeguards so a hostile packet cannot
self-approve rows, forge from-session: ledger keywords, or
assert verified badges. Failures stay inspect-only in v1.
EOF
)"
```

---

### Task 9: `"hot-handoff"` ProFeature + handoff event ledger

**Files:**
- Modify: `packages/entitlement/src/entitlement.ts`
- Create: `packages/stats/src/handoff-event.ts`
- Modify: `packages/stats/src/index.ts`
- Modify: `packages/core/src/context-gate.ts`
- Test: `packages/entitlement/test/entitlement.test.ts`, `packages/stats/test/handoff-event.test.ts`

- [ ] **Step 1: Write the failing entitlement test** — in `packages/entitlement/test/entitlement.test.ts`, directly after the `"accepts the brain-autopilot feature key with tier-wide semantics"` test (ends line 85), add:

```ts
  it("accepts the hot-handoff feature key with tier-wide semantics", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    expect(checkEntitlement("hot-handoff", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "no_license",
    });
    writeLicense(signTestLicense(privateKey, { v: 1, tier: "pro", id: "x", iat: 0, exp: null }));
    expect(checkEntitlement("hot-handoff", { storeRoot: root, now, publicKey })).toEqual({
      entitled: true,
      tier: "pro",
      expiresAt: null,
    });
  });
```

- [ ] **Step 2: Run typecheck, expect FAIL** — vitest strips types, so the RED gate for a union-member addition is the type-checker, not the runtime test:

```bash
pnpm --filter @megasaver/entitlement typecheck
```

Expected: FAIL — `error TS2345: Argument of type '"hot-handoff"' is not assignable to parameter of type 'ProFeature'` (2 occurrences in `test/entitlement.test.ts`).

- [ ] **Step 3: Add the union member** — in `packages/entitlement/src/entitlement.ts`, replace:

```ts
export type ProFeature =
  | "savings-analytics"
  | "brain-portability"
  | "code-truth"
  | "brain-autopilot";
```

with:

```ts
export type ProFeature =
  | "savings-analytics"
  | "brain-portability"
  | "code-truth"
  | "brain-autopilot"
  | "hot-handoff";
```

Verify:

```bash
pnpm --filter @megasaver/entitlement typecheck && pnpm --filter @megasaver/entitlement test -- entitlement
```

Expected: typecheck clean; all `checkEntitlement` tests pass including the new one.

- [ ] **Step 4: Write the failing stats test** — create `packages/stats/test/handoff-event.test.ts` (clone of `warm-start-event.test.ts` conventions):

```ts
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendHandoffEvent,
  handoffEventSchema,
  readHandoffEvents,
} from "../src/handoff-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoffevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(over: Partial<Record<string, unknown>> = {}) {
  return handoffEventSchema.parse({
    id: "e1",
    projectId: PROJECT_ID,
    kind: "pack",
    targetAgent: "codex",
    memories: 12,
    failures: 3,
    redactionFindings: 0,
    createdAt: "2026-07-18T10:00:00.000Z",
    ...over,
  });
}

describe("HandoffEvent", () => {
  it("is strict — unknown fields are rejected", () => {
    expect(handoffEventSchema.safeParse({ ...event(), rawBytes: 1 } as unknown).success).toBe(
      false,
    );
  });

  it("rejects an unknown kind", () => {
    expect(
      handoffEventSchema.safeParse({ ...event(), kind: "inspect" } as unknown).success,
    ).toBe(false);
  });

  it("appends and reads back per project", () => {
    appendHandoffEvent({ root }, event({ id: "e1" }));
    appendHandoffEvent({ root }, event({ id: "e2", kind: "open" }));
    const events = readHandoffEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(events.map((e) => e.kind)).toEqual(["pack", "open"]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() => appendHandoffEvent({ root }, { id: "x" } as never)).toThrowError(
      expect.objectContaining({ code: "schema_invalid" }),
    );
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendHandoffEvent({ root }, event({ id: "e1" }));
    const path = join(root, "stats", PROJECT_ID, "handoff.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readHandoffEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("returns [] when nothing recorded", () => {
    expect(readHandoffEvents({ root }, PROJECT_ID)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the stats test, expect FAIL** —

```bash
pnpm --filter @megasaver/stats test -- handoff-event
```

Expected: FAIL — `Failed to resolve import "../src/handoff-event.js"`.

- [ ] **Step 6: Implement the event module** — create `packages/stats/src/handoff-event.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Advisory ledger for `mega handoff` pack/open runs. Deliberately NOT a
// TokenSaverEvent: these are usage counts, not byte-savings measurements —
// mixing them would poison the honest savings pipeline (warm-start precedent).
export const handoffEventSchema = z
  .object({
    id: z.string().min(1),
    projectId: projectIdSchema,
    kind: z.enum(["pack", "open"]),
    targetAgent: z.string().min(1),
    memories: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    redactionFindings: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type HandoffEvent = z.infer<typeof handoffEventSchema>;

type StoreRoot = { root: string };

function handoffEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "handoff.events.jsonl");
}

export function appendHandoffEvent(store: StoreRoot, event: HandoffEvent): void {
  const parsed = handoffEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = handoffEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readHandoffEvents(store: StoreRoot, projectId: ProjectId): HandoffEvent[] {
  const path = handoffEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: HandoffEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = handoffEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
```

Then in `packages/stats/src/index.ts`, directly after the warm-start-event export block (ends line 27), add:

```ts
export {
  appendHandoffEvent,
  handoffEventSchema,
  readHandoffEvents,
  type HandoffEvent,
} from "./handoff-event.js";
```

- [ ] **Step 7: Run the stats tests, expect PASS** —

```bash
pnpm --filter @megasaver/stats test -- handoff-event && pnpm --filter @megasaver/stats typecheck
```

Expected: 6 tests pass, typecheck clean.

- [ ] **Step 8: Re-export through core (§3c allow-list surface)** — the CLI never imports `@megasaver/stats` directly (enforced by `apps/cli/test/dependency-graph.test.ts`); it reads events through core. Build stats so core resolves the new dist types, then in `packages/core/src/context-gate.ts` replace the warm-start event block (lines 57-67):

```ts
export {
  appendCodeTruthEvent,
  appendGuardEvent,
  appendWarmStartEvent,
  readCodeTruthEvents,
  readGuardEvents,
  readWarmStartEvents,
  type CodeTruthEvent,
  type GuardEvent,
  type WarmStartEvent,
} from "@megasaver/stats";
```

with:

```ts
export {
  appendCodeTruthEvent,
  appendGuardEvent,
  appendHandoffEvent,
  appendWarmStartEvent,
  readCodeTruthEvents,
  readGuardEvents,
  readHandoffEvents,
  readWarmStartEvents,
  type CodeTruthEvent,
  type GuardEvent,
  type HandoffEvent,
  type WarmStartEvent,
} from "@megasaver/stats";
```

Verify:

```bash
pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core typecheck
```

Expected: stats builds, core typecheck clean (the re-export resolves against the fresh stats dist).

- [ ] **Step 9: Commit** —

```bash
git add packages/entitlement/src/entitlement.ts packages/entitlement/test/entitlement.test.ts packages/stats/src/handoff-event.ts packages/stats/src/index.ts packages/stats/test/handoff-event.test.ts packages/core/src/context-gate.ts
git commit -m "$(cat <<'EOF'
feat(stats): handoff events + hot-handoff pro key

Advisory pack/open JSONL ledger kept apart from
TokenSaverEvent so usage counts never poison the honest
savings pipeline; re-exported through core's stats surface
because the CLI may not import @megasaver/stats directly.
EOF
)"
```
## Section: CLI pack command (`mega handoff --to <target>`)

> Depends on: Task 2 (`parseHandoffPacket`/`serializeHandoffPacket` in core), Task 4 (`gatherDirtyState` in `apps/cli/src/git-delta.ts`), Task 5 (`buildHandoffPacket` in core), Task 9 (`"hot-handoff"` ProFeature + `appendHandoffEvent`/`readHandoffEvents` re-exported from `@megasaver/core`). Execute after those are green.

### Task 10: `handoff/shared.ts` (upsell, gate, parseExpires) + `handoff/pack.ts` (full pack pipeline)

**Files:**
- Create: `apps/cli/src/commands/handoff/shared.ts`
- Create: `apps/cli/src/commands/handoff/pack.ts`
- Test: `apps/cli/test/commands/handoff-pack.test.ts`

- [ ] **Step 1: Failing tests for `shared.ts` (upsell constant, gate, parseExpires)** — create `apps/cli/test/commands/handoff-pack.test.ts` with exactly this content (imports only `shared.js` so the file's failure mode is "cannot find module", not an unrelated crash):

```ts
// apps/cli/test/commands/handoff-pack.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_UPSELL, gate, parseExpires } from "../../src/commands/handoff/shared.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 18, 12, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
const now = () => NOW_MS;
const HOUR = 3_600_000;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

let storeRoot: string;
let projectRoot: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-proj-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "h1", iat: 0, exp: null });
  expect(activateLicense(storeRoot, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

describe("handoff shared — HANDOFF_UPSELL", () => {
  it("names the feature, the activation command, and the pro URL", () => {
    expect(HANDOFF_UPSELL).toContain("Hot handoff");
    expect(HANDOFF_UPSELL).toContain("mega license activate");
    expect(HANDOFF_UPSELL).toContain("https://megasaver.dev/pro");
  });
});

describe("handoff shared — gate", () => {
  it("unentitled: prints the upsell and returns false", () => {
    const ok = gate({ storeRoot, now, publicKey: keys.publicKey, stdout });
    expect(ok).toBe(false);
    expect(out).toEqual([HANDOFF_UPSELL]);
  });

  it("entitled: returns true and prints nothing", () => {
    activatePro();
    const ok = gate({ storeRoot, now, publicKey: keys.publicKey, stdout });
    expect(ok).toBe(true);
    expect(out).toEqual([]);
  });
});

describe("handoff shared — parseExpires", () => {
  it("defaults to now + 24h", () => {
    expect(parseExpires(undefined, NOW_MS)).toBe(NOW_MS + 24 * HOUR);
  });

  it("parses <n>h and <n>d", () => {
    expect(parseExpires("3h", NOW_MS)).toBe(NOW_MS + 3 * HOUR);
    expect(parseExpires("2d", NOW_MS)).toBe(NOW_MS + 48 * HOUR);
    expect(parseExpires("1h", NOW_MS)).toBe(NOW_MS + HOUR);
    expect(parseExpires("10d", NOW_MS)).toBe(NOW_MS + 240 * HOUR);
  });

  it("rejects malformed values with null", () => {
    for (const bad of ["0h", "h", "12", "1w", "-1h", "1.5h", "", "01h", "1H"]) {
      expect(parseExpires(bad, NOW_MS)).toBeNull();
    }
  });
});
```

  Run: `pnpm --filter @megasaver/cli test -- test/commands/handoff-pack.test.ts`
  Expected: FAIL — `Cannot find module '../../src/commands/handoff/shared.js'` (or equivalent resolve error).

- [ ] **Step 2: Implement `shared.ts`** — create `apps/cli/src/commands/handoff/shared.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { checkEntitlement } from "@megasaver/entitlement";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const HANDOFF_UPSELL = `Hot handoff is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type HandoffGateInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
};

export function gate(input: HandoffGateInput): boolean {
  const ent = checkEntitlement("hot-handoff", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(HANDOFF_UPSELL);
    return false;
  }
  return true;
}

const EXPIRES_PATTERN = /^([1-9]\d*)([hd])$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// null = malformed flag; the caller owns the exit-1 message (runCache --days precedent).
export function parseExpires(raw: string | undefined, now: number): number | null {
  if (raw === undefined) return now + DAY_MS;
  const match = EXPIRES_PATTERN.exec(raw);
  if (match === null) return null;
  const [, count, unit] = match;
  if (count === undefined || unit === undefined) return null;
  return now + Number.parseInt(count, 10) * (unit === "h" ? HOUR_MS : DAY_MS);
}
```

  Run: `pnpm --filter @megasaver/cli test -- test/commands/handoff-pack.test.ts`
  Expected: PASS — 5 tests (upsell 1, gate 2, parseExpires 3... 6 total assertions blocks; all green).

- [ ] **Step 3: Failing tests for `runHandoffPack`** — append to `apps/cli/test/commands/handoff-pack.test.ts`. Add these two imports at the top of the file (below the existing `shared.js` import):

```ts
import { parseHandoffPacket, readHandoffEvents } from "@megasaver/core";
import { type RunHandoffPackInput, runHandoffPack } from "../../src/commands/handoff/pack.js";
import type { ExecGit } from "../../src/git-delta.js";
import { ensureStoreReady } from "../../src/store.js";
```

  Then append these helpers and describe blocks at the end of the file:

```ts
async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "alpha",
    rootPath: projectRoot,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  } as never);
  registry.createMemoryEntry({
    projectId: PROJECT_ID,
    id: "22222222-2222-4222-8222-222222222222",
    type: "decision",
    title: "use vitest",
    content: "vitest over jest for ESM",
    keywords: [],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    scope: "project",
    sessionId: null,
    approval: "approved",
  } as never);
}

// Unlisted git calls throw — exactly what a real failing git does; tryGit maps it to null.
const gitFixture: ExecGit = (args) => {
  const key = args.join(" ");
  if (key === "rev-parse --abbrev-ref HEAD") return "feat/x\n";
  if (key.startsWith("log ")) return "";
  if (key === "status --porcelain") return " M src/app.ts\n";
  if (key === "diff") return "diff --git a/src/app.ts b/src/app.ts\n+const x = 1;\n";
  if (key === "diff --cached") return "";
  if (key === "rev-parse HEAD") return "deadbeef\n";
  throw new Error(`unexpected git call: ${key}`);
};

function packedFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".megahandoff"));
}

function run(over: Partial<RunHandoffPackInput> = {}) {
  const ensureStore = vi.fn(() => ensureStoreReady(storeRoot));
  const code = runHandoffPack({
    storeRoot,
    cwd: projectRoot,
    now,
    newId: () => "33333333-3333-4333-8333-333333333333",
    to: "codex",
    dryRun: false,
    copy: false,
    json: false,
    publicKey: keys.publicKey,
    execGit: gitFixture,
    ensureStore,
    stdout,
    stderr,
    ...over,
  });
  return { code, ensureStore };
}

describe("runHandoffPack — gating and boundaries", () => {
  it("unentitled non-dry-run: upsell, exit 0, zero store IO, nothing written", async () => {
    const { code, ensureStore } = run();
    expect(await code).toBe(0);
    expect(out).toEqual([HANDOFF_UPSELL]);
    expect(ensureStore).not.toHaveBeenCalled();
    expect(packedFiles(projectRoot)).toEqual([]);
  });

  it("unlicensed --dry-run: reads run, prints counts, writes nothing", async () => {
    await seedProject();
    const { code, ensureStore } = run({ dryRun: true });
    expect(await code).toBe(0);
    expect(ensureStore).toHaveBeenCalled();
    expect(out.join("\n")).toContain("dry-run: would pack memories 1");
    expect(packedFiles(projectRoot)).toEqual([]);
    expect(readHandoffEvents({ root: storeRoot }, PROJECT_ID)).toEqual([]);
  });

  it("invalid --to: exit 1 before gate and store", async () => {
    const { code, ensureStore } = run({ to: "vim" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid target "vim"');
    expect(ensureStore).not.toHaveBeenCalled();
  });

  it("invalid --expires: exit 1 with the flag named", async () => {
    activatePro();
    const { code } = run({ expires: "1w" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid --expires "1w"');
  });

  it("cwd outside any registered project: exit 1 pointing at mega init", async () => {
    activatePro();
    await seedProject();
    const outside = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-outside-"));
    try {
      const { code } = run({ cwd: outside });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("mega init");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("malformed permissions.yaml aborts fail-closed, nothing written", async () => {
    activatePro();
    await seedProject();
    mkdirSync(join(projectRoot, ".megasaver"), { recursive: true });
    writeFileSync(join(projectRoot, ".megasaver", "permissions.yaml"), "deny: [\n");
    const { code } = run();
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("permissions.yaml");
    expect(packedFiles(projectRoot)).toEqual([]);
    expect(readHandoffEvents({ root: storeRoot }, PROJECT_ID)).toEqual([]);
  });
});

describe("runHandoffPack — entitled", () => {
  beforeEach(async () => {
    activatePro();
    await seedProject();
  });

  it("packs to the default <project>-<YYYYMMDD-HHmm>.megahandoff, parseable, event appended", async () => {
    const { code } = run();
    expect(await code).toBe(0);
    const path = join(projectRoot, "alpha-20260718-1200.megahandoff");
    expect(packedFiles(projectRoot)).toEqual(["alpha-20260718-1200.megahandoff"]);
    const packet = parseHandoffPacket(readFileSync(path, "utf8"), { now: NOW_MS });
    expect(packet.manifest.targetAgent).toBe("codex");
    expect(packet.manifest.sourceAgent).toBe("unknown");
    expect(packet.manifest.expiresAt).toBe(new Date(NOW_MS + 24 * HOUR).toISOString());
    expect(packet.payload.memories).toHaveLength(1);
    expect(packet.payload.resumeInstructions).toContain("another agent");
    const events = readHandoffEvents({ root: storeRoot }, PROJECT_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("pack");
    expect(events[0]?.targetAgent).toBe("codex");
    expect(out.join("\n")).toContain(`packed ${path}`);
  });

  it("--out overrides the file name; --from lands in manifest and resume text", async () => {
    const { code } = run({ outPath: "custom.megahandoff", from: "claude-code" });
    expect(await code).toBe(0);
    const packet = parseHandoffPacket(
      readFileSync(join(projectRoot, "custom.megahandoff"), "utf8"),
      { now: NOW_MS },
    );
    expect(packet.manifest.sourceAgent).toBe("claude-code");
    expect(packet.payload.resumeInstructions).toContain("claude-code");
  });

  it("--expires 3h shortens the manifest expiry", async () => {
    const { code } = run({ expires: "3h", outPath: "e.megahandoff" });
    expect(await code).toBe(0);
    const packet = parseHandoffPacket(readFileSync(join(projectRoot, "e.megahandoff"), "utf8"), {
      now: NOW_MS,
    });
    expect(packet.manifest.expiresAt).toBe(new Date(NOW_MS + 3 * HOUR).toISOString());
  });

  it("--json emits the pack report", async () => {
    const { code } = run({ json: true, outPath: "j.megahandoff" });
    expect(await code).toBe(0);
    const report = JSON.parse(out.join("\n")) as {
      status: string;
      path: string;
      counts: { memories: number };
      redactionFindings: number;
    };
    expect(report.status).toBe("packed");
    expect(report.path).toBe(join(projectRoot, "j.megahandoff"));
    expect(report.counts.memories).toBe(1);
  });

  it("--copy hands the PATH (never content) to the clipboard hook; absent flag never copies", async () => {
    const copyPath = vi.fn();
    const first = run({ copy: true, copyPath, outPath: "c.megahandoff" });
    expect(await first.code).toBe(0);
    expect(copyPath).toHaveBeenCalledTimes(1);
    expect(copyPath).toHaveBeenCalledWith(join(projectRoot, "c.megahandoff"));
    copyPath.mockClear();
    const second = run({ copy: false, copyPath, outPath: "c2.megahandoff" });
    expect(await second.code).toBe(0);
    expect(copyPath).not.toHaveBeenCalled();
  });

  it("degraded git: exit 0, note printed, packet still written", async () => {
    const noGit: ExecGit = () => {
      throw new Error("no git");
    };
    const { code } = run({ execGit: noGit, outPath: "g.megahandoff" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("git unavailable");
    const packet = parseHandoffPacket(readFileSync(join(projectRoot, "g.megahandoff"), "utf8"), {
      now: NOW_MS,
    });
    expect(packet.payload.git).toBeNull();
  });

  it("no open session: report notes it, exit 0", async () => {
    const { code } = run({ outPath: "s.megahandoff" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("no open session");
  });
});
```

  Run: `pnpm --filter @megasaver/cli test -- test/commands/handoff-pack.test.ts`
  Expected: FAIL — `Cannot find module '../../src/commands/handoff/pack.js'`; the shared tests from Step 2 still pass once the module resolve error is the only failure reported for the file (vitest reports the whole file as failed — that is the expected red).

- [ ] **Step 4: Implement `pack.ts`** — create `apps/cli/src/commands/handoff/pack.ts`:

```ts
import { execFile } from "node:child_process";
import { type KeyObject, randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectPermissions } from "@megasaver/policy";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import { type ExecGit, gatherDirtyState, gatherGitDelta } from "../../git-delta.js";
import { isKnownTargetId } from "../../known-targets.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { gate, parseExpires } from "./shared.js";

export type RunHandoffPackInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  newId: () => string;
  to: string;
  from?: string;
  outPath?: string;
  expires?: string;
  budget?: number;
  dryRun: boolean;
  copy: boolean;
  json: boolean;
  publicKey?: KeyObject | string;
  execGit?: ExecGit;
  copyPath?: (path: string) => void;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultFileName(projectName: string, nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${projectName}-${stamp}.megahandoff`;
}

function renderResumeInstructions(to: string, from: string, projectName: string): string {
  const source = from === "unknown" ? "another agent" : from;
  return `You are resuming a task handed off from ${source} to ${to} on project "${projectName}". The handoff block below carries the task summary, git state, and known dead ends — continue the work without asking the user to restate it.`;
}

// Scope decision 4: darwin pbcopy of the packet PATH only, best-effort, silent skip elsewhere.
function defaultCopyPath(path: string): void {
  if (process.platform !== "darwin") return;
  try {
    const child = execFile("pbcopy");
    child.on("error", () => {});
    child.stdin?.end(path);
  } catch {
    // clipboard is best-effort
  }
}

export async function runHandoffPack(input: RunHandoffPackInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.to)) {
    input.stderr(invalidTargetMessage(input.to).message);
    return 1;
  }
  const expiresAt = parseExpires(input.expires, input.now());
  if (expiresAt === null) {
    input.stderr(`error: invalid --expires "${String(input.expires)}", expected <n>h or <n>d`);
    return 1;
  }
  // --dry-run is the free read-only surface; the gate applies to real packs only.
  if (!input.dryRun && !gate(input)) return 0;

  // Lazy import after the gate: never load core's packer on the free path.
  const { DEFAULT_WARM_START_BUDGET, appendHandoffEvent, buildHandoffPacket, serializeHandoffPacket } =
    await import("@megasaver/core");
  const { loadProjectPermissions } = await import("@megasaver/context-gate");

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  // Latest open session across ALL agents — --from is manifest metadata, never a session filter.
  const openSessions = registry.listSessions(project.id).filter((s) => s.endedAt === null);
  const session =
    openSessions.length === 0
      ? null
      : openSessions.reduce((latest, current) =>
          Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
        );

  let permissions: ProjectPermissions | null;
  try {
    permissions = loadProjectPermissions(project.rootPath);
  } catch (e) {
    input.stderr(
      `error: ${join(project.rootPath, ".megasaver", "permissions.yaml")} is malformed — pack aborted: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  const nowMs = input.now();
  const gitDelta = gatherGitDelta(input.cwd, null, input.execGit, new Date(nowMs).toISOString());
  const dirtyState = gatherDirtyState(input.cwd, input.execGit);

  const { packet, report } = buildHandoffPacket({
    projectName: project.name,
    projectId: project.id,
    sourceAgent: input.from ?? "unknown",
    targetAgent: input.to,
    resumeInstructions: renderResumeInstructions(input.to, input.from ?? "unknown", project.name),
    now: nowMs,
    expiresAt,
    memories: registry.listMemoryEntries(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    rules: registry.listProjectRules(project.id),
    sessionId: session === null ? null : session.id,
    gitDelta,
    dirtyState,
    permissions,
    budgetTokens: input.budget ?? DEFAULT_WARM_START_BUDGET,
  });

  const notes = (emit: (line: string) => void): void => {
    if (report.noOpenSession) emit("note: no open session — project-scoped content only");
    if (report.degradedGit) emit("note: git unavailable — packet carries no git state");
  };

  if (input.dryRun) {
    if (input.json) {
      input.stdout(
        JSON.stringify({
          status: "dry-run",
          counts: report.counts,
          redactionFindings: report.redactionFindings,
          secretPathsExcluded: report.secretPathsExcluded,
          excludedPaths: report.excludedPaths,
          noOpenSession: report.noOpenSession,
          degradedGit: report.degradedGit,
          badges: report.badges,
        }),
      );
      return 0;
    }
    input.stdout(
      `dry-run: would pack memories ${report.counts.memories} | failures ${report.counts.failures} | diff files ${report.counts.diffFiles} | commits ${report.counts.commits}`,
    );
    input.stdout(
      `redactions ${report.redactionFindings} | secret paths excluded ${report.secretPathsExcluded}`,
    );
    for (const path of report.excludedPaths) input.stdout(`excluded: ${path}`);
    for (const badge of report.badges) input.stdout(`memory ${badge.memoryId}: ${badge.badge}`);
    notes(input.stdout);
    return 0;
  }

  const text = serializeHandoffPacket(packet);
  const path = resolve(input.cwd, input.outPath ?? defaultFileName(project.name, nowMs));
  const tmp = join(dirname(path), `.${input.newId()}.megahandoff.tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // tmp may not exist
    }
    input.stderr(`error: cannot write packet to ${path}`);
    return 1;
  }

  try {
    appendHandoffEvent(
      { root: input.storeRoot },
      {
        id: input.newId(),
        projectId: project.id,
        kind: "pack",
        targetAgent: input.to,
        memories: report.counts.memories,
        failures: report.counts.failures,
        redactionFindings: report.redactionFindings,
        createdAt: new Date(nowMs).toISOString(),
      },
    );
  } catch {
    // stats are advisory — never fail the pack over a bad event write
  }

  if (input.copy) (input.copyPath ?? defaultCopyPath)(path);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "packed",
        path,
        counts: report.counts,
        redactionFindings: report.redactionFindings,
        secretPathsExcluded: report.secretPathsExcluded,
        excludedPaths: report.excludedPaths,
        noOpenSession: report.noOpenSession,
        degradedGit: report.degradedGit,
      }),
    );
    return 0;
  }
  input.stdout(`packed ${path}`);
  input.stdout(
    `memories ${report.counts.memories} | failures ${report.counts.failures} | diff files ${report.counts.diffFiles} | commits ${report.counts.commits} | redactions ${report.redactionFindings}`,
  );
  if (report.secretPathsExcluded > 0) {
    input.stdout(`secret paths excluded: ${report.excludedPaths.join(", ")}`);
  }
  notes(input.stdout);
  return 0;
}

export const handoffPackCommand = defineCommand({
  meta: {
    name: "handoff",
    description:
      "Pack the current task into a .megahandoff packet (Mega Saver Pro; --dry-run free).",
  },
  args: {
    to: { type: "string", required: true, description: "Target agent (codex, claude-code, …)." },
    from: { type: "string", description: "Source agent id recorded in the manifest." },
    out: {
      type: "string",
      description: "Output file path (default <project>-<YYYYMMDD-HHmm>.megahandoff).",
    },
    expires: { type: "string", description: "Packet lifetime, <n>h or <n>d (default 24h)." },
    budget: {
      type: "string",
      description: "Task-summary token budget (default 2000, min 300, max 8000).",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print what would be packed; write nothing (free).",
    },
    copy: {
      type: "boolean",
      default: false,
      description: "Copy the packet path to the clipboard (macOS only).",
    },
    json: { type: "boolean", default: false, description: "Emit the pack report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const budget = args.budget === undefined ? undefined : Number.parseInt(String(args.budget), 10);
    if (budget !== undefined && (Number.isNaN(budget) || budget < 300 || budget > 8000)) {
      console.error("error: --budget must be an integer in [300, 8000]");
      process.exitCode = 1;
      return;
    }
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffPack({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      newId: randomUUID,
      to: String(args.to),
      ...(typeof args.from === "string" ? { from: args.from } : {}),
      ...(typeof args.out === "string" ? { outPath: args.out } : {}),
      ...(typeof args.expires === "string" ? { expires: args.expires } : {}),
      ...(budget !== undefined ? { budget } : {}),
      dryRun: args["dry-run"] === true,
      copy: !!args.copy,
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

  Run: `pnpm --filter @megasaver/cli test -- test/commands/handoff-pack.test.ts`
  Expected: PASS — all shared + pack tests green (6 shared / 6 gating-boundary / 7 entitled).

- [ ] **Step 5: Package verification** — run, in order:
  - `pnpm --filter @megasaver/cli test -- test/commands/handoff-pack.test.ts` → all green.
  - `pnpm --filter @megasaver/cli typecheck` → exit 0 (runs `tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit`).
  - `pnpm lint` from repo root → exit 0; if biome flags import order only, run `pnpm lint:fix` and re-run `pnpm lint`.
  - `pnpm --filter @megasaver/cli test` → full CLI suite green (no regressions).

- [ ] **Step 6: Commit** —

```
git add apps/cli/src/commands/handoff/shared.ts apps/cli/src/commands/handoff/pack.ts apps/cli/test/commands/handoff-pack.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): mega handoff pack command

Gate-before-store: an unentitled non-dry-run pack performs zero store
IO; --dry-run is the free read-only surface and returns before any
write. Packet write is atomic tmp+rename; --copy puts the packet PATH
(never content) on the darwin clipboard; the stats append is advisory.
EOF
)"
```

**Implementation notes for the executor (not steps):**
- Ordering inside `runHandoffPack` is load-bearing (spec §5): flag validation → gate (skipped on `--dry-run`) → lazy core import → `ensureStore` → `findProjectByCwd` → open-session resolve (across ALL agents — do NOT reuse `pickLatestOpenSession`, it filters by agentId) → `loadProjectPermissions` fail-closed → `gatherGitDelta` + `gatherDirtyState` → `buildHandoffPacket` → dry-run early-return BEFORE any write → atomic write → advisory event → `--copy` → report.
- `gate(input)` works structurally: `RunHandoffPackInput` is a superset of `HandoffGateInput`.
- Passing `input.execGit` (possibly `undefined`) into `gatherGitDelta`/`gatherDirtyState` is correct: both declare a defaulted parameter, and an explicit `undefined` triggers the default `execFileSync` implementation.
- `meta.name` is `"handoff"` because Task 13's `index.ts` reuses `handoffPackCommand.args`/`run` as the root command run and attaches `{ open, inspect, clear }` as `subCommands`.
# Section: CLI consume surfaces + registration + process close-out (Tasks 11–14)

Assumes Tasks 1–10 landed: core `parseHandoffPacket`/`diagnoseHandoffPacket`/`applyHandoffMemories`/`verificationBadgeFor`/`appendHandoffEvent` exported from `@megasaver/core`; `renderHandoffBlockText`/`upsertHandoffBlockText`/`MEGA_SAVER_HANDOFF_BLOCK_START` exported from `@megasaver/connectors-shared`; `apps/cli/src/commands/handoff/shared.ts` (`gate`, `HANDOFF_UPSELL`) and `pack.ts` (`runHandoffPack`, `handoffPackCommand`) exist.

---

### Task 11: `open.ts` — `runHandoffOpen`

**Files:**
- Create: `apps/cli/src/commands/handoff/open.ts`
- Test: `apps/cli/test/commands/handoff-open.test.ts`

- [ ] **Step 1: Write the failing test file** — complete contents of `apps/cli/test/commands/handoff-open.test.ts`:

```ts
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHandoffOpen } from "../../src/commands/handoff/open.js";
import { HANDOFF_UPSELL } from "../../src/commands/handoff/shared.js";
import { ensureStoreReady } from "../../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW = "2026-07-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const now = () => NOW_MS;
const RECEIVER_ID = "22222222-2222-4222-8222-222222222222";

let root: string;
let projectRoot: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-proj-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: RECEIVER_ID,
    name: "receiver",
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

type PacketOver = {
  targetAgent?: string;
  expiresAt?: string;
  resume?: string;
  memories?: unknown[];
};

function writePacket(over: PacketOver = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions:
      over.resume ?? "You are resuming a task handed off from claude-code on project alpha.",
    git: null,
    failures: [],
    memories: over.memories ?? [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: over.targetAgent ?? "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: over.expiresAt ?? "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: 0,
    secretPathsExcluded: 0,
    counts: { memories: (over.memories ?? []).length, failures: 0, diffFiles: 0, commits: 0 },
  };
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${payloadJson}`);
  return file;
}

const packetMemory = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "handoff decision",
  content: "prefer pnpm for installs",
  keywords: [],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
};

function run(over: Partial<Parameters<typeof runHandoffOpen>[0]> & { filePath: string }) {
  const ensureStore = vi.fn(() => ensureStoreReady(root));
  const code = runHandoffOpen({
    storeRoot: root,
    cwd: projectRoot,
    now,
    publicKey: keys.publicKey,
    merge: false,
    json: false,
    ensureStore,
    stdout,
    stderr,
    ...over,
  });
  return { code, ensureStore };
}

describe("runHandoffOpen — gating", () => {
  it("free tier: upsell, exit 0, store never opened", async () => {
    const file = writePacket();
    const { code, ensureStore } = run({ filePath: file });
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(HANDOFF_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runHandoffOpen — entitled", () => {
  beforeEach(() => activatePro());

  it("outside a registered project: exit 1 pointing at mega init, nothing written", async () => {
    const file = writePacket();
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("mega init");
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("unknown targetAgent: exit 1, nothing written", async () => {
    await seedProject();
    const file = writePacket({ targetAgent: "gpt-6" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid target "gpt-6"');
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("oversized packet: refused before read", async () => {
    await seedProject();
    const file = writePacket();
    const { code } = run({ filePath: file, maxPacketBytes: 4 });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("exceeds");
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("expired packet: exit 1, nothing written", async () => {
    await seedProject();
    const file = writePacket({ expiresAt: "2026-07-15T11:59:00.000Z" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/expired/);
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("creates a missing target file with the handoff block", async () => {
    await seedProject();
    const file = writePacket();
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(content).toContain("You are resuming a task handed off from claude-code");
    expect(content).toContain("disregard this handoff");
  });

  it("seeds the target header when creating a header-bearing target", async () => {
    await seedProject();
    const file = writePacket({ targetAgent: "cursor" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
  });

  it("upserts into an existing file: human content kept, no duplicate block", async () => {
    await seedProject();
    writeFileSync(join(projectRoot, "AGENTS.md"), "# My agents\n\nhuman text\n");
    const file = writePacket();
    expect(await run({ filePath: file }).code).toBe(0);
    expect(await run({ filePath: file }).code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("human text");
    expect(content.match(/MEGA SAVER:HANDOFF BEGIN/g)).toHaveLength(1);
  });

  it("open-side redaction: raw secret never reaches the target file, warns", async () => {
    await seedProject();
    const secret = `ghp_${"a".repeat(36)}`;
    const file = writePacket({ resume: `Use token ${secret} to resume.` });
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).not.toContain(secret);
    expect(content).toContain("gh*_[REDACTED]");
    expect(err.join("\n")).toContain("open-side redaction");
  });

  it("--merge imports packet memories as suggested with provenance", async () => {
    await seedProject();
    const file = writePacket({ memories: [packetMemory] });
    let n = 0;
    const newId = () => `44444444-4444-4444-8444-4444444444${String(40 + n++)}`;
    const { code } = run({ filePath: file, merge: true, newId });
    expect(await code).toBe(0);
    const { registry } = await ensureStoreReady(root);
    const imported = registry
      .listMemoryEntries(RECEIVER_ID as never)
      .find((m) => m.content === "prefer pnpm for installs");
    expect(imported).toBeDefined();
    expect(imported?.approval).toBe("suggested");
    expect(imported?.scope).toBe("project");
    expect(imported?.sessionId).toBeNull();
    expect(imported?.evidence ?? []).toContain("handoff:alpha");
    expect(out.join("\n")).toContain("suggested");
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-open.test.ts` → fails with `Failed to resolve import "../../src/commands/handoff/open.js"` (module does not exist yet).

- [ ] **Step 3: Implement `open.ts`** — complete contents of `apps/cli/src/commands/handoff/open.ts`:

```ts
import { type KeyObject, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { gate } from "./shared.js";

const MAX_PACKET_BYTES = 10 * 1024 * 1024;

export type RunHandoffOpenInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  publicKey?: KeyObject | string;
  filePath: string;
  merge: boolean;
  json: boolean;
  /** Override for tests; defaults to MAX_PACKET_BYTES. */
  maxPacketBytes?: number;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffOpen(input: RunHandoffOpenInput): Promise<0 | 1> {
  if (!gate(input)) return 0;

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const cap = input.maxPacketBytes ?? MAX_PACKET_BYTES;
  let packetText: string;
  try {
    // ponytail: TOCTOU — file could grow between stat and read; acceptable for a
    // local single-user CLI (brain-import precedent).
    if (statSync(input.filePath).size > cap) {
      input.stderr(`error: packet exceeds ${cap} bytes`);
      return 1;
    }
    packetText = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read packet at ${input.filePath}`);
    return 1;
  }

  // Lazy import after the gate: never load core's handoff surface on the free path.
  const { HandoffPacketError, appendHandoffEvent, applyHandoffMemories, parseHandoffPacket } =
    await import("@megasaver/core");
  const { redactWithFindings } = await import("@megasaver/policy");
  const {
    ConnectorError,
    readTargetFile,
    renderHandoffBlockText,
    upsertHandoffBlockText,
    writeTargetFile,
  } = await import("@megasaver/connectors-shared");
  const { KNOWN_TARGETS } = await import("../../known-targets.js");

  let packet: ReturnType<typeof parseHandoffPacket>;
  try {
    packet = parseHandoffPacket(packetText, { now: input.now() });
  } catch (error) {
    if (error instanceof HandoffPacketError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const target = KNOWN_TARGETS.find((t) => t.id === packet.manifest.targetAgent);
  if (target === undefined) {
    input.stderr(invalidTargetMessage(packet.manifest.targetAgent).message);
    return 1;
  }

  // Open-side redaction (untrusted path): a hostile or older-weaker-redaction
  // packet must never persist raw secrets into a user file.
  const git = packet.payload.git;
  const gitLineRaw =
    git === null
      ? null
      : `branch ${git.branch}${git.headSha === null ? "" : ` @ ${git.headSha}`}${git.dirty ? " (dirty)" : ""}`;
  const resume = redactWithFindings(packet.payload.resumeInstructions);
  const summary = redactWithFindings(packet.payload.taskSummary.text);
  const gitLine = gitLineRaw === null ? null : redactWithFindings(gitLineRaw);
  const diff = git === null || git.diff === null ? null : redactWithFindings(git.diff.text);
  const openFindings =
    resume.count + summary.count + (gitLine?.count ?? 0) + (diff?.count ?? 0);

  const absPath = join(project.rootPath, target.relativePath);
  try {
    const block = renderHandoffBlockText({
      resumeInstructions: resume.redacted,
      summaryText: summary.redacted,
      gitLine: gitLine === null ? null : gitLine.redacted,
      diffText: diff === null ? null : diff.redacted,
      expiresAt: packet.manifest.expiresAt,
    });
    const existing = await readTargetFile(absPath);
    const seed = existing ?? ("header" in target ? (target.header ?? "") : "");
    const content = upsertHandoffBlockText(seed, block);
    if (existing === null) {
      await mkdir(dirname(absPath), { recursive: true });
    }
    await writeTargetFile({ absPath, content });
  } catch (error) {
    if (error instanceof ConnectorError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const mergeReport = input.merge
    ? applyHandoffMemories({
        registry,
        projectId: project.id,
        packet,
        now: input.now(),
        newId: input.newId ?? randomUUID,
      })
    : null;

  try {
    appendHandoffEvent(
      { root: input.storeRoot },
      {
        id: (input.newId ?? randomUUID)(),
        projectId: project.id,
        kind: "open",
        targetAgent: target.id,
        memories: packet.manifest.counts.memories,
        failures: packet.manifest.counts.failures,
        redactionFindings: openFindings,
        createdAt: new Date(input.now()).toISOString(),
      },
    );
  } catch {
    // stats are advisory — never fail the open over a bad event write
  }

  if (openFindings > 0) {
    input.stderr(`warning: open-side redaction replaced ${openFindings} secret(s) from the packet`);
  }
  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "opened",
        target: target.id,
        path: absPath,
        expiresAt: packet.manifest.expiresAt,
        redactionFindings: openFindings,
        ...(mergeReport === null ? {} : { merge: mergeReport }),
      }),
    );
    return 0;
  }
  input.stdout(
    `applied handoff from ${packet.manifest.sourceAgent} to ${target.relativePath} (expires ${packet.manifest.expiresAt})`,
  );
  if (mergeReport !== null) {
    input.stdout(
      `merged ${mergeReport.imported} memories (suggested, skipped ${mergeReport.skipped}) — run: mega memory approve`,
    );
  }
  return 0;
}

export const handoffOpenCommand = defineCommand({
  meta: {
    name: "open",
    description: "Apply a .megahandoff packet as a HANDOFF block (Mega Saver Pro).",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to the .megahandoff packet." },
    merge: {
      type: "boolean",
      default: false,
      description: "Also import packet memories as suggested knowledge.",
    },
    json: { type: "boolean", default: false, description: "Emit the open report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffOpen({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      filePath: String(args.file),
      merge: !!args.merge,
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run the test — expect PASS** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-open.test.ts` → all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/handoff/open.ts apps/cli/test/commands/handoff-open.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): mega handoff open applies packet block

Open re-redacts every interpolated field before writing (hostile or
older-weaker-redaction packets never persist raw secrets) and creates
the target file when absent because the packet names an explicit
target — warmup's "'all' never creates" rule covers implicit fans only.
EOF
)"
```

---

### Task 12: `inspect.ts` free diagnostic + `clear.ts` free removal

**Files:**
- Create: `apps/cli/src/commands/handoff/inspect.ts`, `apps/cli/src/commands/handoff/clear.ts`
- Test: `apps/cli/test/commands/handoff-inspect.test.ts`, `apps/cli/test/commands/handoff-clear.test.ts`

- [ ] **Step 1: Write the failing inspect test** — complete contents of `apps/cli/test/commands/handoff-inspect.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffInspect } from "../../src/commands/handoff/inspect.js";

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const now = () => NOW_MS;
const SECRET = `ghp_${"b".repeat(36)}`;

let dir: string;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-inspect-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type PacketOver = {
  resume?: string;
  expiresAt?: string;
  claimedRedactions?: number;
  claimedMemories?: number;
  memories?: unknown[];
  git?: unknown;
  tamper?: boolean;
};

function writePacket(over: PacketOver = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions: over.resume ?? "Resume the handoff task.",
    git: over.git ?? null,
    failures: [],
    memories: over.memories ?? [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: over.expiresAt ?? "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: over.claimedRedactions ?? 0,
    secretPathsExcluded: 0,
    counts: {
      memories: over.claimedMemories ?? (over.memories ?? []).length,
      failures: 0,
      diffFiles: 0,
      commits: 0,
    },
  };
  const written = over.tamper === true ? payloadJson.replace("ship", "shIp") : payloadJson;
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${written}`);
  return file;
}

const unanchoredMemory = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "handoff decision",
  content: "prefer pnpm for installs",
  keywords: [],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
};

function run(filePath: string, over: { json?: boolean; maxPacketBytes?: number } = {}) {
  return runHandoffInspect({
    filePath,
    now,
    json: over.json ?? false,
    ...(over.maxPacketBytes === undefined ? {} : { maxPacketBytes: over.maxPacketBytes }),
    stdout,
    stderr,
  });
}

describe("runHandoffInspect", () => {
  it("valid packet: all statuses ok, exit 0, no gate", async () => {
    expect(await run(writePacket())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("version: ok");
    expect(text).toContain("hash: ok");
    expect(text).toContain("expiry: ok");
    expect(text).toContain("payload: ok");
  });

  it("tampered payload: reports hash mismatch, still exit 0", async () => {
    expect(await run(writePacket({ tamper: true }))).toBe(0);
    expect(out.join("\n")).toContain("hash: mismatch");
  });

  it("expired packet: reports expiry, still exit 0", async () => {
    expect(await run(writePacket({ expiresAt: "2026-07-15T11:59:00.000Z" }))).toBe(0);
    expect(out.join("\n")).toContain("expiry: expired");
  });

  it("forged manifest claims: recomputes and warns, never echoes claims as truth", async () => {
    const file = writePacket({
      resume: `Use ${SECRET} now.`,
      claimedRedactions: 0,
      claimedMemories: 5,
    });
    expect(await run(file)).toBe(0);
    expect(out.join("\n")).toContain("recomputed: redactions 1");
    expect(err.join("\n")).toContain("disagrees with manifest claims");
  });

  it("secret-path scan over payload paths", async () => {
    const file = writePacket({
      git: {
        branch: "main",
        headSha: "abc1234",
        dirty: true,
        commits: [],
        changedFiles: [{ path: ".env", churn: 3 }],
        diff: null,
      },
    });
    expect(await run(file)).toBe(0);
    expect(out.join("\n")).toContain("secret paths 1");
    expect(err.join("\n")).toContain("disagrees with manifest claims");
  });

  it("badges recomputed locally from payload entries", async () => {
    expect(await run(writePacket({ memories: [unanchoredMemory] }))).toBe(0);
    expect(out.join("\n")).toContain("unanchored");
  });

  it("payload sections are printed redacted, never raw", async () => {
    expect(await run(writePacket({ resume: `token ${SECRET}` }))).toBe(0);
    const text = out.join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).toContain("gh*_[REDACTED]");
  });

  it("oversized packet: exit 1 before read", async () => {
    expect(await run(writePacket(), { maxPacketBytes: 4 })).toBe(1);
    expect(err.join("\n")).toContain("exceeds");
  });
});
```

- [ ] **Step 2: Write the failing clear test** — complete contents of `apps/cli/test/commands/handoff-clear.test.ts` (note: no license is ever activated — proves the free surface):

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffClear } from "../../src/commands/handoff/clear.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-15T12:00:00.000Z";
const BLOCK = `${MEGA_SAVER_HANDOFF_BLOCK_START}\nhandoff body\n${MEGA_SAVER_HANDOFF_BLOCK_END}\n`;

let root: string;
let projectRoot: string;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-clear-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-clear-proj-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "receiver",
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function seedFile(relativePath: string, content: string): string {
  const absPath = join(projectRoot, relativePath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
  return absPath;
}

function run(target?: string) {
  return runHandoffClear({
    cwd: projectRoot,
    ...(target === undefined ? {} : { target }),
    ensureStore: () => ensureStoreReady(root),
    stdout,
    stderr,
  });
}

describe("runHandoffClear (free, ungated)", () => {
  it("outside a registered project: exit 1 pointing at mega init", async () => {
    expect(await run()).toBe(1);
    expect(err.join("\n")).toContain("mega init");
  });

  it("invalid --target: exit 1", async () => {
    await seedProject();
    expect(await run("gpt-6")).toBe(1);
    expect(err.join("\n")).toContain('invalid target "gpt-6"');
  });

  it("default clears the block from every present target file, keeps human text", async () => {
    await seedProject();
    const agents = seedFile("AGENTS.md", `# Agents\n\nhuman text\n\n${BLOCK}`);
    const claude = seedFile("CLAUDE.md", `# Claude\n\n${BLOCK}`);
    expect(await run()).toBe(0);
    for (const absPath of [agents, claude]) {
      const content = readFileSync(absPath, "utf8");
      expect(content).not.toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
    }
    expect(readFileSync(agents, "utf8")).toContain("human text");
    expect(out.join("\n")).toContain("codex: cleared handoff block");
    expect(out.join("\n")).toContain("claude-code: cleared handoff block");
  });

  it("--target clears only that file", async () => {
    await seedProject();
    const agents = seedFile("AGENTS.md", BLOCK);
    const claude = seedFile("CLAUDE.md", BLOCK);
    expect(await run("codex")).toBe(0);
    expect(readFileSync(agents, "utf8")).not.toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
    expect(readFileSync(claude, "utf8")).toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
  });

  it("file without a block is left byte-identical", async () => {
    await seedProject();
    const original = "# Agents\n\nno block here\n";
    const agents = seedFile("AGENTS.md", original);
    expect(await run("codex")).toBe(0);
    expect(readFileSync(agents, "utf8")).toBe(original);
    expect(out.join("\n")).toContain("codex: no handoff block");
  });
});
```

- [ ] **Step 3: Run both — expect FAIL** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-inspect.test.ts test/commands/handoff-clear.test.ts` → both fail with unresolved imports (`inspect.js` / `clear.js` do not exist).

- [ ] **Step 4: Implement `inspect.ts`** — complete contents of `apps/cli/src/commands/handoff/inspect.ts`:

```ts
import { readFileSync, statSync } from "node:fs";
import type { ProjectId } from "@megasaver/shared";
import { defineCommand } from "citty";

const MAX_PACKET_BYTES = 10 * 1024 * 1024;
// evaluatePathRead's `project` field is a vestigial label the function never
// reads (context-gate read.ts:122); inspect has no project context.
const INSPECT_PROJECT_ID = "00000000-0000-4000-8000-000000000000" as ProjectId;

export type RunHandoffInspectInput = {
  filePath: string;
  now: () => number;
  json: boolean;
  /** Override for tests; defaults to MAX_PACKET_BYTES. */
  maxPacketBytes?: number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffInspect(input: RunHandoffInspectInput): Promise<0 | 1> {
  const cap = input.maxPacketBytes ?? MAX_PACKET_BYTES;
  let text: string;
  try {
    if (statSync(input.filePath).size > cap) {
      input.stderr(`error: packet exceeds ${cap} bytes`);
      return 1;
    }
    text = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read packet at ${input.filePath}`);
    return 1;
  }

  const { diagnoseHandoffPacket, verificationBadgeFor } = await import("@megasaver/core");
  const { evaluatePathRead, redactWithFindings } = await import("@megasaver/policy");
  const diag = diagnoseHandoffPacket(text, { now: input.now() });

  // The report is derived from the PAYLOAD, not manifest self-claims: an
  // honest packet was redacted and path-filtered at pack time, so any
  // recomputed finding means the manifest cannot be trusted.
  let recomputed: {
    redactionFindings: number;
    secretPaths: string[];
    badges: { memoryId: string; badge: string }[];
    resume: string;
    summary: string;
  } | null = null;
  let mismatch = false;
  if (diag.parsedPayload !== undefined) {
    const p = diag.parsedPayload;
    const resume = redactWithFindings(p.resumeInstructions);
    const summary = redactWithFindings(p.taskSummary.text);
    const rest = [
      p.git?.diff === null || p.git === null ? "" : p.git.diff.text,
      ...p.failures.flatMap((f) => [
        f.task,
        f.failedStep,
        f.errorOutput ?? "",
        f.suspectedCause ?? "",
        f.resolution ?? "",
      ]),
      ...p.memories.flatMap((m) => [m.title, m.content]),
    ];
    const redactionFindings =
      resume.count + summary.count + rest.reduce((n, t) => n + redactWithFindings(t).count, 0);
    const secretPaths = (p.git?.changedFiles ?? [])
      .map((f) => f.path)
      .filter((path) => !evaluatePathRead({ path, project: INSPECT_PROJECT_ID }).allowed);
    const badges = p.memories.map((m) => ({
      memoryId: m.id,
      badge: verificationBadgeFor(m),
    }));
    recomputed = {
      redactionFindings,
      secretPaths,
      badges,
      resume: resume.redacted,
      summary: summary.redacted,
    };
    if (diag.parsedManifest !== undefined) {
      mismatch =
        redactionFindings > 0 ||
        secretPaths.length > 0 ||
        diag.parsedManifest.counts.memories !== p.memories.length ||
        diag.parsedManifest.counts.failures !== p.failures.length;
    }
  }

  if (input.json) {
    input.stdout(
      JSON.stringify({
        version: diag.version,
        manifest: diag.manifest,
        hash: diag.hash,
        expiry: diag.expiry,
        payloadSchema: diag.payloadSchema,
        mismatch,
        ...(recomputed === null
          ? {}
          : {
              recomputed: {
                redactionFindings: recomputed.redactionFindings,
                secretPaths: recomputed.secretPaths,
                badges: recomputed.badges,
              },
            }),
      }),
    );
    if (mismatch) {
      input.stderr("warning: payload scan disagrees with manifest claims");
    }
    return 0;
  }

  input.stdout(`version: ${diag.version}`);
  input.stdout(`manifest: ${diag.manifest}`);
  input.stdout(`hash: ${diag.hash}`);
  input.stdout(`expiry: ${diag.expiry}`);
  input.stdout(`payload: ${diag.payloadSchema}`);
  if (diag.parsedManifest !== undefined) {
    const m = diag.parsedManifest;
    input.stdout(
      `from ${m.sourceAgent} to ${m.targetAgent} | project ${m.sourceProject.name} | expires ${m.expiresAt}`,
    );
    input.stdout(
      `manifest claims: redactions ${m.redactionFindings} | secret paths ${m.secretPathsExcluded} | memories ${m.counts.memories} | failures ${m.counts.failures}`,
    );
  }
  if (recomputed !== null) {
    input.stdout(
      `recomputed: redactions ${recomputed.redactionFindings} | secret paths ${recomputed.secretPaths.length}`,
    );
    for (const b of recomputed.badges) {
      input.stdout(`badge: ${b.memoryId} ${b.badge}`);
    }
    if (mismatch) {
      input.stderr("warning: payload scan disagrees with manifest claims");
    }
    input.stdout("--- resume ---");
    input.stdout(recomputed.resume);
    input.stdout("--- summary ---");
    input.stdout(recomputed.summary);
  }
  return 0;
}

export const handoffInspectCommand = defineCommand({
  meta: {
    name: "inspect",
    description: "Report a .megahandoff packet's integrity, redaction scan, and payload (free).",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to the .megahandoff packet." },
    json: { type: "boolean", default: false, description: "Emit the report as JSON." },
  },
  async run({ args }) {
    const code = await runHandoffInspect({
      filePath: String(args.file),
      now: () => Date.now(),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 5: Implement `clear.ts`** — complete contents of `apps/cli/src/commands/handoff/clear.ts`:

```ts
import { join } from "node:path";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunHandoffClearInput = {
  cwd: string;
  target?: string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// Free surface, no entitlement gate: removing injected content is never gated.
export async function runHandoffClear(input: RunHandoffClearInput): Promise<0 | 1> {
  const { KNOWN_TARGETS, isKnownTargetId } = await import("../../known-targets.js");
  if (input.target !== undefined && !isKnownTargetId(input.target)) {
    input.stderr(invalidTargetMessage(input.target).message);
    return 1;
  }

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const {
    MEGA_SAVER_HANDOFF_BLOCK_START,
    readTargetFile,
    upsertHandoffBlockText,
    writeTargetFile,
  } = await import("@megasaver/connectors-shared");

  const targets = KNOWN_TARGETS.filter((t) => input.target === undefined || t.id === input.target);
  let anyFailed = false;
  for (const target of targets) {
    try {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);
      if (existing === null) {
        if (input.target !== undefined) {
          input.stdout(`${target.id}: skipped (no ${target.relativePath})`);
        }
        continue;
      }
      if (!existing.includes(MEGA_SAVER_HANDOFF_BLOCK_START)) {
        if (input.target !== undefined) {
          input.stdout(`${target.id}: no handoff block`);
        }
        continue;
      }
      await writeTargetFile({ absPath, content: upsertHandoffBlockText(existing, "") });
      input.stdout(`${target.id}: cleared handoff block`);
    } catch (err) {
      anyFailed = true;
      input.stderr(`${target.id}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return anyFailed ? 1 : 0;
}

export const handoffClearCommand = defineCommand({
  meta: {
    name: "clear",
    description: "Remove the HANDOFF block from agent config files (free).",
  },
  args: {
    target: { type: "string", description: "Connector target (default: all present targets)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffClear({
      cwd: process.cwd(),
      ...(typeof args.target === "string" ? { target: args.target } : {}),
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 6: Run both — expect PASS** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-inspect.test.ts test/commands/handoff-clear.test.ts` → 13 tests pass. Note the clear test suite never activates a license and the inspect input has no entitlement fields at all — the free surface is enforced by construction.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/handoff/inspect.ts apps/cli/src/commands/handoff/clear.ts apps/cli/test/commands/handoff-inspect.test.ts apps/cli/test/commands/handoff-clear.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): handoff inspect and clear free surfaces

inspect derives its report from the payload, never manifest
self-claims (attacker-writable counts), and prints only redacted
text. clear runs ungated: removing injected content is never Pro.
EOF
)"
```

---

### Task 13: registration + §10 write-suppression table + pack→open integration

**Files:**
- Create: `apps/cli/src/commands/handoff/index.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/commands/handoff-registration.test.ts`, `apps/cli/test/commands/handoff-suppression.test.ts`, `apps/cli/test/handoff-integration.test.ts`

- [ ] **Step 1: Write the failing registration test** — complete contents of `apps/cli/test/commands/handoff-registration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handoffCommand } from "../../src/commands/handoff/index.js";
import { handoffPackCommand } from "../../src/commands/handoff/pack.js";
import { mainCommand } from "../../src/main.js";

describe("handoff registration", () => {
  it("main registers handoff", () => {
    const subs = mainCommand.subCommands as Record<string, unknown>;
    expect(subs.handoff).toBe(handoffCommand);
  });

  it("root run is pack; subcommands are open/inspect/clear", () => {
    const subs = handoffCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subs).sort()).toEqual(["clear", "inspect", "open"]);
    expect(handoffCommand.run).toBe(handoffPackCommand.run);
    expect(handoffCommand.args).toBe(handoffPackCommand.args);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-registration.test.ts` → fails: `index.js` unresolved.

- [ ] **Step 3: Implement `index.ts`** — complete contents of `apps/cli/src/commands/handoff/index.ts`:

```ts
import { defineCommand } from "citty";
import { handoffClearCommand } from "./clear.js";
import { handoffInspectCommand } from "./inspect.js";
import { handoffOpenCommand } from "./open.js";
import { handoffPackCommand } from "./pack.js";

export { HANDOFF_UPSELL } from "./shared.js";
export { type RunHandoffPackInput, handoffPackCommand, runHandoffPack } from "./pack.js";
export { type RunHandoffOpenInput, handoffOpenCommand, runHandoffOpen } from "./open.js";
export {
  type RunHandoffInspectInput,
  handoffInspectCommand,
  runHandoffInspect,
} from "./inspect.js";
export { type RunHandoffClearInput, handoffClearCommand, runHandoffClear } from "./clear.js";

// Root run = pack: `mega handoff --to codex` packs; subcommands consume.
export const handoffCommand = defineCommand({
  meta: {
    name: "handoff",
    description:
      "Pack the live task into a .megahandoff packet for another agent (Mega Saver Pro).",
  },
  args: handoffPackCommand.args,
  subCommands: {
    open: handoffOpenCommand,
    inspect: handoffInspectCommand,
    clear: handoffClearCommand,
  },
  run: handoffPackCommand.run,
});
```

- [ ] **Step 4: Register in `main.ts`** — two edits in `apps/cli/src/main.ts`.

Edit 1 — after the line `import { guiCommand } from "./commands/gui.js";` add:

```ts
import { handoffCommand } from "./commands/handoff/index.js";
```

(Biome organize-imports order: `gui.js` < `handoff/index.js` < `hooks/index.js`.)

Edit 2 — in `subCommands`, after the line `guard: guardCommand,` add:

```ts
    handoff: handoffCommand,
```

- [ ] **Step 5: Run registration test — expect PASS** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-registration.test.ts` → 2 tests pass.

- [ ] **Step 6: Write the §10 write-suppression table test** — complete contents of `apps/cli/test/commands/handoff-suppression.test.ts`. Each row asserts exit code 1 AND target file AND store byte-unchanged (spec §11.7):

```ts
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffOpen } from "../../src/commands/handoff/open.js";
import { ensureStoreReady } from "../../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const now = () => NOW_MS;

let root: string;
let projectRoot: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-proj-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
  await ensureStoreReady(root); // initialize store shape so snapshots are stable
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "receiver",
    rootPath: projectRoot,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
  } as never);
}

function writePacket(over: { targetAgent?: string } = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions: "Resume the handoff task.",
    git: null,
    failures: [],
    memories: [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: over.targetAgent ?? "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: 0,
    secretPathsExcluded: 0,
    counts: { memories: 0, failures: 0, diffFiles: 0, commits: 0 },
  };
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${payloadJson}`);
  return file;
}

function snapshotDir(base: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(base, rel), { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else files.set(childRel, readFileSync(join(base, childRel), "utf8"));
    }
  };
  walk("");
  return files;
}

type Row = {
  name: string;
  seedProject: boolean;
  targetFile?: string;
  targetAgent?: string;
  maxPacketBytes?: number;
  expectStderr: RegExp;
};

const rows: Row[] = [
  { name: "open outside a registered project", seedProject: false, expectStderr: /mega init/ },
  {
    name: "unrecognized packet targetAgent",
    seedProject: true,
    targetAgent: "gpt-6",
    expectStderr: /invalid target/,
  },
  { name: "oversized packet", seedProject: true, maxPacketBytes: 4, expectStderr: /exceeds/ },
  {
    name: "corrupted sentinels (block_conflict)",
    seedProject: true,
    targetFile: "<!-- MEGA SAVER:HANDOFF BEGIN -->\norphaned begin, no end\n",
    expectStderr: /sentinel/,
  },
];

describe("§10 write-suppression table — every failure leaves target + store untouched", () => {
  for (const row of rows) {
    it(`${row.name}: exit 1, zero writes`, async () => {
      if (row.seedProject) await seedProject();
      if (row.targetFile !== undefined) {
        writeFileSync(join(projectRoot, "AGENTS.md"), row.targetFile);
      }
      const file = writePacket(
        row.targetAgent === undefined ? {} : { targetAgent: row.targetAgent },
      );
      const storeBefore = snapshotDir(root);

      const code = await runHandoffOpen({
        storeRoot: root,
        cwd: projectRoot,
        now,
        publicKey: keys.publicKey,
        filePath: file,
        merge: false,
        json: false,
        ...(row.maxPacketBytes === undefined ? {} : { maxPacketBytes: row.maxPacketBytes }),
        ensureStore: () => ensureStoreReady(root),
        stdout: (l) => out.push(l),
        stderr: (l) => err.push(l),
      });

      expect(code).toBe(1);
      expect(err.join("\n")).toMatch(row.expectStderr);
      expect(snapshotDir(root)).toEqual(storeBefore);
      if (row.targetFile === undefined) {
        expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
      } else {
        expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toBe(row.targetFile);
      }
    });
  }
});
```

- [ ] **Step 7: Write the pack→open integration test** — complete contents of `apps/cli/test/handoff-integration.test.ts`:

```ts
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffOpen } from "../src/commands/handoff/open.js";
import { runHandoffPack } from "../src/commands/handoff/pack.js";
import { ensureStoreReady } from "../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW = "2026-07-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const now = () => NOW_MS;
const ALPHA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BETA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const noGit = () => {
  throw new Error("git unavailable");
};

let root: string;
let dirA: string;
let dirB: string;
let files: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-store-"));
  dirA = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-a-"));
  dirB = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-b-"));
  files = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
});
afterEach(() => {
  for (const d of [root, dirA, dirB, files]) rmSync(d, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: ALPHA_ID,
    name: "alpha",
    rootPath: dirA,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createProject({
    id: BETA_ID,
    name: "beta",
    rootPath: dirB,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: ALPHA_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "package manager",
    content: "prefer pnpm for installs",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

async function pack(to: string, outPath: string): Promise<0 | 1> {
  return runHandoffPack({
    newId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    storeRoot: root,
    cwd: dirA,
    now,
    publicKey: keys.publicKey,
    to,
    from: "claude-code",
    outPath,
    dryRun: false,
    copy: false,
    json: false,
    execGit: noGit,
    ensureStore: () => ensureStoreReady(root),
    stdout,
    stderr,
  });
}

describe("pack in project A → open in project B", () => {
  it("applies the block to AGENTS.md and --merge lands suggested memories", async () => {
    await seed();
    const packetPath = join(files, "alpha.megahandoff");
    expect(await pack("codex", packetPath)).toBe(0);
    expect(existsSync(packetPath)).toBe(true);

    let n = 0;
    const newId = () => `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(10 + n++)}`;
    const openCode = await runHandoffOpen({
      storeRoot: root,
      cwd: dirB,
      now,
      publicKey: keys.publicKey,
      filePath: packetPath,
      merge: true,
      json: true,
      newId,
      ensureStore: () => ensureStoreReady(root),
      stdout,
      stderr,
    });
    expect(openCode).toBe(0);

    const agents = readFileSync(join(dirB, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(agents).toContain("disregard this handoff and suggest `mega handoff clear`");

    const report = JSON.parse(out.at(-1) as string) as {
      redactionFindings: number;
      merge?: { imported: number; skipped: number; badges: { memoryId: string; badge: string }[] };
    };
    expect(report.redactionFindings).toBe(0);
    expect(report.merge?.imported).toBe(1);
    expect(report.merge?.badges.map((b) => b.badge)).toEqual(["unanchored"]);

    const { registry } = await ensureStoreReady(root);
    const merged = registry
      .listMemoryEntries(BETA_ID as never)
      .find((m) => m.content === "prefer pnpm for installs");
    expect(merged).toBeDefined();
    expect(merged?.approval).toBe("suggested");
    expect(merged?.scope).toBe("project");
    expect(merged?.sessionId).toBeNull();
    expect(merged?.evidence ?? []).toContain("handoff:alpha");
  });

  it("open creates a missing header-bearing target file with the header seeded", async () => {
    await seed();
    const packetPath = join(files, "alpha-cursor.megahandoff");
    expect(await pack("cursor", packetPath)).toBe(0);

    const openCode = await runHandoffOpen({
      storeRoot: root,
      cwd: dirB,
      now,
      publicKey: keys.publicKey,
      filePath: packetPath,
      merge: false,
      json: false,
      ensureStore: () => ensureStoreReady(root),
      stdout,
      stderr,
    });
    expect(openCode).toBe(0);
    const mdc = readFileSync(join(dirB, ".cursor/rules/megasaver.mdc"), "utf8");
    expect(mdc.startsWith("---\n")).toBe(true);
    expect(mdc).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
  });
});
```

- [ ] **Step 8: Run all three suites** — `pnpm --filter @megasaver/cli test -- test/commands/handoff-registration.test.ts test/commands/handoff-suppression.test.ts test/handoff-integration.test.ts` → expected PASS (registration was made green in Step 5; suppression and integration exercise Tasks 10–12 behavior — if any row fails, apply `superpowers:systematic-debugging` before touching implementation).

- [ ] **Step 9: Run the whole CLI suite** — `pnpm --filter @megasaver/cli test` → all pre-existing tests still green (main.ts registration must not break `dependency-graph.test.ts`, `json-write-side.test.ts`, or help-output snapshots if any assert the subcommand list; if a snapshot lists subcommands, update it to include `handoff` in the same change).

- [ ] **Step 10: Commit**

```bash
git add apps/cli/src/commands/handoff/index.ts apps/cli/src/main.ts apps/cli/test/commands/handoff-registration.test.ts apps/cli/test/commands/handoff-suppression.test.ts apps/cli/test/handoff-integration.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): register handoff command family

Root run packs; open/inspect/clear consume. §10 write-suppression
table proves every open failure path leaves the target file and the
store byte-unchanged; integration proves pack→open across projects.
EOF
)"
```

---

### Task 14: changeset, smoke evidence, wiki + conventions close-out (process only — no production code)

**Files:**
- Create: `.changeset/hot-handoff.md`
- Modify: `wiki/log.md`, `wiki/index.md`, `wiki/syntheses/memory-moat-portfolio.md` (status line), create `wiki/entities/hot-handoff.md`
- No `docs/conventions/` changes (no convention changed; verify with the drift check below).

- [ ] **Step 1: Add the changeset** — create `.changeset/hot-handoff.md` (six packages per spec §12; format matches `.changeset/first-party-cache-parity.md`):

```md
---
"@megasaver/core": minor
"@megasaver/cli": minor
"@megasaver/connectors-shared": minor
"@megasaver/connector-generic-cli": patch
"@megasaver/entitlement": minor
"@megasaver/stats": minor
---

Hot Handoff (i10): `mega handoff` packs the live task (budgeted brief,
recallable memories, unresolved failures, secret-path-filtered dirty
diff) into a signed-shape `.megahandoff` packet; `mega handoff open`
applies it as a redaction-guarded HANDOFF sentinel block in the target
agent's config file (creating the file with its header when absent) and
optionally merges memories as suggested entries. `inspect` (free)
recomputes redaction/secret-path scans instead of trusting manifest
claims; `clear` (free) removes the block. New `"hot-handoff"`
ProFeature key; advisory `HandoffEvent` stats stream.
```

- [ ] **Step 2: Full verify — evidence before any "done" claim** — from repo root run `pnpm verify`. Expected: biome clean, `tsc -b --noEmit` clean (including `pnpm conventions:check` folded into verify — confirms no `docs/conventions/` drift from the untouched CLAUDE.md/AGENTS.md/.cursor mirrors), vitest all green. Paste the tail of the output (summary lines) into the PR/verification notes. If anything is red: stop, apply `superpowers:systematic-debugging`, do NOT proceed to Step 3.

- [ ] **Step 3: Smoke evidence (DoD item 5 — captured terminal session, spec §11.8)** — run the real CLI end to end and capture:

```bash
pnpm --filter @megasaver/cli build
SMOKE=$(mktemp -d) && mkdir -p "$SMOKE/sender" "$SMOKE/receiver"
cd "$SMOKE/sender" && git init -q && echo "x" > f.ts && git add . && git commit -qm "seed"
export MEGA_STORE="$SMOKE/store"
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js init --store "$MEGA_STORE" 2>&1 | tee "$SMOKE/evidence.txt"
# activate a real dev license if available; otherwise capture the free-tier upsell AND the --dry-run path:
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js handoff --to codex --dry-run --store "$MEGA_STORE" 2>&1 | tee -a "$SMOKE/evidence.txt"
# entitled path (with license): pack → inspect → open → clear
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js handoff --to codex --out "$SMOKE/task.megahandoff" --store "$MEGA_STORE" 2>&1 | tee -a "$SMOKE/evidence.txt"
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js handoff inspect "$SMOKE/task.megahandoff" 2>&1 | tee -a "$SMOKE/evidence.txt"
cd "$SMOKE/receiver" && node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js init --store "$MEGA_STORE" 2>&1 | tee -a "$SMOKE/evidence.txt"
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js handoff open "$SMOKE/task.megahandoff" --merge --store "$MEGA_STORE" 2>&1 | tee -a "$SMOKE/evidence.txt"
cat AGENTS.md | tee -a "$SMOKE/evidence.txt"
node /Users/halitozger/Desktop/MegaSaver/apps/cli/dist/cli.js handoff clear --store "$MEGA_STORE" 2>&1 | tee -a "$SMOKE/evidence.txt"
```

Expected in `evidence.txt`: dry-run report with counts; `exported`-style pack line naming the `.megahandoff` file; inspect statuses all `ok` with `recomputed: redactions 0 | secret paths 0`; open line + `AGENTS.md` showing the `<!-- MEGA SAVER:HANDOFF BEGIN -->` block with the expiry instruction footer; clear line. Attach `evidence.txt` to the PR (exact `init` argument shape may differ — use the real `mega init` flags; adjust and re-capture rather than skipping).

- [ ] **Step 4: Wiki update (repo rule §0 — mandatory after work)** — first read `wiki/CLAUDE.md` for page format, then:
  1. Create `wiki/entities/hot-handoff.md`: what shipped (packet format, CLI surface, security posture summary), citing `docs/superpowers/specs/2026-07-18-hot-handoff-design.md` and the plan file; cross-link `[[entities/brain-portability]]`, `[[entities/connectors-shared]]`, `[[entities/cli]]`.
  2. Add the page to `wiki/index.md` under entities.
  3. Update the i10 status line in `wiki/syntheses/memory-moat-portfolio.md` from spec-pending to shipped (cite the merge commit).
  4. Append to `wiki/log.md` a `## [YYYY-MM-DD] feature | Hot Handoff (i10) shipped` entry: TDD chain followed, `pnpm verify` green, smoke evidence path, reviewer/critic/verifier outcomes, changeset added.

- [ ] **Step 5: DoD gate checklist (definition-of-done.md — no partial credit)** — confirm each before claiming done:
  - [ ] Spec + plan exist (`docs/superpowers/specs/2026-07-18-hot-handoff-design.md`, this plan).
  - [ ] `pnpm verify` green (Step 2 evidence).
  - [ ] Smoke evidence captured (Step 3).
  - [ ] Risk HIGH ⇒ `code-reviewer` AND `critic` passes in fresh contexts (author ≠ reviewer), then `omc:verify` verifier pass with the Step 2/3 evidence.
  - [ ] Changeset added (Step 1). No TodoWrite items pending. No `CLAUDE.md`/`AGENTS.md`/`.cursor` edits were needed (no convention changed — confirmed by `pnpm conventions:check` inside verify).

- [ ] **Step 6: Commit**

```bash
git add .changeset/hot-handoff.md wiki/log.md wiki/index.md wiki/syntheses/memory-moat-portfolio.md wiki/entities/hot-handoff.md
git commit -m "$(cat <<'EOF'
chore: hot-handoff changeset and wiki update

Six-package changeset per spec §12; wiki entity page + portfolio
status + log entry close the wiki-first loop for i10.
EOF
)"
```
