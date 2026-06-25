# Context daemon — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a machine-wide local context daemon with a discovery file, a singleton lock, token-authenticated loopback HTTP, and a lazy-spawn client — no engine yet.

**Architecture:** New library package `@megasaver/daemon` holds the server, the discovery/lock files, and the shared client. The runnable entry is `mega daemon serve` (mirrors `mega proxy start`). Clients (MCP server + hook, later phases) call `getDaemon()`, which connects to a running daemon or spawns one and waits for it.

**Tech Stack:** Node 22, TypeScript strict ESM, `node:http`, `node:child_process`, zod (boundary validation), Vitest, citty (CLI), tsup.

**Scope:** This is **Phase 1 of 7** from `docs/superpowers/specs/2026-06-25-context-daemon-design.md`. Phases 2–7 (engine `/excerpt` + `/expand`, `/exec`, session memory + `/recall`, `mcp-bridge` refactor, hook refactor, GUI) each get their own plan referencing this phase's real code.

**Risk:** HIGH (loopback service + lazy spawn + a `/shutdown` control). Work in a worktree, never on `main`.

---

## File structure

```
packages/daemon/
├─ package.json            # @megasaver/daemon (new)
├─ tsconfig.json
├─ tsup.config.ts
├─ vitest.config.ts
├─ src/
│  ├─ paths.ts             # daemonDir / discoveryPath / lockPath
│  ├─ discovery.ts         # read/write/clear daemon.json (zod schema)
│  ├─ lock.ts              # singleton lockfile (exclusive create)
│  ├─ server.ts            # startDaemonServer — http + token auth + /status + /shutdown
│  ├─ spawn.ts             # daemonSpawnArgs (pure) + spawnDaemon (detached)
│  ├─ client.ts            # getDaemon — connect-or-spawn + DaemonHandle
│  └─ index.ts             # public exports
└─ test/
   ├─ paths.test.ts
   ├─ discovery.test.ts
   ├─ lock.test.ts
   ├─ server.test.ts
   ├─ spawn.test.ts
   └─ client.test.ts

apps/cli/src/commands/daemon/
├─ index.ts                # daemonCommand (subCommands: serve)
└─ serve.ts               # daemonServeCommand
apps/cli/src/main.ts       # register daemon: daemonCommand        (modify)
apps/cli/package.json      # add @megasaver/daemon dep             (modify)
apps/cli/test/dependency-graph.test.ts  # allow-list += daemon     (modify)
```

The store-root layout this phase adds: `<storeRoot>/daemon/daemon.json` and `<storeRoot>/daemon/daemon.lock`.

---

## Task 1: Scaffold `@megasaver/daemon`

**Files:**
- Create: `packages/daemon/package.json`
- Create: `packages/daemon/tsconfig.json`
- Create: `packages/daemon/tsup.config.ts`
- Create: `packages/daemon/vitest.config.ts`
- Create: `packages/daemon/src/index.ts`

- [ ] **Step 1: Create `packages/daemon/package.json`**

```json
{
  "name": "@megasaver/daemon",
  "version": "0.0.0",
  "private": true,
  "description": "Machine-wide local context daemon: discovery, singleton lock, loopback HTTP, lazy-spawn client.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
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
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.19.17"
  }
}
```

- [ ] **Step 2: Create `packages/daemon/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "incremental": false,
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 3: Create `packages/daemon/tsup.config.ts`**

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

- [ ] **Step 4: Create `packages/daemon/vitest.config.ts`**

Copy the exact contents of `packages/llm-proxy/vitest.config.ts` (same test runner config, no per-package divergence). If that file does not exist, use:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `packages/daemon/src/index.ts` (placeholder export so the build has an entry)**

```ts
export const DAEMON_PACKAGE = "@megasaver/daemon";
```

- [ ] **Step 6: Install and verify the package resolves**

Run: `pnpm install`
Expected: lockfile updates, `@megasaver/daemon` recognized as a workspace package, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon
git commit -m "chore(daemon): scaffold @megasaver/daemon package"
```

---

## Task 2: `paths.ts`

**Files:**
- Create: `packages/daemon/src/paths.ts`
- Test: `packages/daemon/test/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { daemonDir, discoveryPath, lockPath } from "../src/paths.js";

describe("daemon paths", () => {
  it("nests daemon files under <storeRoot>/daemon", () => {
    expect(daemonDir("/s")).toBe("/s/daemon");
    expect(discoveryPath("/s")).toBe("/s/daemon/daemon.json");
    expect(lockPath("/s")).toBe("/s/daemon/daemon.lock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/paths.test.ts`
Expected: FAIL — cannot find module `../src/paths.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { join } from "node:path";

export function daemonDir(storeRoot: string): string {
  return join(storeRoot, "daemon");
}

export function discoveryPath(storeRoot: string): string {
  return join(daemonDir(storeRoot), "daemon.json");
}

export function lockPath(storeRoot: string): string {
  return join(daemonDir(storeRoot), "daemon.lock");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/paths.ts packages/daemon/test/paths.test.ts
git commit -m "feat(daemon): resolve discovery and lock file paths"
```

---

## Task 3: `discovery.ts`

**Files:**
- Create: `packages/daemon/src/discovery.ts`
- Test: `packages/daemon/test/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiscovery, readDiscovery, writeDiscovery } from "../src/discovery.js";
import { discoveryPath } from "../src/paths.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-disc-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("discovery", () => {
  it("round-trips a record", () => {
    writeDiscovery(store, { port: 1234, token: "t", pid: 99, startedAt: "2026-06-25T00:00:00Z" });
    expect(readDiscovery(store)).toEqual({
      port: 1234,
      token: "t",
      pid: 99,
      startedAt: "2026-06-25T00:00:00Z",
    });
  });

  it("returns null when the file is missing", () => {
    expect(readDiscovery(store)).toBeNull();
  });

  it("returns null when the file is corrupt", () => {
    writeFileSync(discoveryPath(store), "not json");
    expect(readDiscovery(store)).toBeNull();
  });

  it("clear removes the file", () => {
    writeDiscovery(store, { port: 1, token: "t", pid: 1, startedAt: "x" });
    clearDiscovery(store);
    expect(readDiscovery(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/discovery.test.ts`
Expected: FAIL — cannot find module `../src/discovery.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { discoveryPath } from "./paths.js";

export const discoverySchema = z.object({
  port: z.number().int().positive(),
  token: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
});

export type Discovery = z.infer<typeof discoverySchema>;

export function writeDiscovery(storeRoot: string, record: Discovery): void {
  const path = discoveryPath(storeRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

// Missing or corrupt file → null. Callers treat null as "no daemon advertised".
export function readDiscovery(storeRoot: string): Discovery | null {
  try {
    return discoverySchema.parse(JSON.parse(readFileSync(discoveryPath(storeRoot), "utf8")));
  } catch {
    return null;
  }
}

export function clearDiscovery(storeRoot: string): void {
  rmSync(discoveryPath(storeRoot), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/discovery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/discovery.ts packages/daemon/test/discovery.test.ts
git commit -m "feat(daemon): read/write/clear the discovery file"
```

---

## Task 4: `lock.ts` (singleton)

**Files:**
- Create: `packages/daemon/src/lock.ts`
- Test: `packages/daemon/test/lock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-lock-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("grants the lock to the first caller and refuses the second", () => {
    const release = acquireLock(store);
    expect(release).not.toBeNull();
    expect(acquireLock(store)).toBeNull();
  });

  it("releasing allows re-acquisition", () => {
    const release = acquireLock(store);
    expect(release).not.toBeNull();
    release?.();
    expect(acquireLock(store)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/lock.test.ts`
Expected: FAIL — cannot find module `../src/lock.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { lockPath } from "./paths.js";

// Exclusive create ("wx") is the singleton primitive: only one process wins the
// race to create the lock file; everyone else gets EEXIST → null. A stale lock
// from a crashed daemon is reaped by the client (it pings discovery; a dead
// daemon means the client clears discovery + lock before spawning).
export function acquireLock(storeRoot: string): (() => void) | null {
  const path = lockPath(storeRoot);
  mkdirSync(dirname(path), { recursive: true });
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    return null;
  }
  return () => rmSync(path, { force: true });
}

export function clearLock(storeRoot: string): void {
  rmSync(lockPath(storeRoot), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/lock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/lock.ts packages/daemon/test/lock.test.ts
git commit -m "feat(daemon): singleton lockfile via exclusive create"
```

---

## Task 5: `server.ts` (loopback HTTP + token auth)

**Files:**
- Create: `packages/daemon/src/server.ts`
- Test: `packages/daemon/test/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDiscovery } from "../src/discovery.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let daemon: RunningDaemon | null;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-srv-"));
  daemon = null;
});
afterEach(async () => {
  await daemon?.close();
  rmSync(store, { recursive: true, force: true });
});

describe("startDaemonServer", () => {
  it("listens on loopback, advertises discovery, and serves /status with the token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    expect(daemon.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const disc = readDiscovery(store);
    expect(disc?.port).toBe(daemon.port);
    expect(disc?.token).toBe("secret");

    const ok = await fetch(`${daemon.url}/status`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  it("rejects a request with a wrong or missing token (401)", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    expect((await fetch(`${daemon.url}/status`)).status).toBe(401);
    expect(
      (await fetch(`${daemon.url}/status`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });

  it("clears discovery on close", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    await daemon.close();
    daemon = null;
    expect(readDiscovery(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/server.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { clearDiscovery, writeDiscovery } from "./discovery.js";

// Hard-coded: the daemon executes shell commands and reads files on behalf of
// the agent, so it must never bind beyond loopback. No host override.
const LOOPBACK = "127.0.0.1";

export type StartDaemonOptions = {
  storeRoot: string;
  /** Default 0 → random free port. */
  port?: number;
  /** Default: a fresh random token. */
  token?: string;
  now?: () => string;
};

export type RunningDaemon = {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
};

export function startDaemonServer(opts: StartDaemonOptions): Promise<RunningDaemon> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  const now = opts.now ?? (() => new Date().toISOString());

  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: [], totals: {} }));
      return;
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(202);
      res.end();
      void close();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      clearDiscovery(opts.storeRoot);
      server.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, LOOPBACK, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : (opts.port ?? 0);
      writeDiscovery(opts.storeRoot, { port, token, pid: process.pid, startedAt: now() });
      resolve({ url: `http://${LOOPBACK}:${port}`, port, token, close });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/test/server.test.ts
git commit -m "feat(daemon): loopback http server with token auth + discovery"
```

---

## Task 6: `spawn.ts` (detached spawn + pure argv)

**Files:**
- Create: `packages/daemon/src/spawn.ts`
- Test: `packages/daemon/test/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { daemonSpawnArgs } from "../src/spawn.js";

describe("daemonSpawnArgs", () => {
  it("invokes `mega daemon serve --store <root>` by default", () => {
    expect(daemonSpawnArgs("/s", {})).toEqual({
      cmd: "mega",
      args: ["daemon", "serve", "--store", "/s"],
    });
  });

  it("honors MEGA_DAEMON_CMD override", () => {
    expect(daemonSpawnArgs("/s", { MEGA_DAEMON_CMD: "/abs/mega" }).cmd).toBe("/abs/mega");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/spawn.test.ts`
Expected: FAIL — cannot find module `../src/spawn.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { spawn } from "node:child_process";

// Pure: the argv is unit-tested; spawnDaemon just runs it. MEGA_DAEMON_CMD lets
// tests/dev point at a built binary or a stub instead of the global `mega`.
export function daemonSpawnArgs(
  storeRoot: string,
  env: NodeJS.ProcessEnv,
): { cmd: string; args: string[] } {
  return {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    cmd: env["MEGA_DAEMON_CMD"] ?? "mega",
    args: ["daemon", "serve", "--store", storeRoot],
  };
}

// Detached + unref so the daemon outlives the client that spawned it.
export function spawnDaemon(storeRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const { cmd, args } = daemonSpawnArgs(storeRoot, env);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/spawn.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/spawn.ts packages/daemon/test/spawn.test.ts
git commit -m "feat(daemon): detached spawn of `mega daemon serve`"
```

---

## Task 7: `client.ts` (connect-or-spawn)

**Files:**
- Create: `packages/daemon/src/client.ts`
- Test: `packages/daemon/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeDiscovery } from "../src/discovery.js";
import { getDaemon } from "../src/client.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let servers: RunningDaemon[];
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-cli-"));
  servers = [];
});
afterEach(async () => {
  for (const s of servers) await s.close();
  rmSync(store, { recursive: true, force: true });
});

// Injected "spawn" starts an in-process daemon instead of a subprocess.
const inProcessSpawn = (root: string) => {
  void startDaemonServer({ storeRoot: root, port: 0 }).then((s) => servers.push(s));
};

describe("getDaemon", () => {
  it("connects to an already-running daemon without spawning", async () => {
    const running = await startDaemonServer({ storeRoot: store, port: 0, token: "live" });
    servers.push(running);
    let spawned = false;
    const handle = await getDaemon({
      storeRoot: store,
      spawn: () => {
        spawned = true;
      },
    });
    expect(spawned).toBe(false);
    const res = await handle.request("GET", "/status");
    expect(res.status).toBe(200);
  });

  it("spawns a daemon when none is running, then connects", async () => {
    const handle = await getDaemon({ storeRoot: store, spawn: inProcessSpawn, waitMs: 3000 });
    const res = await handle.request("GET", "/status");
    expect(res.status).toBe(200);
  });

  it("reaps stale discovery (points at a dead port) before spawning", async () => {
    writeDiscovery(store, { port: 1, token: "dead", pid: 1, startedAt: "x" });
    const handle = await getDaemon({ storeRoot: store, spawn: inProcessSpawn, waitMs: 3000 });
    expect((await handle.request("GET", "/status")).status).toBe(200);
  });

  it("throws if the daemon never comes up", async () => {
    await expect(
      getDaemon({ storeRoot: store, spawn: () => {}, waitMs: 300 }),
    ).rejects.toThrow(/did not come up/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/client.test.ts`
Expected: FAIL — cannot find module `../src/client.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { clearDiscovery, readDiscovery } from "./discovery.js";
import { clearLock } from "./lock.js";
import { spawnDaemon } from "./spawn.js";

export type DaemonHandle = {
  url: string;
  token: string;
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
};

export type GetDaemonOptions = {
  storeRoot: string;
  /** Injectable for tests; defaults to a detached `mega daemon serve`. */
  spawn?: (storeRoot: string) => void;
  /** Total time to wait for a spawned daemon to advertise itself. */
  waitMs?: number;
};

function urlFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function ping(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

function makeHandle(url: string, token: string): DaemonHandle {
  return {
    url,
    token,
    request: (method, path, body) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDaemon(opts: GetDaemonOptions): Promise<DaemonHandle> {
  const { storeRoot } = opts;
  const spawn = opts.spawn ?? spawnDaemon;

  const existing = readDiscovery(storeRoot);
  if (existing && (await ping(urlFor(existing.port), existing.token))) {
    return makeHandle(urlFor(existing.port), existing.token);
  }
  // Stale advertisement (or none): reap before spawning so the new daemon's
  // exclusive lock + discovery write win cleanly.
  if (existing) {
    clearDiscovery(storeRoot);
    clearLock(storeRoot);
  }

  spawn(storeRoot);

  const deadline = Date.now() + (opts.waitMs ?? 5000);
  while (Date.now() < deadline) {
    const disc = readDiscovery(storeRoot);
    if (disc && (await ping(urlFor(disc.port), disc.token))) {
      return makeHandle(urlFor(disc.port), disc.token);
    }
    await sleep(100);
  }
  throw new Error("daemon did not come up in time");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/client.ts packages/daemon/test/client.test.ts
git commit -m "feat(daemon): connect-or-spawn client with stale-discovery reaping"
```

---

## Task 8: Public exports (`index.ts`)

**Files:**
- Modify: `packages/daemon/src/index.ts`

- [ ] **Step 1: Replace the placeholder export with the public surface**

```ts
export { daemonDir, discoveryPath, lockPath } from "./paths.js";
export { type Discovery, clearDiscovery, readDiscovery, writeDiscovery } from "./discovery.js";
export { acquireLock, clearLock } from "./lock.js";
export {
  type RunningDaemon,
  type StartDaemonOptions,
  startDaemonServer,
} from "./server.js";
export { daemonSpawnArgs, spawnDaemon } from "./spawn.js";
export { type DaemonHandle, type GetDaemonOptions, getDaemon } from "./client.js";
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @megasaver/daemon exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full package test suite**

Run: `pnpm --filter @megasaver/daemon test`
Expected: all tests pass (paths, discovery, lock, server, spawn, client).

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/src/index.ts
git commit -m "feat(daemon): export public surface"
```

---

## Task 9: CLI `mega daemon serve`

**Files:**
- Create: `apps/cli/src/commands/daemon/serve.ts`
- Create: `apps/cli/src/commands/daemon/index.ts`
- Modify: `apps/cli/src/main.ts` (import + register `daemon`)
- Modify: `apps/cli/package.json` (add `@megasaver/daemon`)
- Modify: `apps/cli/test/dependency-graph.test.ts` (allow-list += daemon)

- [ ] **Step 1: Write the failing dependency-graph allow-list test change**

In `apps/cli/test/dependency-graph.test.ts`, add `"@megasaver/daemon",` to `ALLOWED_MEGA_DEPENDENCIES` (keep it alphabetical — between `content-store` and `indexer`):

```ts
  "@megasaver/core",
  "@megasaver/daemon",
  "@megasaver/indexer",
```

- [ ] **Step 2: Add the dependency to `apps/cli/package.json`**

Add to `dependencies` (mirror the existing `@megasaver/llm-proxy` line):

```json
    "@megasaver/daemon": "workspace:*",
```

- [ ] **Step 3: Create `apps/cli/src/commands/daemon/serve.ts`**

```ts
import { acquireLock, startDaemonServer } from "@megasaver/daemon";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export const daemonServeCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Run the local Mega Saver context daemon (machine-wide singleton).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const release = acquireLock(storeRoot);
    if (!release) {
      console.log("mega daemon already running (lock held)");
      return;
    }
    const running = await startDaemonServer({ storeRoot });
    console.log(`mega daemon listening on ${running.url}`);
    const shutdown = (): void => {
      release();
      void running.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // The listening server keeps the event loop alive until a signal arrives.
  },
});
```

- [ ] **Step 4: Create `apps/cli/src/commands/daemon/index.ts`**

```ts
import { defineCommand } from "citty";
import { daemonServeCommand } from "./serve.js";

export const daemonCommand = defineCommand({
  meta: { name: "daemon", description: "Local Mega Saver context daemon (intent excerpts + memory)." },
  subCommands: {
    serve: daemonServeCommand,
  },
});
```

- [ ] **Step 5: Register the command in `apps/cli/src/main.ts`**

Add the import near the other command imports (after the `proxyCommand` import at line ~18):

```ts
import { daemonCommand } from "./commands/daemon/index.js";
```

Add to the `subCommands` object (after `proxy: proxyCommand,` at line ~50):

```ts
    daemon: daemonCommand,
```

- [ ] **Step 6: Install so the new workspace dep links**

Run: `pnpm install`
Expected: exit 0; `@megasaver/daemon` linked into `apps/cli`.

- [ ] **Step 7: Run the dependency-graph test**

Run: `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts`
Expected: PASS — `@megasaver/daemon` is now in the allow-list, no cycle.

- [ ] **Step 8: Smoke the command (build the CLI, then serve + ping)**

Run:
```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/index.js daemon serve --store /tmp/mega-daemon-smoke &
sleep 1
cat /tmp/mega-daemon-smoke/daemon/daemon.json
```
Expected: a `daemon.json` with `port` and `token`; the process logged `mega daemon listening on http://127.0.0.1:<port>`. Then kill it:
```bash
kill %1
```
(The smoke entry path may be `dist-bundle/mega.mjs` instead of `dist/index.js` — use whichever the build produced.)

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/commands/daemon apps/cli/src/main.ts apps/cli/package.json apps/cli/test/dependency-graph.test.ts pnpm-lock.yaml
git commit -m "feat(cli): mega daemon serve (singleton, lazy-spawn target)"
```

---

## Task 10: Phase verification

- [ ] **Step 1: Run the full verify gate**

Run: `pnpm verify`
Expected: biome clean, tsc clean, all tests pass (including the new daemon suite + cli dependency-graph), conventions check passes.

- [ ] **Step 2: Confirm the phase deliverable end to end**

Run (from repo root, with the CLI built):
```bash
MEGA_DAEMON_CMD="node $(pwd)/apps/cli/dist/index.js" node -e '
import("@megasaver/daemon").then(async ({ getDaemon }) => {
  const h = await getDaemon({ storeRoot: "/tmp/mega-daemon-e2e", waitMs: 8000 });
  const r = await h.request("GET", "/status");
  console.log("status", r.status, await r.json());
  await h.request("POST", "/shutdown");
});
'
```
Expected: `status 200 { ok: true, sessions: [], totals: {} }` — proving connect-or-spawn against a real subprocess daemon. (Adjust the entry path if the build emits `dist-bundle/mega.mjs`.)

- [ ] **Step 3: Final phase commit (if any verify fixes were needed)**

```bash
git add -A
git commit -m "chore(daemon): phase 1 verification fixes"
```

---

## Self-review (completed by plan author)

- **Spec coverage (Phase 1 slice):** discovery file ✓ (Tasks 3), singleton lock ✓ (Task 4), loopback HTTP + token ✓ (Task 5), lazy spawn + connect-or-spawn client ✓ (Tasks 6–7), `mega daemon serve` entry ✓ (Task 9). Engine, `/exec`, session memory, `/recall`, client refactors, and GUI are explicitly **out of Phase 1** and deferred to Phases 2–7.
- **Type consistency:** `Discovery` (port/token/pid/startedAt) is defined in Task 3 and consumed unchanged by `server.ts` (Task 5), `client.ts` (Task 7); `RunningDaemon` (url/port/token/close) from Task 5 is used by Task 7's in-process spawn; `DaemonHandle.request(method, path, body)` defined Task 7 is exercised in Tasks 7 & 10.
- **Placeholder scan:** none — every code/test/command step is concrete.
- **Deferred-by-design (noted, not placeholders):** idle-shutdown timer → Phase 2; richer `/status` payload (real sessions/totals) → Phase 4.
```
