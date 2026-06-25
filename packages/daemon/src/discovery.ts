import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The token in this file IS the daemon's auth boundary: any local user who can
// read it can drive a daemon that runs shell commands. Restrict dir to 0o700
// and file to 0o600 (no-op on Windows, where POSIX modes don't apply).
export function writeDiscovery(storeRoot: string, record: Discovery): void {
  const path = discoveryPath(storeRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  chmodSync(path, 0o600);
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
