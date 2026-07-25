import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Every JSONL under the store is owner-only: the event stream reveals what the
// agent read and ran, and it sits beside the captured prompt. The two chmods
// are the backstop — mkdir's mode is a no-op on a dir that already exists, and
// appendFileSync's mode is ignored when the file already exists, so without
// them an install created before this fix (or by a sibling writer) stays
// world-readable forever.
export function appendPrivateLine(path: string, line: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  appendFileSync(path, line, { mode: 0o600 });
  chmodSync(path, 0o600);
}
