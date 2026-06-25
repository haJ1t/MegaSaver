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
