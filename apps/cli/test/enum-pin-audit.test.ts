import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AA1 §17: every closed enum introduced by the epic has a tuple-ordering pin.
// Structural guard only — per-enum tuple ordering is asserted by the pins
// themselves under `pnpm typecheck` (vitest typecheck mode). This proves none
// was dropped during the BB-series integration.
// Paths are relative to the monorepo root (apps/cli is two levels under root,
// the test file adds a third: test -> cli -> apps -> root). fileURLToPath
// yields a plain filesystem path, so resolve pins with path.join (a bare
// string cannot be a `new URL` base).
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PIN_FILES: ReadonlyArray<readonly [enumName: string, relPath: string]> = [
  ["TokenSaverMode", "packages/shared/test/token-saver-mode.test-d.ts"],
  ["PolicyDenyCode", "packages/policy/test/deny-code.test-d.ts"],
  ["ContentStoreErrorCode", "packages/content-store/test/error-code.test-d.ts"],
  ["RankFeatureName", "packages/output-filter/test/rank-features.test-d.ts"],
  ["OutputSourceKind", "packages/output-filter/test/output-source.test-d.ts"],
  ["DerivedIntentSource", "packages/retrieval/test/intent.test-d.ts"],
  ["McpToolName", "packages/mcp-bridge/test/tool-name.test-d.ts"],
  ["McpBridgeErrorCode", "packages/mcp-bridge/test/errors.test-d.ts"],
];

describe("AA1 §17 closed-enum pin audit", () => {
  it.each(PIN_FILES)("%s pin exists and is non-empty (%s)", (_name, rel) => {
    const abs = join(REPO_ROOT, rel);
    expect(existsSync(abs), `${rel} missing`).toBe(true);
    expect(readFileSync(abs, "utf8").trim().length, `${rel} empty`).toBeGreaterThan(0);
  });

  it("audits exactly the 8 epic enums (no silent add/drop)", () => {
    expect(PIN_FILES).toHaveLength(8);
  });
});
