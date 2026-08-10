import { basename, join } from "node:path";

export function daemonDir(storeRoot: string): string {
  return join(storeRoot, "daemon");
}

export function discoveryPath(storeRoot: string): string {
  return join(daemonDir(storeRoot), "daemon.json");
}

export function lockPath(storeRoot: string): string {
  return join(daemonDir(storeRoot), "daemon.lock");
}

export function meshSocketPath(storeRoot: string): string {
  if (process.platform === "win32") {
    const raw = basename(storeRoot) || "default";
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "default";
    return `\\\\.\\pipe\\megasaver-mesh-${safe}`;
  }
  return join(daemonDir(storeRoot), "mesh.sock");
}
