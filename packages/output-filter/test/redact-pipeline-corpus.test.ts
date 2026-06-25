import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

const fixturesDir = fileURLToPath(new URL("./fixtures/redaction", import.meta.url));
const names = readdirSync(fixturesDir).sort();

const surfaceOf = async (raw: string): Promise<{ surface: string; warnedRedaction: boolean }> => {
  const result = await filterOutput({ raw, mode: "safe" });
  const warnedRedaction = (result.warnings ?? []).some((w) => w.includes("redacted"));
  return {
    surface: result.summary + result.excerpts.map((e) => e.text).join("\n"),
    warnedRedaction,
  };
};

describe("redact pipeline corpus (F-MED-1, spec §10)", () => {
  for (const name of names) {
    const dir = `${fixturesDir}/${name}`;
    const input = readFileSync(`${dir}/input.txt`, "utf8");
    const absentPath = `${dir}/expected-absent.txt`;
    const presentPath = `${dir}/expected-present.txt`;

    if (existsSync(absentPath)) {
      it(`${name}: secret token is absent from the filtered result`, async () => {
        const secret = readFileSync(absentPath, "utf8").trim();
        const { surface } = await surfaceOf(input);
        expect(secret.length).toBeGreaterThan(0);
        expect(surface).not.toContain(secret);
      });
    }

    if (existsSync(presentPath)) {
      it(`${name}: benign text survives without a false-positive redaction`, async () => {
        const present = readFileSync(presentPath, "utf8").trim();
        const { surface, warnedRedaction } = await surfaceOf(input);
        expect(surface).toContain(present);
        expect(warnedRedaction).toBe(false);
      });
    }
  }
});
