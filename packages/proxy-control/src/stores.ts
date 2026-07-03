import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type ProxyControlState,
  type ProxyRuntimeState,
  proxyControlStateSchema,
  proxyRuntimeStateSchema,
} from "./state.js";

// Missing control state means disabled; invalid state fails disabled with an
// offline diagnostic so a corrupt file never reads as enabled.
export const DISABLED_CONTROL_STATE: ProxyControlState = {
  version: 1,
  desiredEnabled: false,
  port: 8787,
  upstreamBaseUrl: "https://api.anthropic.com",
  routeLease: null,
  drainingGeneration: null,
  reconcileBlocked: null,
  transition: null,
  updatedAt: "1970-01-01T00:00:00.000Z",
  lastError: null,
};

function proxyDir(storeRoot: string): string {
  return join(storeRoot, "proxy");
}
function controlPath(storeRoot: string): string {
  return join(proxyDir(storeRoot), "control.json");
}
function runtimePath(storeRoot: string): string {
  return join(proxyDir(storeRoot), "runtime.json");
}

// Read a regular-file leaf; a symlink or non-file is refused (returns null).
function readLeaf(path: string): string | null {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function atomicWrite(storeRoot: string, path: string, value: unknown): void {
  const dir = proxyDir(storeRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    if (process.platform !== "win32") {
      const dfd = openSync(dir, "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    }
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* already renamed */
    }
  }
}

export function readControlState(storeRoot: string): ProxyControlState {
  const raw = readLeaf(controlPath(storeRoot));
  if (raw === null) return DISABLED_CONTROL_STATE;
  try {
    const parsed = proxyControlStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DISABLED_CONTROL_STATE;
  } catch {
    return DISABLED_CONTROL_STATE;
  }
}

export function writeControlState(storeRoot: string, state: ProxyControlState): void {
  atomicWrite(storeRoot, controlPath(storeRoot), proxyControlStateSchema.parse(state));
}

export function readRuntimeState(storeRoot: string): ProxyRuntimeState | null {
  const raw = readLeaf(runtimePath(storeRoot));
  if (raw === null) return null;
  try {
    const parsed = proxyRuntimeStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeRuntimeState(storeRoot: string, state: ProxyRuntimeState): void {
  atomicWrite(storeRoot, runtimePath(storeRoot), proxyRuntimeStateSchema.parse(state));
}
