import { describe, expect, it } from "vitest";
import { buildClaimsManifest, packagesForFiles } from "../src/claims.js";
import type { ReceiptCandidate } from "../src/receipts.js";

const candidate = (command: string, exitCode: number | undefined, at: string): ReceiptCandidate => ({
  command,
  ...(exitCode !== undefined ? { exitCode } : {}),
  createdAt: at,
});

describe("claims manifest", () => {
  it("maps touched files to package scopes", () => {
    expect(
      packagesForFiles(["packages/core/src/a.ts", "apps/cli/src/b.ts", "README.md"]),
    ).toEqual(["apps/cli", "packages/core", "repo"]);
  });

  it("attaches the newest matching receipt per scope and lists gaps", () => {
    const manifest = buildClaimsManifest({
      commits: [{ sha: "abc", subject: "feat(core): thing", committedAt: "2026-08-06T09:00:00Z" }],
      changedPaths: ["packages/core/src/a.ts", "packages/stats/src/b.ts"],
      receipts: [
        candidate("pnpm --filter @megasaver/core test", 1, "2026-08-06T08:00:00.000Z"),
        candidate("pnpm --filter @megasaver/core test", 0, "2026-08-06T09:00:00.000Z"),
        candidate("pnpm verify", 0, "2026-08-06T09:30:00.000Z"),
      ],
    });
    const core = manifest.receipts.find((r) => r.scope === "packages/core");
    expect(core?.exitCode).toBe(0); // newest wins
    expect(manifest.receipts.some((r) => r.scope === "repo")).toBe(true);
    expect(manifest.gaps).toEqual(["packages/stats"]); // repo receipt does not clear it
    expect(manifest.claims[0]?.subject).toBe("feat(core): thing");
  });

  it("an exit-less candidate fills its scope without clearing exit evidence", () => {
    const manifest = buildClaimsManifest({
      commits: [],
      changedPaths: ["packages/core/src/a.ts"],
      receipts: [candidate("pnpm --filter @megasaver/core test", undefined, "2026-08-06T09:00:00.000Z")],
    });
    const core = manifest.receipts.find((r) => r.scope === "packages/core");
    expect(core).toBeDefined();
    expect("exitCode" in (core ?? {})).toBe(false); // renders "receipt without exit code"
    expect(manifest.gaps).toEqual([]); // a run happened — not a gap
  });
});
