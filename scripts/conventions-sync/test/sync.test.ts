import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConsumerSpec } from "../src/manifest.ts";
import { runSync } from "../src/sync.ts";

async function writeNested(root: string, relative: string, content: string): Promise<void> {
  const full = join(root, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

const fixtureConsumers: readonly ConsumerSpec[] = [
  {
    id: "demo",
    path: "DEMO.md",
    blocks: [{ id: "mission", source: "mission.md" }],
  },
];

describe("runSync", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mega-conventions-sync-"));
    await mkdir(join(root, "docs/conventions"), { recursive: true });
    await writeFile(join(root, "docs/conventions/mission.md"), "# Mission\n\nfresh mission\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports ok when consumer body already matches the canonical source", async () => {
    await writeNested(
      root,
      "DEMO.md",
      [
        "preface",
        '<!-- conventions:start id="mission" source="mission.md" -->',
        "fresh mission",
        '<!-- conventions:end id="mission" -->',
        "tail",
      ].join("\n"),
    );
    const result = await runSync({
      mode: "check",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(result.status).toBe("ok");
    expect(result.reports[0]?.status).toBe("ok");
  });

  it("reports drift when consumer body diverges from canonical source", async () => {
    await writeNested(
      root,
      "DEMO.md",
      [
        '<!-- conventions:start id="mission" source="mission.md" -->',
        "stale mission",
        '<!-- conventions:end id="mission" -->',
      ].join("\n"),
    );
    const result = await runSync({
      mode: "check",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(result.status).toBe("drift");
    expect(result.reports[0]?.status).toBe("drift");
    expect(result.reports[0]?.diff).toContain("DEMO.md");
    expect(result.reports[0]?.diff).toContain("-stale mission");
    expect(result.reports[0]?.diff).toContain("+fresh mission");
  });

  it("writes drift in write mode and round-trips to ok", async () => {
    await writeNested(
      root,
      "DEMO.md",
      [
        "preface",
        '<!-- conventions:start id="mission" source="mission.md" -->',
        "stale",
        '<!-- conventions:end id="mission" -->',
      ].join("\n"),
    );
    const write = await runSync({
      mode: "write",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(write.reports[0]?.status).toBe("wrote");
    const after = await readFile(join(root, "DEMO.md"), "utf8");
    expect(after).toContain("fresh mission");
    expect(after).toContain("preface");

    const check = await runSync({
      mode: "check",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(check.status).toBe("ok");
  });

  it("reports error when consumer is missing required block", async () => {
    await writeNested(root, "DEMO.md", "no managed block\n");
    const result = await runSync({
      mode: "check",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(result.status).toBe("error");
    expect(result.reports[0]?.status).toBe("error");
    expect(result.reports[0]?.error?.code).toBe("block-malformed");
  });

  it("reports error when consumer file is absent", async () => {
    const result = await runSync({
      mode: "check",
      repoRoot: root,
      conventionsDir: join(root, "docs/conventions"),
      consumers: fixtureConsumers,
    });
    expect(result.reports[0]?.status).toBe("error");
    expect(result.reports[0]?.error?.code).toBe("consumer-missing");
  });
});
