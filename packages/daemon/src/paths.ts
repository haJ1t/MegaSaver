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

export function meshSocketPath(storeRoot: string): string {
  if (process.platform === "win32") return "\\\\.\\pipe\\megasaver-mesh";
  return join(daemonDir(storeRoot), "mesh.sock");
}
