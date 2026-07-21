import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifact,
  cleanupEvidenceRoots,
  createEvidenceFixture,
  verifier,
  writeEvidence,
} from "./lm2-completion-fixtures.js";

afterEach(cleanupEvidenceRoots);

function duplicateRunArgsInteger(replacement: string) {
  const fixture = createEvidenceFixture();
  const ref = fixture.evidence.runs[0].runArgs;
  const path = join(fixture.root, ref.path);
  const bytes = readFileSync(path, "utf8");
  const replaced = bytes.replace('"max_completion_tokens":20000', replacement);
  expect(replaced).not.toBe(bytes);
  Object.assign(ref, artifact(fixture.root, ref.path, replaced));
  writeEvidence(fixture);
  return fixture;
}

async function loadParser() {
  const module = (await import(
    pathToFileURL(
      join(
        import.meta.dirname,
        "../../../benchmarks/longmemeval-v2/official-evidence-harness-arguments.mjs",
      ),
    ).href
  )) as { parseRunArgsJson: (source: string) => unknown };
  return module.parseRunArgsJson;
}

describe("LM2 official run_args JSON boundary", () => {
  it.each([
    ["exact duplicate", '"max_completion_tokens":20000,"max_completion_tokens":20000'],
    ["noncanonical then canonical", '"max_completion_tokens":2e4,"max_completion_tokens":20000'],
    ["canonical then noncanonical", '"max_completion_tokens":20000,"max_completion_tokens":2e4'],
    ["escaped equivalent", '"max_completi\\u006fn_tokens":2e4,"max_completion_tokens":20000'],
  ])("rejects %s integer keys in the full verifier", (_name, replacement) => {
    const fixture = duplicateRunArgsInteger(replacement);
    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Duplicate JSON object key");
  });

  it.each(['{"nested":{"same":1,"same":2}}', '{"nested":{"sa\\u006de":1,"same":2}}'])(
    "rejects nested duplicate keys before parsing: %s",
    async (source) => {
      const parseRunArgsJson = await loadParser();
      expect(() => parseRunArgsJson(source)).toThrow("Duplicate JSON object key");
    },
  );

  it("ignores escaped quotes and key-like text inside strings", async () => {
    const parseRunArgsJson = await loadParser();
    const source =
      '{"model":"prefix \\"max_completion_tokens\\":2e4 suffix","max_completion_tokens":20000}';

    expect(parseRunArgsJson(source)).toEqual({
      model: 'prefix "max_completion_tokens":2e4 suffix',
      max_completion_tokens: 20_000,
    });
  });
});
