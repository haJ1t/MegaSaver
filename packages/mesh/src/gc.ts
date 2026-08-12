import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { meshPaths } from "./paths.js";
import { DEAD_AFTER_MS, EVENTS_MAX_AGE_MS, EVENTS_MAX_BYTES, quarantineFileSync } from "./store.js";
import { claimRecordSchema } from "./types.js";
import { presenceRecordSchema } from "./types.js";

export function gc(storeRoot: string): {
  expiredPresence: number;
  expiredClaims: number;
  rotated: boolean;
} {
  let expiredPresence = 0;
  let expiredClaims = 0;
  let rotated = false;
  const nowMs = Date.now();
  const { presenceDir, claimsDir, eventsPath } = meshPaths(storeRoot);

  // sweep 1: dead presence (>10m)
  if (existsSync(presenceDir)) {
    let files: string[] = [];
    try {
      files = readdirSync(presenceDir);
    } catch {}
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(presenceDir, file);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantineFileSync(filePath, storeRoot);
        continue;
      }
      const result = presenceRecordSchema.safeParse(parsed);
      if (!result.success) {
        quarantineFileSync(filePath, storeRoot);
        continue;
      }
      let age = nowMs - Date.parse(result.data.lastSeenAt);
      if (Number.isNaN(age)) age = 0;
      if (age < 0) age = 0;
      if (age > DEAD_AFTER_MS) {
        try {
          rmSync(filePath, { force: true });
          expiredPresence += 1;
        } catch {}
      }
    }
  }

  // sweep 2: expired claims (expiresAt <= now)
  if (existsSync(claimsDir)) {
    let files: string[] = [];
    try {
      files = readdirSync(claimsDir);
    } catch {}
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(claimsDir, file);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantineFileSync(filePath, storeRoot);
        continue;
      }
      const result = claimRecordSchema.safeParse(parsed);
      if (!result.success) {
        quarantineFileSync(filePath, storeRoot);
        continue;
      }
      const expiresMs = Date.parse(result.data.expiresAt);
      if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) {
        try {
          rmSync(filePath, { force: true });
          expiredClaims += 1;
        } catch {}
      }
    }
  }

  // sweep 3: events.jsonl rotation >5MB or >7d
  if (existsSync(eventsPath)) {
    let shouldRotate = false;
    let statSize = 0;
    let statMtime = 0;
    try {
      const stat = statSync(eventsPath);
      statSize = stat.size;
      statMtime = stat.mtimeMs;
    } catch {}
    if (statSize > EVENTS_MAX_BYTES) {
      shouldRotate = true;
    } else if (statMtime !== 0 && nowMs - statMtime > EVENTS_MAX_AGE_MS) {
      shouldRotate = true;
    } else {
      // also check oldest event's createdAt >7d (if file mtime not reliable, e.g., manually written)
      try {
        const raw = readFileSync(eventsPath, "utf8");
        const firstLine = raw.split("\n").find((l) => l.trim() !== "");
        if (firstLine) {
          const parsed = JSON.parse(firstLine);
          const evtMs = Date.parse(parsed.createdAt ?? parsed.at ?? "");
          if (!Number.isNaN(evtMs) && nowMs - evtMs > EVENTS_MAX_AGE_MS) {
            shouldRotate = true;
          }
        }
      } catch {}
    }
    if (shouldRotate) {
      try {
        const dir = dirname(eventsPath);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const rotatedPath = join(dir, `events-${nowMs}.jsonl`);
        renameSync(eventsPath, rotatedPath);
        // create new empty file
        writeFileSync(eventsPath, "", { mode: 0o600 });
        rotated = true;
      } catch {}
    }
  }

  return { expiredPresence, expiredClaims, rotated };
}
