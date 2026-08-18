import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEGA_SAVER_FENCE_BLOCK_END,
  MEGA_SAVER_FENCE_BLOCK_START,
} from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectorSync } from "../../src/commands/connector/sync.js";

let store: string;
let projectRoot: string;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-fencesync-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-fencesync-root-"));
  mkdirSync(store, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  const ts = "2026-05-09T00:00:00.000Z";
  writeFileSync(
    join(store, "projects.json"),
    JSON.stringify([
      {
        id: PROJECT_ID,
        name: "demo",
        rootPath: projectRoot,
        createdAt: ts,
        updatedAt: ts,
      },
    ]),
  );
  writeFileSync(join(store, "sessions.json"), "[]");
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

const FENCE_YAML = [
  "version: 1",
  "allow:",
  "  - docs/generated/README.md",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "  - path: dist/**",
  "    class: build-output",
  '    reason: "derived: build-output dir on disk"',
  "    mode: deny",
  "",
].join("\n");

function sync(targetFlag?: string, stderrOut?: string[]): Promise<0 | 1> {
  return runConnectorSync({
    projectName: "demo",
    targetFlag,
    storeFlag: store,
    cwd: projectRoot,
    home: tmpdir(),
    xdgDataHome: undefined,
    platform: "darwin",
    localAppData: undefined,
    stdout: () => {},
    stderr: (l) => {
      if (stderrOut) stderrOut.push(l);
    },
    json: false,
  });
}

describe("connector sync fence integration", () => {
  it("syncs fence block to flat files (AGENTS.md, Cursor) but skips CLAUDE.md", async () => {
    writeFileSync(join(projectRoot, "fence.yaml"), FENCE_YAML);

    const initialAgents = "# Hand-written AGENTS header\n\nIntro\n";
    writeFileSync(join(projectRoot, "AGENTS.md"), initialAgents);

    const initialCursor =
      '---\ndescription: "Mega Saver rules"\nglobs: ["*"]\n---\n# Hand-written Cursor rules\n';
    mkdirSync(join(projectRoot, ".cursor/rules"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".cursor/rules/megasaver.mdc"),
      initialCursor,
    );

    const initialClaude = "# Hand-written CLAUDE header\n";
    writeFileSync(join(projectRoot, "CLAUDE.md"), initialClaude);

    const code = await sync();
    expect(code).toBe(0);

    const agentsContent = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("# Hand-written AGENTS header");
    expect(agentsContent).toContain(MEGA_SAVER_FENCE_BLOCK_START);
    expect(agentsContent).toContain("`pnpm-lock.yaml` (lockfile)");
    expect(agentsContent).toContain("DENY");
    expect(agentsContent).toContain(MEGA_SAVER_FENCE_BLOCK_END);

    const cursorContent = readFileSync(
      join(projectRoot, ".cursor/rules/megasaver.mdc"),
      "utf8",
    );
    expect(cursorContent).toContain('description: "Mega Saver rules"');
    expect(cursorContent).toContain("# Hand-written Cursor rules");
    expect(cursorContent).toContain(MEGA_SAVER_FENCE_BLOCK_START);
    expect(cursorContent).toContain("`pnpm-lock.yaml` (lockfile)");

    const claudeContent = readFileSync(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeContent).not.toContain(MEGA_SAVER_FENCE_BLOCK_START);
  });

  it("removes fence block when fence.yaml is removed", async () => {
    writeFileSync(join(projectRoot, "fence.yaml"), FENCE_YAML);
    await sync("codex");
    const agentsWithFence = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(agentsWithFence).toContain(MEGA_SAVER_FENCE_BLOCK_START);

    unlinkSync(join(projectRoot, "fence.yaml"));
    await sync("codex");
    const agentsAfterRemove = readFileSync(
      join(projectRoot, "AGENTS.md"),
      "utf8",
    );
    expect(agentsAfterRemove).not.toContain(MEGA_SAVER_FENCE_BLOCK_START);
  });

  it("corrupt fence.yaml leaves existing blocks untouched with stderr note", async () => {
    writeFileSync(join(projectRoot, "fence.yaml"), FENCE_YAML);
    await sync("codex");
    const agentsWithFence = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");

    writeFileSync(join(projectRoot, "fence.yaml"), "{{{{");
    const stderr: string[] = [];
    const code = await sync("codex", stderr);
    expect(code).toBe(0);
    expect(stderr.join("\n")).toContain("fence.yaml unreadable");

    const agentsAfterCorrupt = readFileSync(
      join(projectRoot, "AGENTS.md"),
      "utf8",
    );
    expect(agentsAfterCorrupt).toBe(agentsWithFence);
  });
});
