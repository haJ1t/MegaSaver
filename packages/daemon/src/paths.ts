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
