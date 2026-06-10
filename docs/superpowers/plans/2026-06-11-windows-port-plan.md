# Windows Port Remainder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four real Windows-portability gaps — win32 store path (+ HOME/USERPROFILE), CRLF mixed-EOL drift, id lowercase contract, and a proving `windows-latest` CI leg.

**Architecture:** Four independent-but-sequenced sub-PRs (spec §2). A pure `resolveStorePath`/`globalPacksRoot` gain a win32 branch; a `readStoreEnv()` boundary helper centralizes the env read (HOME→USERPROFILE fallback + platform + LOCALAPPDATA) so the 19 CLI handlers change one line each. B fixes the drift comparison via a shared `normalizeEol`. C adds a lowercase refine to the branded id schemas. D flips the CI matrix and guards POSIX-only tests.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, GitHub Actions, pnpm+turbo.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/windows-port`, branch `feat/windows-port`. Spec: `docs/superpowers/specs/2026-06-11-windows-port-design.md`. Run `pnpm install && pnpm build` once before starting.

**Sub-PR order:** PR2 (B) and PR3 (C) are smallest + independent → do first as quick wins. Then PR1 (A) the big one. Then PR4 (D) strictly last (it fixes tests A/C break; needs them merged). Each sub-PR is its own branch off latest main, its own `pnpm verify`, review, and merge.

---

## PR2 — CRLF mixed-EOL drift fix (spec §B)

Branch: `feat/windows-crlf-drift` off main.

### Task B1: `normalizeEol` helper + export

**Files:**
- Create: `packages/connectors/shared/src/eol.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/eol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/connectors/shared/test/eol.test.ts
import { describe, expect, it } from "vitest";
import { normalizeEol } from "../src/eol.js";

describe("normalizeEol", () => {
  it("collapses CRLF to LF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
  });
  it("leaves LF untouched", () => {
    expect(normalizeEol("a\nb\n")).toBe("a\nb\n");
  });
  it("normalizes mixed endings to LF", () => {
    expect(normalizeEol("a\r\nb\nc")).toBe("a\nb\nc");
  });
  it("does not touch a lone CR (classic-Mac, out of scope)", () => {
    expect(normalizeEol("a\rb")).toBe("a\rb");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared test -- eol`
Expected: FAIL — cannot resolve `../src/eol.js`.

- [ ] **Step 3: Implement**

```ts
// packages/connectors/shared/src/eol.ts
// Drift comparison normalizes EOLs so a file whose halves merely disagree
// on line ending (common on Windows: git autocrlf, CRLF editors) is not
// misreported as drift. Only \r\n is collapsed; a lone \r is left as-is.
export function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}
```

Add to `packages/connectors/shared/src/index.ts` after the `removeBlock, upsertBlock` export line:

```ts
export { normalizeEol } from "./eol.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @megasaver/connectors-shared test && pnpm --filter @megasaver/connectors-shared typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/shared/src/eol.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/eol.test.ts
git commit -m "feat(connectors): normalizeEol helper for drift comparison"
```

### Task B2: status + sync use EOL-normalized comparison

**Files:**
- Modify: `apps/cli/src/commands/connector/status.ts:92-93`
- Modify: `apps/cli/src/commands/connector/sync.ts:107-108`
- Test: `apps/cli/test/connector-status.test.ts` (append) and `apps/cli/test/connector.test.ts` (append for sync)

- [ ] **Step 1: Write the failing tests**

Append to `apps/cli/test/connector-status.test.ts` inside its top-level describe (reuse the file's existing seed/store harness — match its helper names; the test seeds a project + a claude-code target file, then writes a CRLF variant of an otherwise in-sync file and asserts `in-sync`):

```ts
  it("a CRLF-converted in-sync file reports in-sync, not drift", async () => {
    // Arrange: produce the canonical (LF) synced file, then rewrite it
    // with the managed block left LF but human prose converted to CRLF
    // (mixed) — the exact shape a Windows editor produces.
    await seedProject();
    await runSyncOnce(); // however this file already drives a sync; reuse it
    const target = claudeMdPath();
    const lf = await readFile(target, "utf8");
    const mixed = lf.replace(/^(?!.*MEGA_SAVER).*$/gm, (line) => line); // prose lines
    // Force prose region to CRLF while keeping the managed block LF:
    const crlfProse = lf.split("\n").map((l) => (l.includes("MEGA") ? l : `${l}\r`)).join("\n");
    await writeFile(target, crlfProse);
    const { records } = await runStatusJson();
    const claude = records.find((r) => r.id === "claude-code");
    expect(claude?.status).toBe("in-sync");
  });
```

> NOTE: the connector-status test file already has a working seed+sync+status harness (it tests in-sync/drift today). Reuse its actual helpers and fixture-builder names rather than the sketch above; the assertion that matters is **status === "in-sync"** for a mixed-EOL but content-identical file. If no sync helper exists in that file, build the synced file by calling the same `upsertBlock`-backed path the suite already uses.

Append the parallel test to `apps/cli/test/connector.test.ts` for sync asserting `noop` on the mixed-EOL file.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- connector-status && pnpm --filter @megasaver/cli test -- connector.test`
Expected: FAIL — status reports `drift`, sync reports `wrote` (raw byte compare).

- [ ] **Step 3: Implement the comparison change**

`apps/cli/src/commands/connector/status.ts` — add import and change line 93:

```ts
import { buildConnectorContext } from "./shared.js";
import { normalizeEol, upsertBlock } from "@megasaver/connectors-shared";
```

```ts
        const upserted = upsertBlock({ existingContent: existing, context });
        if (normalizeEol(upserted) === normalizeEol(existing)) {
```

`apps/cli/src/commands/connector/sync.ts` — add `normalizeEol` to the existing `@megasaver/connectors-shared` import and change line 108:

```ts
        const newContent = upsertBlock({ existingContent: existing, context });
        if (normalizeEol(newContent) === normalizeEol(existing)) {
          emit(target, "noop", sessionId);
          continue;
        }
        await writeTargetFile({ absPath, content: newContent });
```

(The write still uses the EOL-preserving `newContent` verbatim — only the in-sync/noop CLASSIFICATION normalizes.)

- [ ] **Step 4: Run to verify they pass + no regression**

Run: `pnpm --filter @megasaver/cli test -- connector`
Expected: PASS (existing in-sync/drift/noop/wrote tests still green — a genuine content change still differs after normalize).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector/status.ts apps/cli/src/commands/connector/sync.ts apps/cli/test/connector-status.test.ts apps/cli/test/connector.test.ts
git commit -m "fix(connector): classify drift by EOL-normalized comparison"
```

### Task B3: verify + changeset + PR

- [ ] `pnpm verify` green.
- [ ] `.changeset/windows-crlf-drift.md`:

```md
---
"@megasaver/connectors-shared": minor
"@megasaver/cli": patch
---

Connector drift detection now classifies in-sync/noop by EOL-normalized
comparison, so a file whose halves merely disagree on line ending (CRLF
vs LF, common on Windows) is no longer misreported as drift. The
EOL-preserving bytes written on a real change are unchanged. New
`normalizeEol` export on `@megasaver/connectors-shared`.
```

- [ ] Commit changeset; push `feat/windows-crlf-drift`; open PR; CI green; `code-reviewer` pass (MEDIUM risk); squash-merge.

---

## PR3 — ID lowercase contract (spec §C)

Branch: `feat/windows-id-lowercase` off latest main.

### Task C1: lowercase refine on the three id schemas

**Files:**
- Modify: `packages/shared/src/ids.ts`
- Test: `packages/shared/test/ids.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/test/ids.test.ts` inside the existing `describe.each` block (it iterates the three schemas as `schema`):

```ts
  it("accepts a lowercase UUID", () => {
    expect(schema.safeParse(SAMPLE_UUID).success).toBe(true);
  });
  it("rejects an UPPERCASE UUID", () => {
    expect(schema.safeParse(SAMPLE_UUID.toUpperCase()).success).toBe(false);
  });
  it("rejects a MixedCase UUID", () => {
    const mixed = "11111111-1111-4111-8111-11111111111A";
    expect(schema.safeParse(mixed).success).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @megasaver/shared test -- ids`
Expected: FAIL — uppercase/mixed currently parse successfully.

- [ ] **Step 3: Implement**

Replace `packages/shared/src/ids.ts`:

```ts
import { z } from "zod";

// IDs become filesystem path segments (memory `${projectId}.jsonl`,
// content-store and stats dirs). On a case-insensitive filesystem
// (NTFS, default APFS) two ids differing only in case would alias one
// file. randomUUID() always mints lowercase; this refine makes the
// lowercase contract explicit rather than emergent, and rejects (not
// transforms) so a non-canonical id is a loud error, not silent aliasing.
const lowercaseUuid = z
  .string()
  .uuid()
  .refine((s) => s === s.toLowerCase(), { message: "id must be lowercase" });

export const projectIdSchema = lowercaseUuid.brand<"ProjectId">();
export type ProjectId = z.infer<typeof projectIdSchema>;

export const sessionIdSchema = lowercaseUuid.brand<"SessionId">();
export type SessionId = z.infer<typeof sessionIdSchema>;

export const memoryEntryIdSchema = lowercaseUuid.brand<"MemoryEntryId">();
export type MemoryEntryId = z.infer<typeof memoryEntryIdSchema>;
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @megasaver/shared test && pnpm --filter @megasaver/shared typecheck`
Expected: PASS

- [ ] **Step 5: Verify no uppercase fixtures break the workspace**

Run: `grep -rEn '[0-9]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]*[A-F]' packages apps --include='*.ts' | grep -iv '\.toUpperCase\|MixedCase\|rejects' | head`
Expected: no production/fixture hits (architect confirmed zero). Then: `pnpm test` (full) green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ids.ts packages/shared/test/ids.test.ts
git commit -m "feat(shared): require lowercase UUIDs for id schemas"
```

### Task C2: verify + changeset + PR

- [ ] `pnpm verify` green.
- [ ] `.changeset/windows-id-lowercase.md`:

```md
---
"@megasaver/shared": minor
---

Project/session/memory id schemas now require lowercase UUIDs (reject
uppercase/mixed-case). Makes the case-collision safety explicit at the
boundary. Error-surface change: an uppercase id on a CLI command (`mega
session show <ID>`) or GUI bridge path param now fails validation
("id must be lowercase") instead of resolving to a 404. randomUUID
already mints lowercase, so no production write path regresses.
```

- [ ] Commit changeset; push; open PR; CI green; `code-reviewer` pass; squash-merge.

---

## PR1 — Store-path win32 branch + HOME fix (spec §A)

Branch: `feat/windows-store-path` off latest main.

### Task A1: pure resolver gains win32 branch

**Files:**
- Modify: `apps/cli/src/store.ts` (resolveStorePath + new `readStoreEnv`)
- Test: `apps/cli/test/store.test.ts` (rewrite literal asserts + add win32)

- [ ] **Step 1: Rewrite store.test.ts to be platform-correct + add win32 cases**

The 7 literal-`/`-string asserts (lines 18,29,62,73,84,95,106) break on win32. Make the suite pass `platform` explicitly and assert via constructed paths. Replace the POSIX-default cases to pass `platform: "linux"`, and add win32 cases. Full new test body for the default-path describe block:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStorePath } from "../src/store.js";

const POSIX = { platform: "linux" as const, localAppData: undefined };
const WIN = { platform: "win32" as const };

describe("resolveStorePath", () => {
  it("override absolute is returned verbatim", () => {
    expect(
      resolveStorePath({ storeFlag: "/abs/megasaver", cwd: "/repo", home: "/home/user", xdgDataHome: undefined, ...POSIX }),
    ).toBe("/abs/megasaver");
  });

  it("override relative resolves against cwd", () => {
    expect(
      resolveStorePath({ storeFlag: "local-store", cwd: "/repo", home: "/home/user", xdgDataHome: undefined, ...POSIX }),
    ).toBe(join("/repo", "local-store"));
  });

  it("XDG_DATA_HOME honored on posix", () => {
    expect(
      resolveStorePath({ storeFlag: undefined, cwd: "/repo", home: "/home/user", xdgDataHome: "/xdg/data", ...POSIX }),
    ).toBe(join("/xdg/data", "megasaver"));
  });

  it("posix default falls back to ~/.local/share", () => {
    expect(
      resolveStorePath({ storeFlag: undefined, cwd: "/repo", home: "/home/user", xdgDataHome: undefined, ...POSIX }),
    ).toBe(join("/home/user", ".local", "share", "megasaver"));
  });

  it("win32 default uses localAppData", () => {
    expect(
      resolveStorePath({ storeFlag: undefined, cwd: "C:\\repo", home: "C:\\Users\\u", xdgDataHome: undefined, platform: "win32", localAppData: "C:\\Users\\u\\AppData\\Local" }),
    ).toBe(join("C:\\Users\\u\\AppData\\Local", "megasaver"));
  });

  it("win32 default falls back to home/AppData/Local when localAppData unset", () => {
    expect(
      resolveStorePath({ storeFlag: undefined, cwd: "C:\\repo", home: "C:\\Users\\u", xdgDataHome: undefined, platform: "win32", localAppData: undefined }),
    ).toBe(join("C:\\Users\\u", "AppData", "Local", "megasaver"));
  });

  it("win32 still honors an explicit XDG_DATA_HOME (documented opt-in)", () => {
    expect(
      resolveStorePath({ storeFlag: undefined, cwd: "C:\\repo", home: "C:\\Users\\u", xdgDataHome: "D:\\xdg", platform: "win32", localAppData: "C:\\Users\\u\\AppData\\Local" }),
    ).toBe(join("D:\\xdg", "megasaver"));
  });
});
```

> NOTE: `join` produces the host-OS separator, so on the macOS/Linux dev box `join("C:\\Users\\u\\AppData\\Local","megasaver")` yields `C:\Users\u\AppData\Local/megasaver` — assert with the SAME `join` on both sides (the test computes expected via `join`, the impl computes via `join`), so they match on any host. This is exactly why literal-string asserts were wrong.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/cli test -- store.test`
Expected: FAIL — `resolveStorePath` has no `platform` param; win32 cases produce posix path.

- [ ] **Step 3: Implement the resolver + boundary helper**

Replace `apps/cli/src/store.ts`'s resolver region:

```ts
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { type CoreRegistry, createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { z } from "zod";

export type ResolveStorePathInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};

const storeFlagSchema = z.string().trim().min(1);

export function resolveStorePath(input: ResolveStorePathInput): string {
  const { storeFlag, cwd, home, xdgDataHome, platform, localAppData } = input;
  if (storeFlag !== undefined) {
    const trimmed = storeFlagSchema.parse(storeFlag);
    return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  if (platform === "win32") {
    const base = localAppData && localAppData.length > 0 ? localAppData : join(home, "AppData", "Local");
    return resolve(base, "megasaver");
  }
  return resolve(home, ".local", "share", "megasaver");
}

// Boundary: read every env input in ONE place so the 19 CLI handlers stay
// one-liners. Windows has no HOME → fall back to USERPROFILE (spec §A.1).
export function readStoreEnv(storeFlag: string | undefined): ResolveStorePathInput {
  return {
    storeFlag,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    xdgDataHome: process.env["XDG_DATA_HOME"],
    platform: process.platform,
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    localAppData: process.env["LOCALAPPDATA"],
  };
}
```

- [ ] **Step 4: Run store.test**

Run: `pnpm --filter @megasaver/cli test -- store.test`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit (resolver only; callers next)**

```bash
git add apps/cli/src/store.ts apps/cli/test/store.test.ts
git commit -m "feat(cli): win32 store-path branch + readStoreEnv boundary"
```

### Task A2: thread the new fields through the 19 command functions

The 19 command functions each have an input type with `home`/`xdgDataHome`/`cwd` and a citty `run()` that builds them from `process.env`. Add `platform` + `localAppData` to each input type, pass them to `resolveStorePath`, and have each `run()` use `readStoreEnv`.

**Files (all under `apps/cli/src/commands/`):** `project.ts`, `memory/{create,list,show}.ts`, `output/{file,filter,chunk,exec}.ts`, `mcp/serve.ts`, `connector/shared.ts`, `session/{list,end,update,create,show}.ts`, `session/saver/{enable,disable,stats,status}.ts`.

- [ ] **Step 1: Add the two fields to each input type + pass through**

For EACH file, in the `Run*Input` type add after `xdgDataHome`:

```ts
  platform: NodeJS.Platform;
  localAppData: string | undefined;
```

and in the `resolveStorePath({ ... })` call add `platform: input.platform, localAppData: input.localAppData,`.

For `connector/shared.ts` (shared prologue `resolveProjectAndRoot`/store builder used by sync+status), thread the same two fields through its input type and resolveStorePath call.

- [ ] **Step 2: Rewrite each `run()` handler to use readStoreEnv**

In each file's citty `run({ args })`, replace the inline `cwd/home/xdgDataHome` construction with a spread of `readStoreEnv`. Pattern (project list shown; apply identically):

```ts
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
// ...
  async run({ args }) {
    const code = await runProjectList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
```

> The command function input still names its store field `storeFlag`; `readStoreEnv` returns `storeFlag` too, so the explicit `storeFlag:` line is redundant — keep only the spread. Drop any now-unused `process.env["HOME"]` lines. Verify the relative import depth (`../store.js` vs `../../store.js`) per file.

- [ ] **Step 3: Update the 19 command test harnesses**

Every command test constructs the input with `home`/`xdgDataHome`. Add `platform: "linux"` and `localAppData: undefined` to each constructed input (the suites assert POSIX paths). Grep to find them:

Run: `grep -rln "xdgDataHome:" apps/cli/test --include='*.ts'`

For each, add the two fields wherever `xdgDataHome:` appears in a resolver-bound input. (Tests that pass an absolute `--store` are unaffected by platform but still need the fields to satisfy the type — add them.)

- [ ] **Step 4: typecheck + test**

Run: `pnpm typecheck && pnpm --filter @megasaver/cli test`
Expected: PASS. Fix any missed site the compiler flags (the required `platform` field makes omissions a type error — this is the safety net).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands apps/cli/test
git commit -m "feat(cli): thread platform+localAppData through store callers"
```

### Task A3: GUI bridge win32 branch + HOME/USERPROFILE

**Files:**
- Modify: `apps/gui/bridge/store-path.ts`
- Modify: `apps/gui/bridge/server.ts:16-27`
- Test: `apps/gui/bridge/` store-path test if present (else add one)

- [ ] **Step 1: Write/extend the failing test**

If `apps/gui/bridge` has a store-path test, append win32 cases; else create `apps/gui/bridge/store-path.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBridgeStorePath } from "./store-path.js";

describe("resolveBridgeStorePath", () => {
  it("override is returned resolved", () => {
    expect(resolveBridgeStorePath({ storeOverride: "/abs/x", home: "/h", xdgDataHome: undefined, platform: "linux", localAppData: undefined })).toBe("/abs/x");
  });
  it("posix default", () => {
    expect(resolveBridgeStorePath({ storeOverride: undefined, home: "/home/u", xdgDataHome: undefined, platform: "linux", localAppData: undefined })).toBe(join("/home/u", ".local", "share", "megasaver"));
  });
  it("win32 uses localAppData", () => {
    expect(resolveBridgeStorePath({ storeOverride: undefined, home: "C:\\Users\\u", xdgDataHome: undefined, platform: "win32", localAppData: "C:\\Users\\u\\AppData\\Local" })).toBe(join("C:\\Users\\u\\AppData\\Local", "megasaver"));
  });
  it("throws when no home and no override/xdg", () => {
    expect(() => resolveBridgeStorePath({ storeOverride: undefined, home: undefined, xdgDataHome: undefined, platform: "linux", localAppData: undefined })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/gui test -- store-path` → FAIL (no platform param).

- [ ] **Step 3: Implement**

```ts
// apps/gui/bridge/store-path.ts
import { join, resolve } from "node:path";

export type ResolveBridgeStorePathInput = {
  storeOverride: string | undefined;
  home: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};

// Mirrors apps/cli/src/store.ts resolveStorePath:
// override → XDG → win32 %LOCALAPPDATA% → posix ~/.local/share.
export function resolveBridgeStorePath(input: ResolveBridgeStorePathInput): string {
  const { storeOverride, home, xdgDataHome, platform, localAppData } = input;
  if (storeOverride !== undefined && storeOverride.length > 0) {
    return resolve(storeOverride);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  if (platform === "win32") {
    const base = localAppData && localAppData.length > 0 ? localAppData : home;
    if (!base || base.length === 0) {
      throw new Error("LOCALAPPDATA/USERPROFILE unset and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided");
    }
    return resolve(localAppData && localAppData.length > 0 ? localAppData : join(base, "AppData", "Local"), "megasaver");
  }
  if (!home || home.length === 0) {
    throw new Error("HOME is not set and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided");
  }
  return resolve(home, ".local", "share", "megasaver");
}
```

In `apps/gui/bridge/server.ts`, fix the two `readEnv("HOME")` sites (lines 18, 27) to fall back to USERPROFILE and pass platform/localAppData to the resolver call:

```ts
  const storeDir = resolveBridgeStorePath({
    storeOverride: readEnv("MEGASAVER_GUI_STORE"),
    home: readEnv("HOME") ?? readEnv("USERPROFILE"),
    xdgDataHome: readEnv("XDG_DATA_HOME"),
    platform: process.platform,
    localAppData: readEnv("LOCALAPPDATA"),
  });
```

(Apply the `?? readEnv("USERPROFILE")` fallback to the line-27 `home` read too, per its surrounding usage.)

- [ ] **Step 4: typecheck + test** — `pnpm --filter @megasaver/gui typecheck && pnpm --filter @megasaver/gui test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/store-path.ts apps/gui/bridge/server.ts apps/gui/bridge/store-path.test.ts
git commit -m "feat(gui): win32 bridge store-path + USERPROFILE fallback"
```

### Task A4: skill-packs `globalPacksRoot` win32 branch

**Files:**
- Modify: `packages/skill-packs/src/discover.ts`
- Modify: `apps/cli/src/commands/pack/*` (pass platform/localAppData) — via the same readStoreEnv-style boundary
- Test: `packages/skill-packs/test/discover.test.ts` (append win32 case)

- [ ] **Step 1: Write the failing test**

Append to `packages/skill-packs/test/discover.test.ts`:

```ts
  it("win32 global root uses localAppData", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "sp-lad-"));
    try {
      await seedPack(join(localAppData, "megasaver", "packs"), "win-pack");
      const result = await discoverPacks({
        workspaceRoot: workspace,
        home: "C:\\Users\\u",
        xdgDataHome: undefined,
        platform: "win32",
        localAppData,
      });
      expect(result.packs.map((p) => p.manifest.name)).toEqual(["win-pack"]);
    } finally {
      await rm(localAppData, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/skill-packs test -- discover` → FAIL (no platform/localAppData params).

- [ ] **Step 3: Implement**

In `packages/skill-packs/src/discover.ts`, extend `DiscoverInput` and `globalPacksRoot`:

```ts
export type DiscoverInput = {
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};
```

```ts
export function globalPacksRoot(
  home: string,
  xdgDataHome: string | undefined,
  platform: NodeJS.Platform,
  localAppData: string | undefined,
): string {
  if (xdgDataHome && xdgDataHome.length > 0) {
    return join(resolve(xdgDataHome), "megasaver", "packs");
  }
  if (platform === "win32") {
    const base = localAppData && localAppData.length > 0 ? localAppData : join(home, "AppData", "Local");
    return join(resolve(base), "megasaver", "packs");
  }
  return join(resolve(home, ".local", "share"), "megasaver", "packs");
}
```

Update its caller inside `discoverPacks` to pass `input.platform, input.localAppData`, and `installPack` (which calls `discoverPacks`) to thread the two new fields through `InstallPackInput`.

- [ ] **Step 4: Update pack command boundary + install.ts + their tests**

The `mega pack` commands (`apps/cli/src/commands/pack/{install,list,remove,info}.ts` via `shared.ts`) build the discover/install input. Add `platform`/`localAppData` to `PackEnv` and read them via the same pattern (`process.platform`, `process.env["LOCALAPPDATA"]`, home with USERPROFILE fallback). Update `packages/skill-packs/test/install.test.ts` and `apps/cli/test/pack.test.ts` constructed inputs to add `platform: "linux", localAppData: undefined`.

- [ ] **Step 5: typecheck + test** — `pnpm typecheck && pnpm --filter @megasaver/skill-packs test && pnpm --filter @megasaver/cli test -- pack` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/skill-packs apps/cli/src/commands/pack apps/cli/test/pack.test.ts
git commit -m "feat(skill-packs): win32 global packs root"
```

### Task A5: verify + smoke + changeset + PR

- [ ] `pnpm verify` green.
- [ ] Smoke (macOS, win32 injected): a unit assertion already proves `resolveStorePath({platform:"win32", localAppData:"C:\\X\\AppData\\Local", ...})` → `join("C:\\X\\AppData\\Local","megasaver")`. Capture as evidence.
- [ ] `.changeset/windows-store-path.md`:

```md
---
"@megasaver/cli": minor
"@megasaver/gui": minor
"@megasaver/skill-packs": minor
---

Store path, GUI bridge store path, and skill-packs global root now use
%LOCALAPPDATA%\megasaver on Windows (falling back to
%USERPROFILE%\AppData\Local), and read HOME→USERPROFILE so the default
location is correct on Windows. POSIX behavior unchanged. A new
readStoreEnv() boundary centralizes the env read across CLI commands.
```

- [ ] Commit; push `feat/windows-store-path`; open PR; CI green; `code-reviewer` + (HIGH) `critic` pass; squash-merge.

---

## PR4 — windows-latest CI matrix (spec §D) — STRICTLY LAST

Branch: `feat/windows-ci-matrix` off main AFTER PR1+PR3 merged (it fixes tests they touch).

### Task D1: per-package skip-on-windows helper + guard symlink/chmod tests

**Files:**
- Create (per package needing it): `packages/<pkg>/test/_platform.ts` exporting `describeUnlessWindows`
- Modify symlink test files (8) and chmod test files (5) listed in spec §D

- [ ] **Step 1: Add the helper where needed**

In each package whose tests use symlink/chmod (core, connectors/shared, output-filter, content-store, stats, skill-packs, apps/cli), create `test/_platform.ts`:

```ts
import { describe } from "vitest";
// WHY: symlink creation needs elevation on Windows (EPERM) and NTFS ignores
// POSIX chmod mode bits, so these POSIX-semantics tests cannot run there.
// Skipping loses no Windows-relevant coverage (the guarded behaviors are
// POSIX-only). The skip is explicit so it is never mistaken for coverage.
export const describeUnlessWindows = process.platform === "win32" ? describe.skip : describe;
```

- [ ] **Step 2: Wrap the symlink/chmod test groups**

In each listed file (spec §D items 2 and 3), wrap the symlink-using / chmod-using `describe`/`it` groups with `describeUnlessWindows`. Files: `connectors/shared/test/filesystem.test.ts`, `output-filter/test/resolve-safe-read-path.test.ts`, `content-store/test/atomic-write-behavior.test.ts`, `core/test/json-directory-registry-paths.test.ts`, `core/test/json-directory-registry-lock.test.ts`, `core/test/json-directory-registry-failure-modes.test.ts`, `skill-packs/test/{load-pack,install}.test.ts`, `stats/test/atomic-write.test.ts`, `apps/cli/test/{connector,connector-status}.test.ts`. Do NOT skip `core/test/json-directory-store.test.ts` (it forces win32 and must run).

> Where only specific `it`s use symlink/chmod (not the whole file), extract just those into a `describeUnlessWindows` block rather than skipping the file.

- [ ] **Step 3: Verify on the dev box (skips are no-ops on macOS)**

Run: `pnpm test`
Expected: PASS, same count as before (helper is `describe` on non-win32).

- [ ] **Step 4: Commit**

```bash
git add packages/*/test/_platform.ts packages/*/test apps/cli/test
git commit -m "test: guard POSIX-only symlink/chmod tests on Windows"
```

### Task D2: flip the CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Convert the verify job to a matrix**

```yaml
  verify:
    name: verify (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm build
      - name: Verify
        run: pnpm verify
```

- [ ] **Step 2: Commit + push, let CI run BOTH legs**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add windows-latest verify leg"
git push -u origin feat/windows-ci-matrix
```

- [ ] **Step 3: Watch the windows-latest leg; fix what it reds**

Run: `gh run watch <id> --repo haJ1t/MegaSaver`
Expected: BOTH legs green. If the Windows leg reds on a test the audit didn't predict, fix it (likely another POSIX-literal assertion or an unguarded symlink/chmod) and recommit. Iterate until green. Record the skipped-test count on Windows in the PR body.

### Task D3: changeset + wiki + PR

- [ ] No package API change → no changeset needed (CI-only); if biome flags formatting, `pnpm lint:fix`.
- [ ] Wiki (do this in PR4 since it closes the roadmap item):
  - `wiki/syntheses/post-v1.1-roadmap.md` item 4 → RESOLVED with PR refs.
  - Mark `docs/superpowers/specs/2026-05-10-windows-port-deferral.md` frontmatter `status: superseded` (superseded_by this spec).
  - `wiki/entities/cli.md` — note win32 store path + the readStoreEnv boundary.
  - New `wiki/concepts/windows-support.md` — what's supported (win32 store path, CRLF drift, lowercase ids, CI matrix), what's deferred (multi-process lock contention test, `pnpm clean`).
  - `wiki/index.md` + `wiki/log.md` entries (stamp PR numbers at merge).
- [ ] Push; open PR; both CI legs green; `critic` pass (HIGH); squash-merge.

---

## Cross-PR notes

- Each sub-PR rebases on latest main before merge.
- PR1 and PR3 change types the tests construct; the required `platform` field turns any missed site into a compile error — lean on `pnpm typecheck` as the completeness check.
- PR4 cannot be authored until PR1 + PR3 are on main (it fixes the store.test.ts and any id-related Windows breakage they introduce).
