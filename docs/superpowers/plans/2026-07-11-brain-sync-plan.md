# `mega brain sync` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@megasaver/brain-sync` + `mega brain sync` commands: E2E-encrypted sync of per-project `.megabrain` bundles through a user-owned S3-compatible bucket (spec: `docs/superpowers/specs/2026-07-11-brain-sync-design.md`, risk CRITICAL).

**Architecture:** New core-free package `packages/brain-sync` (crypto AES-256-GCM + S3 transport + CAS sync engine over opaque `bundleText` strings). CLI orchestrates: entitlement gate (`brain-portability` feature) → lazy-import brain-sync → inject `exportBrain`/`importBrain` callbacks from `@megasaver/core`. All manifest PUTs conditional; conditional-write enforcement verified at `init` by a live probe.

**Tech Stack:** Node 22 `node:crypto` (no crypto deps), `@aws-sdk/client-s3` (lazy dynamic import only), zod, vitest, tsup, citty.

**⚠️ Worktree base:** local `main` is ~26 commits BEHIND origin. Start with:
```bash
git fetch origin
git worktree add /tmp/brain-sync-wt -b feat/brain-sync origin/main
cd /tmp/brain-sync-wt && pnpm install
```
All paths below are relative to the worktree root.

**Conventions that bite here** (verified on origin/main):
- `.megabrain` bundle = 2-line text (manifest JSON `\n` payload JSON), produced by `exportBrain(...): string`, consumed by `importBrain({registry, projectId, bundleText, newId}): ImportBrainReport` (`packages/core/src/brain-export.ts:74`, `brain-import.ts:22`).
- Entitlement: `checkEntitlement("brain-portability", {storeRoot, now, publicKey?})` returns a union; unentitled ⇒ print upsell, `return 0` (see `apps/cli/src/commands/brain/export.ts:36-45`).
- There is NO shared atomic-write/base32/crypto helper — brain-sync owns its copies.
- Config/keyfile live in the store root from `resolveStorePath` (`apps/cli/src/store.ts:17`), NOT `~/.megasaver`.
- tsconfig `noPropertyAccessFromIndexSignature` is ON: `process.env["X"]`, never `process.env.X`.

---

## File structure

```
packages/brain-sync/
├─ package.json / tsconfig.json / tsconfig.test.json / tsup.config.ts / vitest.config.ts
├─ src/
│  ├─ index.ts          # public surface re-exports only
│  ├─ errors.ts         # BrainSyncError + code union
│  ├─ base32.ts         # RFC 4648 encode/decode (no padding)
│  ├─ crypto.ts         # encrypt/decrypt AES-256-GCM [iv|ct|tag] + AAD
│  ├─ hash.ts           # sha256Hex
│  ├─ atomic-write.ts   # copy of stats pattern + optional mode (0600)
│  ├─ keyfile.ts        # generate/save/load key, recovery code encode/decode
│  ├─ config.ts         # zod schema, load/save, endpoint guard, prefix normalize
│  ├─ manifest.ts       # sync manifest schema + seal/open + AAD constants
│  ├─ transport.ts      # lazy @aws-sdk S3 Transport + conditional PUT + probe
│  └─ sync.ts           # engine: pull/push/status over SyncDeps
└─ test/
   ├─ base32.test.ts, crypto.test.ts, keyfile.test.ts, config.test.ts,
   │  manifest.test.ts, transport.test.ts, sync.test.ts,
   │  no-eager-aws-sdk.test.ts
   └─ helpers/s3-double.ts   # in-process S3 with ETag + If-Match/If-None-Match

apps/cli/src/commands/brain/sync/
├─ index.ts    # citty group: init/push/pull/status/reset + bare run
├─ common.ts   # upsell text, gate+context builder (config/keyfile/transport/core callbacks)
├─ init.ts     # runBrainSyncInit (+ --join, --reset --force)
├─ ops.ts      # runBrainSyncPush/Pull/Status (bare sync = push flow)
└─ reset.ts    # runBrainSyncReset (--force)

apps/cli/src/commands/brain/index.ts   # add `sync` subcommand
apps/cli/test/brain-sync.test.ts       # CLI-level tests vs s3-double
apps/cli/test/brain-sync.two-machine.test.ts  # integration incl. CAS race
.changeset/brain-sync.md
```

---

### Task 1: Package scaffold

**Files:**
- Create: `packages/brain-sync/package.json`, `tsconfig.json`, `tsconfig.test.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`

- [ ] **Step 1: Write scaffold files**

`packages/brain-sync/package.json`:
```json
{
  "name": "@megasaver/brain-sync",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "description": "E2E-encrypted BYO S3 sync engine for .megabrain bundles",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "zod": "^3.24.1"
  },
  "devDependencies": { "@types/node": "^22.19.17" }
}
```

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "incremental": false, "composite": false },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

`tsconfig.test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "composite": false, "declaration": false, "declarationMap": false },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["dist", "node_modules", ".turbo"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
```

`src/index.ts` (placeholder until Task 11):
```ts
export {};
```

- [ ] **Step 2: Install + verify the package builds**

Run: `pnpm install && pnpm --filter @megasaver/brain-sync build && pnpm --filter @megasaver/brain-sync typecheck`
Expected: exit 0, `dist/index.js` emitted. (`pnpm-workspace.yaml` globs `packages/*` — no registration edits needed.)

- [ ] **Step 3: Commit**

```bash
git add packages/brain-sync
git commit -m "chore(brain-sync): scaffold package"
```

---

### Task 2: Errors + base32

**Files:**
- Create: `packages/brain-sync/src/errors.ts`, `src/base32.ts`
- Test: `packages/brain-sync/test/base32.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/base32.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "../src/base32.js";
import { BrainSyncError } from "../src/errors.js";

describe("base32 (RFC 4648, no padding)", () => {
  it("round-trips arbitrary bytes", () => {
    const input = Uint8Array.from({ length: 34 }, (_, i) => (i * 7 + 3) & 0xff);
    expect(base32Decode(base32Encode(input))).toEqual(input);
  });

  it("matches RFC 4648 test vectors", () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
    expect(enc("f")).toBe("MY");
    expect(enc("fo")).toBe("MZXQ");
    expect(enc("foobar")).toBe("MZXW6YTBOI");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZX0")).toThrow(BrainSyncError); // 0 not in alphabet
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test`
Expected: FAIL — cannot resolve `../src/base32.js`.

- [ ] **Step 3: Implement**

`src/errors.ts`:
```ts
export type BrainSyncErrorCode =
  | "wrong_key"
  | "rollback_detected"
  | "hash_mismatch"
  | "precondition_failed"
  | "sync_conflict"
  | "conditional_writes_unsupported"
  | "bad_recovery_code"
  | "keyfile_missing"
  | "keyfile_invalid"
  | "config_invalid"
  | "manifest_invalid"
  | "insecure_endpoint"
  | "transport_error";

export class BrainSyncError extends Error {
  readonly code: BrainSyncErrorCode;

  constructor(code: BrainSyncErrorCode, message: string) {
    super(message);
    this.name = "BrainSyncError";
    this.code = code;
  }
}
```

`src/base32.ts`:
```ts
import { BrainSyncError } from "./errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new BrainSyncError("bad_recovery_code", `invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/errors.ts packages/brain-sync/src/base32.ts packages/brain-sync/test/base32.test.ts
git commit -m "feat(brain-sync): errors + rfc4648 base32"
```

---

### Task 3: Crypto (AES-256-GCM)

**Files:**
- Create: `packages/brain-sync/src/crypto.ts`
- Test: `packages/brain-sync/test/crypto.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/crypto.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { BrainSyncError } from "../src/errors.js";

const key = randomBytes(32);
const aad = "megasaver-brain-sync:v1:object:objects/x.enc";
const plaintext = new TextEncoder().encode("brain bundle text");

describe("crypto", () => {
  it("round-trips with matching AAD", () => {
    expect(decrypt(encrypt(plaintext, key, aad), key, aad)).toEqual(Buffer.from(plaintext));
  });

  it("uses a fresh IV per call (first 12 bytes differ)", () => {
    const a = encrypt(plaintext, key, aad).subarray(0, 12);
    const b = encrypt(plaintext, key, aad).subarray(0, 12);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const blob = encrypt(plaintext, key, aad);
    blob[13] = (blob[13] ?? 0) ^ 0xff;
    expect(() => decrypt(blob, key, aad)).toThrow(BrainSyncError);
  });

  it("rejects AAD mismatch (transplanted object name)", () => {
    const blob = encrypt(plaintext, key, aad);
    expect(() => decrypt(blob, key, "megasaver-brain-sync:v1:object:objects/other.enc")).toThrow(BrainSyncError);
  });

  it("rejects the wrong key", () => {
    const blob = encrypt(plaintext, key, aad);
    expect(() => decrypt(blob, randomBytes(32), aad)).toThrow(BrainSyncError);
  });

  it("rejects blobs shorter than iv+tag", () => {
    expect(() => decrypt(new Uint8Array(10), key, aad)).toThrow(BrainSyncError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test crypto`
Expected: FAIL — cannot resolve `../src/crypto.js`.

- [ ] **Step 3: Implement**

`src/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BrainSyncError } from "./errors.js";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: Uint8Array, key: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function decrypt(blob: Uint8Array, key: Uint8Array, aad: string): Buffer {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new BrainSyncError("hash_mismatch", "encrypted blob is too short to be valid");
  }
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const body = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new BrainSyncError("hash_mismatch", `authentication failed for AAD ${aad}`);
  }
}
```

Note: `decrypt` failures use `hash_mismatch`?? — NO. Auth failure must be
distinguishable so `readRemote` can map manifest decrypt-failure to
`wrong_key`. Use a dedicated code: change both `throw` sites above to
`new BrainSyncError("decrypt_failed", ...)` and add `"decrypt_failed"` to
the `BrainSyncErrorCode` union in `src/errors.ts` (Task 2 file — edit it in
this task, it is one added union member). The tests stay valid (they assert
`BrainSyncError`, not the code).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test crypto`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/crypto.ts packages/brain-sync/src/errors.ts packages/brain-sync/test/crypto.test.ts
git commit -m "feat(brain-sync): aes-256-gcm seal/open with aad binding"
```

---

### Task 4: Atomic write + keyfile + recovery code

**Files:**
- Create: `packages/brain-sync/src/atomic-write.ts`, `src/keyfile.ts`, `src/hash.ts`
- Test: `packages/brain-sync/test/keyfile.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/keyfile.test.ts`:
```ts
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrainSyncError } from "../src/errors.js";
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateKey,
  loadKeyfile,
  saveKeyfile,
} from "../src/keyfile.js";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "brain-sync-key-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("keyfile", () => {
  it("generates 32-byte keys", () => {
    expect(generateKey().length).toBe(32);
  });

  it("save/load round-trips and sets 0600", () => {
    const path = join(tempDir(), "brain-sync.key");
    const key = generateKey();
    saveKeyfile(path, key);
    expect(loadKeyfile(path)).toEqual(key);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("loadKeyfile: missing file → keyfile_missing", () => {
    try {
      loadKeyfile(join(tempDir(), "nope.key"));
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("keyfile_missing");
    }
  });

  it("loadKeyfile: wrong length → keyfile_invalid", () => {
    const path = join(tempDir(), "brain-sync.key");
    saveKeyfile(path, generateKey());
    // corrupt: rewrite with 5 bytes
    saveKeyfile(path, Uint8Array.from([1, 2, 3, 4, 5]));
    try {
      loadKeyfile(path);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("keyfile_invalid");
    }
  });

  it("recovery code round-trips (55 chars, dash groups of 5)", () => {
    const key = generateKey();
    const code = encodeRecoveryCode(key);
    expect(code.replaceAll("-", "")).toHaveLength(55);
    expect(code.split("-").every((g) => g.length === 5)).toBe(true);
    expect(decodeRecoveryCode(code)).toEqual(key);
    expect(decodeRecoveryCode(code.toLowerCase())).toEqual(key); // case-insensitive entry
  });

  it("recovery code: single-character typo → bad_recovery_code", () => {
    const code = encodeRecoveryCode(generateKey());
    const flipped = (code[0] === "A" ? "B" : "A") + code.slice(1);
    try {
      decodeRecoveryCode(flipped);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("bad_recovery_code");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test keyfile`
Expected: FAIL — cannot resolve `../src/keyfile.js`.

- [ ] **Step 3: Implement**

`src/hash.ts`:
```ts
import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}
```

`src/atomic-write.ts` — copy `packages/stats/src/atomic-write.ts` VERBATIM
(Windows-safe `r+` fsync + parent-dir fsync + symlink guard), then apply
exactly two changes:
1. `content` parameter type `string` → `string | Uint8Array`.
2. Add optional `opts?: { mode?: number }` and pass
   `{ mode: opts?.mode ?? 0o666 }` to the temp-file `writeFileSync` call so
   the keyfile temp is CREATED 0600 (no chmod window).
Rename the thrown error to `BrainSyncError("transport_error", ...)`?? — no:
use `BrainSyncError("config_invalid", ...)` is also wrong. Keep the copied
file's local error class exactly as the stats copy does (each package owns
its own); name it `AtomicWriteError` inside the file. No export changes
beyond `atomicWriteFile`.

`src/keyfile.ts`:
```ts
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.js";
import { base32Decode, base32Encode } from "./base32.js";
import { BrainSyncError } from "./errors.js";
import { sha256Bytes } from "./hash.js";

export const KEY_LENGTH = 32;
const CHECKSUM_LENGTH = 2;

export function generateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

export function saveKeyfile(path: string, key: Uint8Array): void {
  atomicWriteFile(path, key, { mode: 0o600 });
}

export function loadKeyfile(path: string): Uint8Array {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BrainSyncError("keyfile_missing", `no keyfile at ${path} — run \`mega brain sync init\``);
    }
    throw err;
  }
  if (raw.length !== KEY_LENGTH) {
    throw new BrainSyncError("keyfile_invalid", `keyfile at ${path} is ${raw.length} bytes, expected ${KEY_LENGTH}`);
  }
  return Uint8Array.from(raw);
}

export function encodeRecoveryCode(key: Uint8Array): string {
  const checksum = sha256Bytes(key).subarray(0, CHECKSUM_LENGTH);
  const encoded = base32Encode(Buffer.concat([Buffer.from(key), checksum]));
  return encoded.match(/.{1,5}/g)?.join("-") ?? encoded;
}

export function decodeRecoveryCode(code: string): Uint8Array {
  const compact = code.replaceAll("-", "").replaceAll(/\s/g, "").toUpperCase();
  const bytes = base32Decode(compact);
  if (bytes.length !== KEY_LENGTH + CHECKSUM_LENGTH) {
    throw new BrainSyncError("bad_recovery_code", "recovery code has the wrong length");
  }
  const key = bytes.subarray(0, KEY_LENGTH);
  const checksum = bytes.subarray(KEY_LENGTH);
  const expected = sha256Bytes(key).subarray(0, CHECKSUM_LENGTH);
  if (!Buffer.from(checksum).equals(expected)) {
    throw new BrainSyncError("bad_recovery_code", "recovery code checksum does not match — check for typos");
  }
  return Uint8Array.from(key);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test keyfile`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src packages/brain-sync/test/keyfile.test.ts
git commit -m "feat(brain-sync): keyfile + checksummed recovery code"
```

---

### Task 5: Config

**Files:**
- Create: `packages/brain-sync/src/config.ts`
- Test: `packages/brain-sync/test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeEndpoint,
  loadConfig,
  normalizePrefix,
  saveConfig,
  updateLastSeen,
} from "../src/config.js";
import { BrainSyncError } from "../src/errors.js";

const dirs: string[] = [];
const tempStore = () => {
  const d = mkdtempSync(join(tmpdir(), "brain-sync-cfg-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const validConfig = {
  schemaVersion: 1,
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  bucket: "my-brain",
  prefix: "megasaver-brain/",
  region: "auto",
  pathStyle: true,
  conditionalWritesVerified: true,
  lastSeen: {},
} as const;

describe("config", () => {
  it("save/load round-trips", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    expect(loadConfig(store)).toEqual(validConfig);
  });

  it("missing config → config_invalid with init hint", () => {
    try {
      loadConfig(tempStore());
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("config_invalid");
      expect((err as BrainSyncError).message).toContain("mega brain sync init");
    }
  });

  it("rejects unknown fields (strict schema)", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    // write junk on top
    saveConfig(store, { ...validConfig, extra: 1 } as never);
    expect(() => loadConfig(store)).toThrow(BrainSyncError);
  });

  it("updateLastSeen persists per project id", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    const pid = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";
    updateLastSeen(store, pid, 4);
    expect(loadConfig(store).lastSeen[pid]).toBe(4);
  });

  it("assertSafeEndpoint: https ok, http localhost ok, http remote rejected", () => {
    expect(() => assertSafeEndpoint("https://s3.example.com")).not.toThrow();
    expect(() => assertSafeEndpoint("http://127.0.0.1:9000")).not.toThrow();
    expect(() => assertSafeEndpoint("http://localhost:9000")).not.toThrow();
    try {
      assertSafeEndpoint("http://s3.example.com");
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("insecure_endpoint");
    }
  });

  it("normalizePrefix ensures single trailing slash, strips leading slash", () => {
    expect(normalizePrefix("megasaver-brain")).toBe("megasaver-brain/");
    expect(normalizePrefix("/a/b/")).toBe("a/b/");
    expect(normalizePrefix("")).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test config`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Implement**

`src/config.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";
import { BrainSyncError } from "./errors.js";

export const CONFIG_FILE = "brain-sync.json";
export const KEYFILE_NAME = "brain-sync.key";

export const brainSyncConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    endpoint: z.string().url(),
    bucket: z.string().min(1),
    prefix: z.string(),
    region: z.string().min(1),
    pathStyle: z.boolean(),
    conditionalWritesVerified: z.literal(true),
    lastSeen: z.record(z.string().uuid(), z.number().int().nonnegative()),
  })
  .strict();

export type BrainSyncConfig = z.infer<typeof brainSyncConfigSchema>;

export function configPath(storeRoot: string): string {
  return join(storeRoot, CONFIG_FILE);
}

export function keyfilePath(storeRoot: string): string {
  return join(storeRoot, KEYFILE_NAME);
}

export function loadConfig(storeRoot: string): BrainSyncConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(storeRoot), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BrainSyncError("config_invalid", "brain sync is not configured — run `mega brain sync init`");
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BrainSyncError("config_invalid", `${CONFIG_FILE} is not valid JSON`);
  }
  const result = brainSyncConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new BrainSyncError("config_invalid", `${CONFIG_FILE} failed validation: ${result.error.issues[0]?.message ?? "unknown"}`);
  }
  return result.data;
}

export function saveConfig(storeRoot: string, config: BrainSyncConfig): void {
  atomicWriteFile(configPath(storeRoot), `${JSON.stringify(config, null, 2)}\n`);
}

export function updateLastSeen(storeRoot: string, projectId: string, generation: number): void {
  const config = loadConfig(storeRoot);
  saveConfig(storeRoot, { ...config, lastSeen: { ...config.lastSeen, [projectId]: generation } });
}

export function assertSafeEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BrainSyncError("insecure_endpoint", `endpoint is not a valid URL: ${endpoint}`);
  }
  if (url.protocol === "https:") return;
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (url.protocol === "http:" && localHosts.has(url.hostname)) return;
  throw new BrainSyncError("insecure_endpoint", "endpoint must be https:// (http:// is allowed only for localhost MinIO dev)");
}

export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}
```

Note on the "rejects unknown fields" test: `saveConfig` takes a typed
config, so the junk write uses `as never` — the runtime check under test is
`loadConfig`'s strict parse.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test config`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/config.ts packages/brain-sync/test/config.test.ts
git commit -m "feat(brain-sync): strict config with per-project last-seen"
```

---

### Task 6: Sync manifest

**Files:**
- Create: `packages/brain-sync/src/manifest.ts`
- Test: `packages/brain-sync/test/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/manifest.test.ts` (AADs bind `projectId` — see the AAD design in the
spec; a cross-project transplant must fail authentication):
```ts
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import type { BrainSyncError } from "../src/errors.js";
import { manifestAad, objectAad, openManifest, sealManifest, type SyncManifest } from "../src/manifest.js";

const key = randomBytes(32);
const projectId = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";
const otherProjectId = "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const manifest: SyncManifest = {
  schemaVersion: 1,
  generation: 3,
  updatedAt: "2026-07-11T12:00:00.000Z",
  brainSha256: "a".repeat(64),
  objectKey: `objects/${randomUUID()}.enc`,
};

describe("sync manifest", () => {
  it("seal/open round-trips under the same projectId", () => {
    expect(openManifest(sealManifest(manifest, key, projectId), key, projectId)).toEqual(manifest);
  });

  it("seal uses the manifest AAD (decrypt with object AAD fails)", () => {
    const sealed = sealManifest(manifest, key, projectId);
    expect(() => decrypt(sealed, key, objectAad(projectId, "objects/x.enc"))).toThrow();
    expect(() => decrypt(sealed, key, manifestAad(projectId))).not.toThrow();
  });

  it("rejects a manifest transplanted to a different project", () => {
    const sealed = sealManifest(manifest, key, projectId);
    expect(() => openManifest(sealed, key, otherProjectId)).toThrow();
  });

  it("open rejects valid-JSON payloads that fail the schema", () => {
    const bad = encrypt(new TextEncoder().encode(JSON.stringify({ nope: true })), key, manifestAad(projectId));
    try {
      openManifest(bad, key, projectId);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("open rejects non-JSON plaintext", () => {
    const bad = encrypt(new TextEncoder().encode("not json at all"), key, manifestAad(projectId));
    try {
      openManifest(bad, key, projectId);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("aad helpers produce the bound strings", () => {
    expect(manifestAad(projectId)).toBe(`megasaver-brain-sync:v1:manifest:${projectId}`);
    expect(objectAad(projectId, "objects/abc.enc")).toBe(
      `megasaver-brain-sync:v1:object:${projectId}:objects/abc.enc`,
    );
  });

  it("rejects an extra field (strict schema)", () => {
    const bad = encrypt(
      new TextEncoder().encode(JSON.stringify({ ...manifest, extra: 1 })),
      key,
      manifestAad(projectId),
    );
    expect(() => openManifest(bad, key, projectId)).toThrow();
  });

  it("rejects generation 0, malformed objectKey, and uppercase brainSha256", () => {
    const seal = (m: unknown) =>
      encrypt(new TextEncoder().encode(JSON.stringify(m)), key, manifestAad(projectId));
    expect(() => openManifest(seal({ ...manifest, generation: 0 }), key, projectId)).toThrow();
    expect(() => openManifest(seal({ ...manifest, objectKey: "objects/../evil.enc" }), key, projectId)).toThrow();
    expect(() => openManifest(seal({ ...manifest, brainSha256: "A".repeat(64) }), key, projectId)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test manifest`
Expected: FAIL — cannot resolve `../src/manifest.js`.

- [ ] **Step 3: Implement**

`src/manifest.ts`:
```ts
import { z } from "zod";
import { decrypt, encrypt } from "./crypto.js";
import { BrainSyncError } from "./errors.js";

export const MANIFEST_KEY = "manifest.json.enc";

// Every AAD binds projectId: one keyfile is shared across a user's projects
// and remote per-project isolation is only the (provider-controlled) prefix,
// so a foreign project's ciphertext must fail auth under the shared key.
export function manifestAad(projectId: string): string {
  return `megasaver-brain-sync:v1:manifest:${projectId}`;
}

export function objectAad(projectId: string, objectKey: string): string {
  return `megasaver-brain-sync:v1:object:${projectId}:${objectKey}`;
}

export const syncManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
    brainSha256: z.string().regex(/^[0-9a-f]{64}$/),
    objectKey: z.string().regex(/^objects\/[0-9a-f-]{36}\.enc$/),
  })
  .strict();

export type SyncManifest = z.infer<typeof syncManifestSchema>;

export function sealManifest(manifest: SyncManifest, key: Uint8Array, projectId: string): Buffer {
  return encrypt(Buffer.from(JSON.stringify(manifest), "utf8"), key, manifestAad(projectId));
}

export function openManifest(blob: Uint8Array, key: Uint8Array, projectId: string): SyncManifest {
  const text = decrypt(blob, key, manifestAad(projectId)).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrainSyncError("manifest_invalid", "decrypted manifest is not JSON");
  }
  const result = syncManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new BrainSyncError("manifest_invalid", `manifest failed validation: ${result.error.issues[0]?.message ?? "unknown"}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test manifest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/manifest.ts packages/brain-sync/test/manifest.test.ts
git commit -m "feat(brain-sync): sealed sync manifest schema"
```

---

### Task 7: S3 test double

**Files:**
- Create: `packages/brain-sync/test/helpers/s3-double.ts`
- Test: `packages/brain-sync/test/transport.test.ts` (double self-checks land in Task 8's file — this task only creates the helper and a minimal boot assertion inside it is NOT needed; the helper is exercised by every later test)

- [ ] **Step 1: Implement the helper (test infrastructure — no TDD cycle of its own)**

`test/helpers/s3-double.ts`:
```ts
import { createHash } from "node:crypto";
import { createServer } from "node:http";

export type S3DoubleEntry = { body: Buffer; etag: string };
export type S3Double = {
  url: string;
  store: Map<string, S3DoubleEntry>;
  close: () => Promise<void>;
};

// Minimal S3-compatible double: path-style /<bucket>/<key>, ETag,
// conditional PUT (If-Match / If-None-Match: *) with S3-style XML errors.
export async function startS3Double(): Promise<S3Double> {
  const store = new Map<string, S3DoubleEntry>();
  const server = createServer((req, res) => {
    const rawPath = (req.url ?? "").split("?")[0] ?? "";
    const key = decodeURIComponent(rawPath.replace(/^\/[^/]+\//, ""));
    const xml = (code: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

    if (req.method === "GET") {
      const entry = store.get(key);
      if (entry === undefined) {
        res.writeHead(404, { "content-type": "application/xml" }).end(xml("NoSuchKey"));
        return;
      }
      res
        .writeHead(200, { etag: entry.etag, "content-length": String(entry.body.length) })
        .end(entry.body);
      return;
    }

    if (req.method === "DELETE") {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const existing = store.get(key);
        const ifMatch = req.headers["if-match"];
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch === "*" && existing !== undefined) {
          res.writeHead(412, { "content-type": "application/xml" }).end(xml("PreconditionFailed"));
          return;
        }
        if (typeof ifMatch === "string" && (existing === undefined || existing.etag !== ifMatch)) {
          res.writeHead(412, { "content-type": "application/xml" }).end(xml("PreconditionFailed"));
          return;
        }
        const body = Buffer.concat(chunks);
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        store.set(key, { body, etag });
        res.writeHead(200, { etag }).end();
      });
      return;
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @megasaver/brain-sync typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/brain-sync/test/helpers/s3-double.ts
git commit -m "test(brain-sync): in-process conditional-write s3 double"
```

---

### Task 8: Transport + capability probe

**Files:**
- Create: `packages/brain-sync/src/transport.ts`
- Test: `packages/brain-sync/test/transport.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/transport.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrainSyncError } from "../src/errors.js";
import { createTransport, probeConditionalWrites, type Transport } from "../src/transport.js";
import { startS3Double, type S3Double } from "./helpers/s3-double.js";

let double: S3Double;
let transport: Transport;

beforeAll(async () => {
  process.env["MEGA_SYNC_ACCESS_KEY_ID"] = "test";
  process.env["MEGA_SYNC_SECRET_ACCESS_KEY"] = "test";
  double = await startS3Double();
  transport = await createTransport({
    endpoint: double.url,
    region: "auto",
    bucket: "test-bucket",
    prefix: "p/",
    pathStyle: true,
  });
});
afterAll(async () => {
  await double.close();
});

describe("transport", () => {
  it("getObject returns null on 404", async () => {
    expect(await transport.getObject("missing")).toBeNull();
  });

  it("put → get round-trips body and etag, under the prefix", async () => {
    const body = Buffer.from("hello");
    const put = await transport.putObject("a/b.enc", body);
    const got = await transport.getObject("a/b.enc");
    expect(got).not.toBeNull();
    expect(Buffer.from(got?.body ?? new Uint8Array())).toEqual(body);
    expect(got?.etag).toBe(put.etag);
    expect(double.store.has("p/a/b.enc")).toBe(true);
  });

  it("if-none-match on an existing key → precondition_failed", async () => {
    await transport.putObject("dup", Buffer.from("x"));
    try {
      await transport.putObject("dup", Buffer.from("y"), { kind: "if-none-match" });
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("precondition_failed");
    }
  });

  it("if-match with a stale etag → precondition_failed; fresh etag succeeds", async () => {
    const { etag } = await transport.putObject("cas", Buffer.from("v1"));
    try {
      await transport.putObject("cas", Buffer.from("v2"), { kind: "if-match", etag: '"deadbeef"' });
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("precondition_failed");
    }
    await expect(transport.putObject("cas", Buffer.from("v2"), { kind: "if-match", etag })).resolves.toBeDefined();
  });

  it("deleteObject removes; probe passes against an enforcing store", async () => {
    await transport.putObject("gone", Buffer.from("x"));
    await transport.deleteObject("gone");
    expect(await transport.getObject("gone")).toBeNull();
    expect(await probeConditionalWrites(transport)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test transport`
Expected: FAIL — cannot resolve `../src/transport.js`.

- [ ] **Step 3: Implement**

`src/transport.ts`:
```ts
import { randomUUID } from "node:crypto";
import { BrainSyncError } from "./errors.js";

export type TransportConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
};

export type PutCondition = { kind: "if-match"; etag: string } | { kind: "if-none-match" };

export type Transport = {
  getObject(key: string): Promise<{ body: Uint8Array; etag: string } | null>;
  putObject(key: string, body: Uint8Array, condition?: PutCondition): Promise<{ etag: string }>;
  deleteObject(key: string): Promise<void>;
};

const statusOf = (err: unknown): number | undefined =>
  (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const nameOf = (err: unknown): string | undefined => (err as { name?: string }).name;

export async function createTransport(config: TransportConfig): Promise<Transport> {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const accessKeyId = process.env["MEGA_SYNC_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["MEGA_SYNC_SECRET_ACCESS_KEY"];
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.pathStyle,
    ...(accessKeyId !== undefined && secretAccessKey !== undefined
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  const fullKey = (key: string) => `${config.prefix}${key}`;

  return {
    async getObject(key) {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: fullKey(key) }),
        );
        const body = await response.Body?.transformToByteArray();
        if (body === undefined || response.ETag === undefined) {
          throw new BrainSyncError("transport_error", `S3 GET ${key}: response missing body or ETag`);
        }
        return { body, etag: response.ETag };
      } catch (err) {
        if (statusOf(err) === 404 || nameOf(err) === "NoSuchKey") return null;
        throw err;
      }
    },

    async putObject(key, body, condition) {
      try {
        const response = await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: fullKey(key),
            Body: body,
            ...(condition?.kind === "if-match" ? { IfMatch: condition.etag } : {}),
            ...(condition?.kind === "if-none-match" ? { IfNoneMatch: "*" } : {}),
          }),
        );
        if (response.ETag === undefined) {
          throw new BrainSyncError("transport_error", `S3 PUT ${key}: response missing ETag`);
        }
        return { etag: response.ETag };
      } catch (err) {
        if (statusOf(err) === 412) {
          throw new BrainSyncError("precondition_failed", `conditional write failed for ${key}`);
        }
        throw err;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: fullKey(key) }));
    },
  };
}

// True only when the endpoint actually ENFORCES conditional writes:
// stale If-Match must 412, If-None-Match:* over an existing key must 412.
export async function probeConditionalWrites(transport: Transport): Promise<boolean> {
  const probeKey = `probe/${randomUUID()}`;
  await transport.putObject(probeKey, Buffer.from("megasaver-probe"));
  try {
    let enforced = false;
    try {
      await transport.putObject(probeKey, Buffer.from("x"), {
        kind: "if-match",
        etag: '"00000000000000000000000000000000"',
      });
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") enforced = true;
      else throw err;
    }
    if (!enforced) return false;
    try {
      await transport.putObject(probeKey, Buffer.from("x"), { kind: "if-none-match" });
      return false;
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") return true;
      throw err;
    }
  } finally {
    await transport.deleteObject(probeKey).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/brain-sync test transport`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/transport.ts packages/brain-sync/test/transport.test.ts
git commit -m "feat(brain-sync): s3 transport with verified conditional writes"
```

---

### Task 9: Sync engine — pull + status

**Files:**
- Create: `packages/brain-sync/src/sync.ts`
- Test: `packages/brain-sync/test/sync.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/sync.test.ts` (pull/status half; push tests are Task 10):
```ts
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrainSyncError } from "../src/errors.js";
import { sha256Hex } from "../src/hash.js";
import { pull, push, status, type SyncDeps } from "../src/sync.js";
import { createTransport, type Transport } from "../src/transport.js";
import { startS3Double, type S3Double } from "./helpers/s3-double.js";

let double: S3Double;
let transport: Transport;
const key = randomBytes(32);
const projectId = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";

// Fake "local machine": in-memory bundle + last-seen
function makeMachine(initialBundle: string) {
  let bundle = initialBundle;
  let lastSeen = 0;
  const imported: string[] = [];
  const deps: SyncDeps = {
    transport,
    key,
    projectId,
    lastSeenGeneration: () => lastSeen,
    persistLastSeen: (generation) => {
      lastSeen = generation;
    },
    exportBundle: () => bundle,
    importBundle: (text) => {
      imported.push(text);
      // simulate a MERGE (union), not replacement — after merging, the local
      // export must differ from the remote when local had its own content,
      // otherwise push's skip-unchanged check would short-circuit the CAS
      // retry tests below.
      bundle = bundle === text ? text : [...new Set([bundle, text])].sort().join("|");
    },
    now: () => new Date("2026-07-11T12:00:00.000Z"),
  };
  return {
    deps,
    imported,
    setBundle: (b: string) => {
      bundle = b;
    },
    getLastSeen: () => lastSeen,
  };
}

beforeEach(async () => {
  process.env["MEGA_SYNC_ACCESS_KEY_ID"] = "test";
  process.env["MEGA_SYNC_SECRET_ACCESS_KEY"] = "test";
  double = await startS3Double();
  transport = await createTransport({
    endpoint: double.url,
    region: "auto",
    bucket: "b",
    prefix: "proj-1/",
    pathStyle: true,
  });
});
afterEach(async () => {
  await double.close();
});

describe("pull/status", () => {
  it("pull on empty remote → empty", async () => {
    const m = makeMachine("bundle-a");
    expect(await pull(m.deps)).toEqual({ state: "empty" });
    expect(await status(m.deps)).toEqual({ state: "empty" });
  });

  it("pull merges a newer remote and persists last-seen", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps); // publishes generation 1
    const b = makeMachine("bundle-b");
    const result = await pull(b.deps);
    expect(result).toEqual({ state: "merged", generation: 1 });
    expect(b.imported).toEqual(["bundle-a"]);
    expect(b.getLastSeen()).toBe(1);
    expect(await pull(b.deps)).toEqual({ state: "up-to-date", generation: 1 });
  });

  it("pull with wrong key → wrong_key, remote untouched", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const evil = makeMachine("x");
    (evil.deps as { key: Uint8Array }).key = randomBytes(32);
    try {
      await pull(evil.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("wrong_key");
    }
  });

  it("rollback (remote older than last-seen) → rollback_detected", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps); // gen 1
    a.setBundle("bundle-a2");
    await push(a.deps); // gen 2
    // adversary re-serves the gen-1 manifest: snapshot then restore store
    const snapshot = new Map(double.store);
    a.setBundle("bundle-a3");
    await push(a.deps); // gen 3, lastSeen 3
    double.store.clear();
    for (const [k, v] of snapshot) double.store.set(k, v);
    try {
      await pull(a.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("rollback_detected");
    }
  });

  it("hash mismatch between manifest and object → hash_mismatch", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    // corrupt: swap object body for a validly-encrypted DIFFERENT text under the same key+AAD
    const manifestEntry = double.store.get("proj-1/manifest.json.enc");
    expect(manifestEntry).toBeDefined();
    const { openManifest } = await import("../src/manifest.js");
    const { encrypt } = await import("../src/crypto.js");
    const { objectAad } = await import("../src/manifest.js");
    const manifest = openManifest(manifestEntry?.body ?? new Uint8Array(), key, projectId);
    const forged = encrypt(Buffer.from("not-the-bundle"), key, objectAad(projectId, manifest.objectKey));
    double.store.set(`proj-1/${manifest.objectKey}`, { body: Buffer.from(forged), etag: '"f"' });
    const b = makeMachine("x");
    try {
      await pull(b.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("hash_mismatch");
    }
  });

  it("status reports generations without mutating", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    const s = await status(b.deps);
    expect(s).toEqual({
      state: "ok",
      remoteGeneration: 1,
      lastSeenGeneration: 0,
      upToDate: false,
      updatedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(b.imported).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/brain-sync test sync`
Expected: FAIL — cannot resolve `../src/sync.js`.

- [ ] **Step 3: Implement pull/status (push stub throws; completed in Task 10)**

`src/sync.ts`:
```ts
import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "./crypto.js";
import { BrainSyncError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { MANIFEST_KEY, objectAad, openManifest, sealManifest, type SyncManifest } from "./manifest.js";
import type { Transport } from "./transport.js";

export type SyncDeps = {
  transport: Transport;
  key: Uint8Array;
  projectId: string;
  lastSeenGeneration: () => number;
  persistLastSeen: (generation: number) => void;
  exportBundle: () => string;
  importBundle: (bundleText: string) => void;
  now: () => Date;
};

export type PullResult =
  | { state: "empty" }
  | { state: "up-to-date"; generation: number }
  | { state: "merged"; generation: number };

export type PushResult =
  | { state: "up-to-date"; generation: number }
  | { state: "pushed"; generation: number; merged: boolean };

export type StatusResult =
  | { state: "empty" }
  | { state: "ok"; remoteGeneration: number; lastSeenGeneration: number; upToDate: boolean; updatedAt: string };

type RemoteState = { manifest: SyncManifest; etag: string };

async function readRemote(transport: Transport, key: Uint8Array, projectId: string): Promise<RemoteState | null> {
  const got = await transport.getObject(MANIFEST_KEY);
  if (got === null) return null;
  try {
    return { manifest: openManifest(got.body, key, projectId), etag: got.etag };
  } catch (err) {
    if (err instanceof BrainSyncError && err.code === "decrypt_failed") {
      throw new BrainSyncError(
        "wrong_key",
        "remote manifest exists but cannot be decrypted with this keyfile — run `mega brain sync init --join` with the original recovery code",
      );
    }
    throw err;
  }
}

async function mergeRemote(deps: SyncDeps, remote: RemoteState): Promise<PullResult> {
  const { manifest } = remote;
  const lastSeen = deps.lastSeenGeneration();
  if (manifest.generation < lastSeen) {
    throw new BrainSyncError(
      "rollback_detected",
      `remote generation ${manifest.generation} is older than last-seen ${lastSeen} — refusing to merge a rolled-back manifest`,
    );
  }
  if (manifest.generation === lastSeen) return { state: "up-to-date", generation: manifest.generation };
  const obj = await deps.transport.getObject(manifest.objectKey);
  if (obj === null) {
    throw new BrainSyncError("manifest_invalid", `manifest points at missing object ${manifest.objectKey}`);
  }
  const bundleText = decrypt(obj.body, deps.key, objectAad(deps.projectId, manifest.objectKey)).toString("utf8");
  if (sha256Hex(bundleText) !== manifest.brainSha256) {
    throw new BrainSyncError("hash_mismatch", "decrypted bundle does not match the manifest brainSha256");
  }
  deps.importBundle(bundleText);
  deps.persistLastSeen(manifest.generation);
  return { state: "merged", generation: manifest.generation };
}

export async function pull(deps: SyncDeps): Promise<PullResult> {
  const remote = await readRemote(deps.transport, deps.key, deps.projectId);
  if (remote === null) return { state: "empty" };
  return mergeRemote(deps, remote);
}

export async function status(
  deps: Pick<SyncDeps, "transport" | "key" | "projectId" | "lastSeenGeneration">,
): Promise<StatusResult> {
  const remote = await readRemote(deps.transport, deps.key, deps.projectId);
  if (remote === null) return { state: "empty" };
  const lastSeen = deps.lastSeenGeneration();
  return {
    state: "ok",
    remoteGeneration: remote.manifest.generation,
    lastSeenGeneration: lastSeen,
    upToDate: remote.manifest.generation === lastSeen,
    updatedAt: remote.manifest.updatedAt,
  };
}

export async function push(deps: SyncDeps): Promise<PushResult> {
  throw new BrainSyncError("sync_conflict", "not implemented"); // Task 10
}
```

- [ ] **Step 4: Run the pull/status tests**

Run: `pnpm --filter @megasaver/brain-sync test sync`
Expected: pull/status tests that don't require a working `push` FAIL at the
`push` stub — that's the Task 10 red state. Only `pull on empty remote` and
`status` on empty pass at this point. Do NOT commit yet if the suite is
red beyond the intended stub — proceed straight to Task 10 (same file),
then commit both together.

---

### Task 10: Sync engine — push (CAS loop)

**Files:**
- Modify: `packages/brain-sync/src/sync.ts` (replace the `push` stub)
- Test: append to `packages/brain-sync/test/sync.test.ts`

- [ ] **Step 1: Append the failing push tests**

Append to `test/sync.test.ts`:
```ts
describe("push", () => {
  it("bootstrap push creates generation 1 (If-None-Match)", async () => {
    const a = makeMachine("bundle-a");
    expect(await push(a.deps)).toEqual({ state: "pushed", generation: 1, merged: false });
    expect(a.getLastSeen()).toBe(1);
    expect(double.store.has("proj-1/manifest.json.enc")).toBe(true);
  });

  it("skip-unchanged: same bundle hash → up-to-date, no generation churn", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    expect(await push(a.deps)).toEqual({ state: "up-to-date", generation: 1 });
  });

  it("push merges unseen remote changes first (merged: true)", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    const result = await push(b.deps);
    expect(result).toEqual({ state: "pushed", generation: 2, merged: true });
    expect(b.imported).toEqual(["bundle-a"]); // merged before publishing
  });

  it("deletes the previously referenced object after success (single live object)", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    a.setBundle("bundle-a2");
    await push(a.deps);
    const objectKeys = [...double.store.keys()].filter((k) => k.startsWith("proj-1/objects/"));
    expect(objectKeys).toHaveLength(1);
  });

  it("CAS race: manifest changes between read and write → retry succeeds", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    // wrap transport: first manifest PUT gets pre-empted by machine A pushing again
    let raced = false;
    const rawPut = transport.putObject.bind(transport);
    (b.deps as { transport: Transport }).transport = {
      ...transport,
      putObject: async (key, body, condition) => {
        if (!raced && key === "manifest.json.enc") {
          raced = true;
          a.setBundle("bundle-a2");
          await push(a.deps); // bumps remote to gen 2 with A's etag
        }
        return rawPut(key, body, condition);
      },
    };
    const result = await push(b.deps);
    expect(result.state).toBe("pushed");
    expect(result.generation).toBe(3); // 1 (a) → 2 (a race) → 3 (b retry)
    expect(b.imported).toContain("bundle-a2"); // retry re-merged the racing change
  });

  it("gives up after 3 CAS attempts → sync_conflict", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    let generationFeeder = 1;
    const rawPut = transport.putObject.bind(transport);
    (b.deps as { transport: Transport }).transport = {
      ...transport,
      putObject: async (key, body, condition) => {
        if (key === "manifest.json.enc") {
          generationFeeder += 1;
          a.setBundle(`bundle-a${generationFeeder}`);
          await push(a.deps); // always wins the race
        }
        return rawPut(key, body, condition);
      },
    };
    try {
      await push(b.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("sync_conflict");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @megasaver/brain-sync test sync`
Expected: push tests FAIL on the stub's `sync_conflict`.

- [ ] **Step 3: Implement push**

Replace the stub in `src/sync.ts`:
```ts
const MAX_CAS_ATTEMPTS = 3;

export async function push(deps: SyncDeps): Promise<PushResult> {
  let merged = false;
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
    const remote = await readRemote(deps.transport, deps.key, deps.projectId);
    if (remote !== null) {
      const mergeResult = await mergeRemote(deps, remote);
      if (mergeResult.state === "merged") merged = true;
    }
    const bundleText = deps.exportBundle();
    const brainSha256 = sha256Hex(bundleText);
    if (remote !== null && remote.manifest.brainSha256 === brainSha256) {
      return { state: "up-to-date", generation: remote.manifest.generation };
    }
    const objectKey = `objects/${randomUUID()}.enc`;
    const ciphertext = encrypt(Buffer.from(bundleText, "utf8"), deps.key, objectAad(deps.projectId, objectKey));
    await deps.transport.putObject(objectKey, ciphertext);
    const manifest: SyncManifest = {
      schemaVersion: 1,
      generation: (remote?.manifest.generation ?? 0) + 1,
      updatedAt: deps.now().toISOString(),
      brainSha256,
      objectKey,
    };
    try {
      await deps.transport.putObject(
        MANIFEST_KEY,
        sealManifest(manifest, deps.key, deps.projectId),
        remote === null ? { kind: "if-none-match" } : { kind: "if-match", etag: remote.etag },
      );
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") {
        await deps.transport.deleteObject(objectKey).catch(() => {});
        continue;
      }
      throw err;
    }
    deps.persistLastSeen(manifest.generation);
    if (remote !== null && remote.manifest.objectKey !== objectKey) {
      await deps.transport.deleteObject(remote.manifest.objectKey).catch(() => {});
    }
    return { state: "pushed", generation: manifest.generation, merged };
  }
  throw new BrainSyncError(
    "sync_conflict",
    "another machine kept updating the remote (3 attempts) — re-run `mega brain sync`",
  );
}
```

- [ ] **Step 4: Run the full package suite**

Run: `pnpm --filter @megasaver/brain-sync test`
Expected: PASS — all Task 2–10 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/sync.ts packages/brain-sync/test/sync.test.ts
git commit -m "feat(brain-sync): cas sync engine with merge-before-publish"
```

---

### Task 11: Public surface + no-eager-load guard

**Files:**
- Modify: `packages/brain-sync/src/index.ts`
- Test: `packages/brain-sync/test/no-eager-aws-sdk.test.ts`

- [ ] **Step 1: Write the failing guard test**

`test/no-eager-aws-sdk.test.ts` (mirrors `packages/output-filter/test/no-eager-typescript.test.ts`):
```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("no eager @aws-sdk load", () => {
  it("importing dist/index.js loads zero @aws-sdk modules", () => {
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(() => {
      const loaded = process.moduleLoadList.filter((m) => /node_modules[\\\\/]@aws-sdk[\\\\/]/.test(m));
      console.log(loaded.length);
    });`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    expect(out.trim()).toBe("0");
  });
});
```

- [ ] **Step 2: Fill in the public surface**

`src/index.ts`:
```ts
export { BrainSyncError, type BrainSyncErrorCode } from "./errors.js";
export {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateKey,
  loadKeyfile,
  saveKeyfile,
} from "./keyfile.js";
export {
  assertSafeEndpoint,
  brainSyncConfigSchema,
  configPath,
  keyfilePath,
  loadConfig,
  normalizePrefix,
  saveConfig,
  updateLastSeen,
  type BrainSyncConfig,
} from "./config.js";
export { MANIFEST_KEY } from "./manifest.js";
export { createTransport, probeConditionalWrites, type PutCondition, type Transport, type TransportConfig } from "./transport.js";
export { pull, push, status, type PullResult, type PushResult, type StatusResult, type SyncDeps } from "./sync.js";
```

- [ ] **Step 3: Build, then run the guard**

Run: `pnpm --filter @megasaver/brain-sync build && pnpm --filter @megasaver/brain-sync test no-eager`
Expected: PASS — `0` @aws-sdk modules loaded (only `createTransport` dynamic-imports the SDK). If this fails, tsup inlined the SDK — confirm `@aws-sdk/client-s3` sits in `dependencies` (tsup externalizes deps by default) and the only import is the `await import(...)` inside `createTransport`.

- [ ] **Step 4: Full package gate**

Run: `pnpm --filter @megasaver/brain-sync build && pnpm --filter @megasaver/brain-sync typecheck && pnpm --filter @megasaver/brain-sync test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/brain-sync/src/index.ts packages/brain-sync/test/no-eager-aws-sdk.test.ts
git commit -m "feat(brain-sync): public surface + aws-sdk lazy-load guard"
```

---

### Task 12: CLI — common context + init + reset

**Files:**
- Create: `apps/cli/src/commands/brain/sync/common.ts`, `init.ts`, `reset.ts`
- Modify: `apps/cli/package.json` (add `"@megasaver/brain-sync": "workspace:*"` to dependencies)
- Test: `apps/cli/test/brain-sync.test.ts`

**Before coding:** open `apps/cli/src/commands/brain/export.ts` and mirror
its input type shape (`storeRoot`, `now`, `stdout`, `stderr`, `publicKey?`,
project resolution via the registry, `ensureStoreReady` from
`apps/cli/src/store.ts`) and its gate-then-lazy-import structure exactly.
Find the signed-license test fixture used by existing brain tests:
`grep -rn "msp_\|activateLicense\|generateKeyPairSync" apps/cli/test | head` — reuse that helper for entitled tests.

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/brain-sync.test.ts` — cover, using the s3-double (import it
from `@megasaver/brain-sync`'s test helpers via a relative path
`../../packages/brain-sync/test/helpers/s3-double.js`; if the repo's
test-isolation lint rejects cross-package test imports, copy the helper to
`apps/cli/test/helpers/s3-double.ts` instead):

```ts
import { describe, expect, it } from "vitest";
// + the license fixture helper found above, temp store dirs, s3 double

describe("mega brain sync", () => {
  it("unentitled: prints upsell, returns 0, never touches the network", async () => {
    // storeRoot with NO license.json; stdout collector
    // const code = await runBrainSyncInit({ ...input, endpoint: "https://unreachable.invalid", ... });
    // expect(code).toBe(0); expect(stdout.join("")).toContain("Pro");
  });

  it("init: probe passes → writes config + keyfile 0600 + prints recovery code once", async () => {
    // entitled store; s3 double endpoint (http://127.0.0.1 allowed);
    // expect config file exists with conditionalWritesVerified: true
    // expect keyfile exists; stdout contains 55-char dash-grouped code and the warning line
  });

  it("init: non-enforcing endpoint → conditional_writes_unsupported, no config written", async () => {
    // start a crippled double: monkey-patch its server to ignore If-Match (set
    // double.store etag checks off by replacing putObject handling — simplest:
    // wrap startS3Double with a flag `enforce: false` added to the helper in this task)
    // expect exit 1, stderr mentions conditional writes, config file absent
  });

  it("init --join <code>: reconstructs the identical keyfile, prints NO recovery code", async () => {});

  it("init refuses to overwrite an existing keyfile without --reset --force", async () => {});

  it("reset <project> --force deletes the remote manifest", async () => {});
});
```

Write these as REAL tests (the skeleton above shows intent; every `it` must
arrange a temp store root, license fixture, and the double, then assert on
exit code, stdout/stderr arrays, and the filesystem). Add an
`enforce?: boolean` option to `startS3Double` while copying/pointing at the
helper (when `false`, skip both 412 branches) — that is the crippled-store
fixture for the probe-failure test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test brain-sync`
Expected: FAIL — modules under `commands/brain/sync/` don't exist.

- [ ] **Step 3: Implement**

`common.ts`:
```ts
import { checkEntitlement } from "@megasaver/entitlement";
// BrainSyncCommandInput mirrors BrainExportInput's shape (storeRoot, now,
// stdout, stderr, publicKey?) + per-command extras.

export const BRAIN_SYNC_UPSELL = [
  "mega brain sync is part of Mega Saver Pro.",
  "It keeps your project brain in sync across machines through YOUR OWN",
  "S3-compatible bucket, end-to-end encrypted (the provider only ever",
  "sees ciphertext). Unlock: https://megasaver.dev/pro",
].join("\n");

export function gate(input: { storeRoot: string; now: () => number; publicKey?: unknown; stdout: (s: string) => void }): boolean {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  } as Parameters<typeof checkEntitlement>[1]);
  if (!ent.entitled) {
    input.stdout(BRAIN_SYNC_UPSELL);
    return false;
  }
  return true;
}

// buildProjectSyncContext(input, projectName):
//   1. lazy `await import("@megasaver/brain-sync")` and `await import("@megasaver/core")`
//   2. loadConfig(storeRoot) + loadKeyfile(keyfilePath(storeRoot))
//   3. registry = ensureStoreReady(storeRoot); resolve project by name (mirror export.ts) → projectId
//   4. transport = await createTransport({ ...config connection fields, prefix: `${config.prefix}${projectId}/` })
//   5. return SyncDeps wiring (projectId is REQUIRED — it binds every AAD):
//      projectId,
//      lastSeenGeneration: () => loadConfig(storeRoot).lastSeen[projectId] ?? 0
//      persistLastSeen: (g) => updateLastSeen(storeRoot, projectId, g)
//      exportBundle: () => exportBrain({ registry, projectId, createdAt: new Date(input.now()).toISOString() })
//      importBundle: (text) => { const report = importBrain({ registry, projectId, bundleText: text, newId: () => randomUUID() });
//                                input.stdout(`merged: +${report.imported.memories} memories (suggested), +${report.imported.rules} rules, +${report.imported.failures} failures`); }
//      now: () => new Date(input.now())
```

`init.ts` — `runBrainSyncInit(input): Promise<number>`:
1. `gate(...)` → false ⇒ return 0.
2. Lazy-import brain-sync; `assertSafeEndpoint(endpoint)`; `normalizePrefix(prefix)`.
3. Keyfile exists && !(`reset` && `force`) ⇒ stderr `keyfile already exists — pass --reset --force to regenerate (DESTRUCTIVE: old remote data becomes unreadable)`, return 1.
4. Key: `--join` ⇒ `decodeRecoveryCode(join)`; `--keyfile <path>` ⇒ `loadKeyfile(path)`; else `generateKey()`.
5. `createTransport({endpoint, region, bucket, prefix, pathStyle})`; `probeConditionalWrites` → false ⇒ stderr single-line `endpoint does not enforce conditional writes — refusing to sync against it`, return 1 (config NOT written).
6. `saveKeyfile(keyfilePath(storeRoot), key)`; `saveConfig(storeRoot, {schemaVersion:1, endpoint, bucket, prefix, region, pathStyle, conditionalWritesVerified: true, lastSeen: {}})`.
7. Generated key (not join): print recovery code + `"Store this recovery code now — it will not be shown again."`.
8. Catch `BrainSyncError` → stderr `err.message`, return 1.

`reset.ts` — `runBrainSyncReset(input): Promise<number>`:
1. Gate → 0. 2. `--force` missing ⇒ stderr warning (plain language: permanently deletes the remote manifest for `<project>`; its history becomes unreadable), return 1. 3. Build context (config+key+project transport), `transport.deleteObject(MANIFEST_KEY)`, print `remote manifest deleted — next push starts a new chain at generation 1`, return 0.

citty command defs (in the same files, mirroring `brainExportCommand`):
`brainSyncInitCommand` args: `endpoint` (string, required), `bucket` (string, required), `prefix` (string, default `"megasaver-brain"`), `region` (string, default `"auto"`), `pathStyle` (boolean, default true), `join` (string), `keyfile` (string), `reset` (boolean), `force` (boolean), `store` (string). `brainSyncResetCommand` args: `projectName` positional required, `force` boolean, `store` string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test brain-sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/brain/sync apps/cli/package.json apps/cli/test/brain-sync.test.ts packages/brain-sync/test/helpers/s3-double.ts
git commit -m "feat(cli): mega brain sync init/reset with probe gate"
```

---

### Task 13: CLI — sync/push/pull/status + registration

**Files:**
- Create: `apps/cli/src/commands/brain/sync/ops.ts`, `index.ts`
- Modify: `apps/cli/src/commands/brain/index.ts` (add `sync` to `subCommands`)
- Test: append to `apps/cli/test/brain-sync.test.ts`

- [ ] **Step 1: Append failing tests**

Real tests for (same fixtures as Task 12):
- `push <project>` on an entitled store with one approved project-scoped memory → exit 0, stdout contains `pushed generation 1`; double store has manifest + one object under `<prefix><projectId>/`.
- `pull <project>` on a second store (joined key) → exit 0, stdout contains the merged counts line and `suggested — run: mega memory approve` (mirror import.ts messaging).
- `status <project>` → stdout shows `remote generation`, `last seen`, `up to date: yes|no`; exit 0.
- bare `sync <project>` behaves as push flow (merged-then-published).
- runtime `BrainSyncError` (e.g. wrong key) → exit 1, single-line stderr.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @megasaver/cli test brain-sync`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

`ops.ts` — `runBrainSyncPush/Pull/Status(input): Promise<number>`: gate →
build context → call engine `push`/`pull`/`status` → render:
```
pushed generation 3 (merged remote changes first)   | push {state:"pushed",merged:true}
already up to date (generation 3)                   | {state:"up-to-date"}
merged remote generation 3 — imported entries are suggested; run: mega memory approve
remote is empty — run `mega brain sync push <project>` first   | pull {state:"empty"}
remote generation: 3 / last seen: 3 / up to date: yes / updated: <iso>
```
Catch `BrainSyncError` → stderr message, return 1.

`sync/index.ts`:
```ts
import { defineCommand } from "citty";
// import the four command defs

export const brainSyncCommand = defineCommand({
  meta: { name: "sync", description: "Sync the project brain through your own S3-compatible bucket (Pro)" },
  subCommands: {
    init: brainSyncInitCommand,
    push: brainSyncPushCommand,
    pull: brainSyncPullCommand,
    status: brainSyncStatusCommand,
    reset: brainSyncResetCommand,
  },
  args: { projectName: { type: "positional", required: false, description: "project to sync (bare form = safe push)" }, store: { type: "string" } },
  async run({ args }) {
    // bare `mega brain sync <project>` = push flow; missing projectName → usage error exit 1
  },
});
```

`brain/index.ts`: add `sync: brainSyncCommand` to `subCommands` and re-export.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @megasaver/cli test brain-sync && pnpm --filter @megasaver/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/brain apps/cli/test/brain-sync.test.ts
git commit -m "feat(cli): mega brain sync push/pull/status wired to engine"
```

---

### Task 14: Two-machine integration (real core registries)

**Files:**
- Test: `apps/cli/test/brain-sync.two-machine.test.ts`

**Before coding:** mirror registry/project/memory seeding from the existing
brain tests: `ls apps/cli/test | grep brain` and
`grep -rn "createMemoryEntry\|approve" apps/cli/test packages/core/test | head -20`.

- [ ] **Step 1: Write the scenario test**

One test file, one `describe`, sequential `it`s sharing a double + two temp
store roots (A and B), each with a valid license fixture:
1. **A init** (generated key; capture recovery code by regexing A's stdout for `/([A-Z2-7]{5}-){10}[A-Z2-7]{5}/`).
2. **A seeds** a project + one approved project-scoped memory via the core registry (mirrored seeding), then `push` → generation 1.
3. **B init --join <code>** → keyfiles byte-identical (`readFileSync` both, compare).
4. **B pull** → merged; B's registry now holds the memory with `approval: "suggested"` (assert via registry read, mirroring how brain-import tests assert).
5. **Skip-unchanged:** B `push` right after pull with no local changes → `already up to date` (bundle hashes equal ⇒ no generation bump). NOTE: this holds only if B's export of the just-imported suggested entries produces a byte-identical bundle to A's; exportBrain exports only APPROVED memories, so B's export (no approved memories) will NOT equal A's bundle — expect instead `pushed generation 2` and A pulling it back shows A's own memory skipped by dedupe. Write the assertion to match the REAL semantics: B push → generation 2; A pull → `merged`, dedupe skips (assert A's registry memory count unchanged, `skipped.memories ≥ 1` in stdout).
6. **CAS conflict:** A and B both push after divergent local seeds, B's transport wrapped to trigger A's push mid-flight (same wrap technique as the Task 10 unit test, at the CLI layer inject via env-pointed double manipulation — simplest: run raw engine `push` for the race arm using the same store's context). Assert one retry occurred and final generation is consistent on both after each runs `sync` once more.
7. Capture the full stdout transcript of steps 1–6 into `docs/superpowers/evidence/2026-07-11-brain-sync-two-machine.txt` via the test writing the collected lines (this file is the tracer/verifier evidence input).

- [ ] **Step 2: Run it**

Run: `pnpm --filter @megasaver/cli test two-machine`
Expected: PASS deterministically (run 3× to check for flakes: `for i in 1 2 3; do pnpm --filter @megasaver/cli test two-machine || break; done`).

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/brain-sync.two-machine.test.ts docs/superpowers/evidence/2026-07-11-brain-sync-two-machine.txt
git commit -m "test(cli): two-machine brain sync integration incl cas race"
```

---

### Task 15: Changeset, bundle impact, docs, full verify

**Files:**
- Create: `.changeset/brain-sync.md`
- Modify: `wiki/index.md` (entities line), `wiki/log.md` (append), `wiki/syntheses/post-2.0-growth-portfolio.md` (status)
- Create: `wiki/entities/brain-sync.md`

- [ ] **Step 1: Changeset**

`.changeset/brain-sync.md`:
```md
---
"@megasaver/brain-sync": minor
"@megasaver/cli": minor
---

`mega brain sync` — E2E-encrypted sync of the portable project brain
through the user's own S3-compatible bucket (Mega Saver Pro).
`init` verifies the endpoint enforces conditional writes and generates a
keyfile + one-time recovery code; `sync/push/pull/status/reset <project>`
run a CAS-protected manifest protocol; all content is AES-256-GCM
encrypted client-side — the provider only ever sees ciphertext.
```

- [ ] **Step 2: Bundle impact**

```bash
pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli bundle 2>/dev/null || pnpm bundle
ls -la apps/cli/dist-bundle/mega.mjs
```
Compare against the 2.0 baseline (~12.2 MB). If growth > 2 MB, apply the
`bundle-externalize-native-chain` precedent (`wiki/decisions/bundle-externalize-native-chain.md`):
add `@aws-sdk/client-s3` to the bundle externals + cli `optionalDependencies`, re-measure, and record the decision in the wiki entity page. Either way, note the numbers in the PR body.

- [ ] **Step 3: Wiki**

`wiki/entities/brain-sync.md` (≤50 lines, cite spec/plan), one-line entity
entry in `wiki/index.md`, status flip in
`wiki/syntheses/post-2.0-growth-portfolio.md` (E7 → implemented, pending
review gauntlet), timestamped `wiki/log.md` entry.

- [ ] **Step 4: Full gate**

Run: `pnpm verify`
Expected: exit 0 (biome + tsc -b + all package vitest + conventions:check).
Fix anything red before proceeding (biome will likely reformat JSON arrays
in the new package.json files — run `pnpm lint:fix` first).

- [ ] **Step 5: Commit**

```bash
git add .changeset/brain-sync.md wiki docs
git commit -m "docs(brain-sync): changeset + wiki entity + bundle note"
```

---

### Task 16: CRITICAL review gauntlet + smoke + user confirmation (gate — no merge before ALL pass)

- [ ] **Step 1: Smoke evidence (real endpoint)**

Preferred: local MinIO (`docker run --rm -p 9000:9000 minio/minio server /data`, creds `minioadmin`/`minioadmin`, create bucket via `mc` or the console) — or a real R2 bucket with user-provided `MEGA_SYNC_ACCESS_KEY_ID`/`MEGA_SYNC_SECRET_ACCESS_KEY`. Capture a terminal session:
```bash
export MEGA_SYNC_ACCESS_KEY_ID=... MEGA_SYNC_SECRET_ACCESS_KEY=...
node apps/cli/dist/main.js brain sync init --endpoint http://127.0.0.1:9000 --bucket mega-test --store /tmp/smokeA
node apps/cli/dist/main.js brain sync push <project> --store /tmp/smokeA
node apps/cli/dist/main.js brain sync init --join <code> --endpoint http://127.0.0.1:9000 --bucket mega-test --store /tmp/smokeB
node apps/cli/dist/main.js brain sync pull <project> --store /tmp/smokeB
node apps/cli/dist/main.js brain sync status <project> --store /tmp/smokeB
```
Save transcript to `docs/superpowers/evidence/2026-07-11-brain-sync-smoke.txt`. It must show: probe result, recovery code redacted by hand (`XXXXX-…`), generations, suggested-merge counts. Name the provider(s) tested (spec requirement).

- [ ] **Step 2: Review gauntlet (fresh contexts, author ≠ reviewer)**

Dispatch sequentially, fixing findings between passes; re-run `pnpm verify` after each fix round:
1. `code-reviewer` pass over the full branch diff.
2. `critic` adversarial pass (separate context).
3. Security-focused pass (crypto + secrets handling; use the security-reviewer agent if available, else a fresh critic with the spec's threat model as the checklist).
4. Tracer evidence loop on the CAS race: the Task 10 race tests + Task 14 transcript are the evidence; reviewer must confirm the 412→retry→converge chain from artifacts, not narrative.

- [ ] **Step 3: Verifier + user confirmation**

Run verifier (`omc:verify` equivalent) against the DoD checklist (spec §Testing & evidence). Then present to the user: smoke transcript + bundle numbers + review verdicts, and request the explicit release approval required by the spec's "Manual user confirmation" section. NO MERGE before that approval.

- [ ] **Step 4: Finish branch**

Use `superpowers:finishing-a-development-branch`: rebase on origin/main, `pnpm verify`, PR with template, link spec + plan + evidence files.

---

## Self-review notes (already applied)

- Task 3 note folds `decrypt_failed` into the error union — `readRemote`
  (Task 9) depends on it; do not skip.
- Task 14 step 5 documents the REAL skip-unchanged semantics across two
  machines (approved-only export means B's bundle ≠ A's); the
  single-machine skip-unchanged property is covered in Task 10.
- Type names used across tasks: `SyncDeps`, `Transport`, `PutCondition`,
  `BrainSyncConfig`, `SyncManifest`, `PullResult/PushResult/StatusResult` —
  defined once (Tasks 5/6/8/9) and imported elsewhere; no drift.
```
