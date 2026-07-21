import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const freshnessPath = join(
  import.meta.dirname,
  "../../../benchmarks/longmemeval-v2/official-evidence-freshness.mjs",
);

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "megasaver-provenance-"));
  roots.push(root);
  const adapter = join(root, "benchmarks/longmemeval-v2/megasaver_lm2_hybrid.py");
  const transport = join(root, "packages/long-memory/dist/lm2-benchmark.js");
  mkdirSync(join(root, "benchmarks/longmemeval-v2"), { recursive: true });
  mkdirSync(join(root, "packages/long-memory/dist"), { recursive: true });
  writeFileSync(adapter, "adapter\n");
  writeFileSync(transport, "transport\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Evidence Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, adapter, transport, commit };
}

async function provenanceFunction() {
  const module = (await import(pathToFileURL(freshnessPath).href)) as {
    verifyMegaSaverProvenance: (input: {
      repoRoot: string;
      commit: string;
      recordedAdapter: string;
      recordedTransport: string;
      rebuild?: boolean;
    }) => void;
  };
  return module.verifyMegaSaverProvenance;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 evidence commit provenance", () => {
  it("rejects a dirty Mega Saver checkout at the recorded commit", async () => {
    const fixture = repositoryFixture();
    writeFileSync(join(fixture.root, "dirty.txt"), "dirty\n");
    const verify = await provenanceFunction();

    expect(() =>
      verify({
        repoRoot: fixture.root,
        commit: fixture.commit,
        recordedAdapter: fixture.adapter,
        recordedTransport: fixture.transport,
        rebuild: false,
      }),
    ).toThrow(/clean/u);
  });

  it.each([
    ["adapter", "substituted-adapter.py"],
    ["transport", "substituted-transport.js"],
  ])("rejects a %s whose bytes do not come from the recorded commit", async (kind, name) => {
    const fixture = repositoryFixture();
    const substituteRoot = mkdtempSync(join(tmpdir(), "megasaver-substitute-"));
    roots.push(substituteRoot);
    const substituted = join(substituteRoot, name);
    writeFileSync(substituted, "substituted\n");
    const verify = await provenanceFunction();

    expect(() =>
      verify({
        repoRoot: fixture.root,
        commit: fixture.commit,
        recordedAdapter: kind === "adapter" ? substituted : fixture.adapter,
        recordedTransport: kind === "transport" ? substituted : fixture.transport,
        rebuild: false,
      }),
    ).toThrow(new RegExp(kind, "u"));
  });
});
