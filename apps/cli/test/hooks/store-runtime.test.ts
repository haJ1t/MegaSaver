import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGuardCorpusRow, writeGlobalDefault } from "@megasaver/context-gate";
import { readGuardState, readWarmStartState } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hooksGuardCommand } from "../../src/commands/hooks/guard.js";
import { hooksSaverCommand } from "../../src/commands/hooks/saver.js";
import { hooksWarmupCommand } from "../../src/commands/hooks/warmup.js";
import { ensureStoreReady } from "../../src/store.js";

const hookInput = vi.hoisted(() => ({ stdin: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((path: Parameters<typeof actual.readFileSync>[0], options?: unknown) => {
      if (path === 0) return hookInput.stdin;
      return actual.readFileSync(path, options as never);
    }) as typeof actual.readFileSync,
  };
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-02T10:00:00.000Z";
let parent: string;
let storeRoot: string;
let defaultDataHome: string;
let projectRoot: string;
// biome-ignore lint/complexity/useLiteralKeys: environment uses an index signature.
const originalXdgDataHome = process.env["XDG_DATA_HOME"];
const originalExitCode = process.exitCode;

function saverCorpus(): string {
  return Array.from(
    { length: 1_400 },
    (_, index) =>
      `line ${index}: export function preserveCustomStore${index}(token: string) { return token.length > ${index % 7}; }`,
  )
    .join("\n")
    .slice(0, 50_000);
}

function setXdgDataHome(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: environment uses an index signature.
  process.env["XDG_DATA_HOME"] = value;
}

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "custom-store-project",
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function writtenStdout(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return { text: () => chunks.join(""), restore: () => write.mockRestore() };
}

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "megasaver-hook-store-runtime-"));
  storeRoot = join(parent, "configured-store");
  defaultDataHome = join(parent, "default-data-home");
  projectRoot = join(parent, "project");
  setXdgDataHome(defaultDataHome);
  hookInput.stdin = "";
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
  setXdgDataHome(originalXdgDataHome);
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("installed hook store runtime", () => {
  it("runs the Saver hook against only its configured store", async () => {
    writeGlobalDefault(storeRoot, { enabled: true, mode: "balanced" });
    hookInput.stdin = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_response: {
        stdout: saverCorpus(),
        stderr: "",
        interrupted: false,
        isImage: false,
      },
      session_id: "custom-store-saver",
      cwd: projectRoot,
    });
    const stdout = writtenStdout();
    try {
      await runCommand(hooksSaverCommand, { rawArgs: ["--store", storeRoot] });
    } finally {
      stdout.restore();
    }

    expect(stdout.text()).toContain("updatedToolOutput");
    expect(existsSync(join(storeRoot, "content", encodeWorkspaceKey(projectRoot)))).toBe(true);
    expect(existsSync(join(defaultDataHome, "megasaver"))).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("runs the Warmup hook against only its configured store", async () => {
    await seedProject();
    hookInput.stdin = JSON.stringify({
      session_id: "custom-store-warmup",
      cwd: projectRoot,
      source: "startup",
    });
    const stdout = writtenStdout();
    try {
      await runCommand(hooksWarmupCommand, { rawArgs: ["--store", storeRoot] });
    } finally {
      stdout.restore();
    }

    expect(stdout.text()).toContain("Warm Start — custom-store-project");
    expect(readWarmStartState(storeRoot, PROJECT_ID)?.lastSeenAt).toEqual(expect.any(String));
    expect(existsSync(join(defaultDataHome, "megasaver"))).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("runs the Guard hook against only its configured store", async () => {
    await seedProject();
    appendGuardCorpusRow(storeRoot, PROJECT_ID, {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      command: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard' in src/run.ts",
      wastedTokens: 4200,
      createdAt: "2026-08-01T10:00:00.000Z",
    } as never);
    hookInput.stdin = JSON.stringify({
      session_id: "custom-store-guard",
      cwd: projectRoot,
      tool_name: "Bash",
      tool_input: { command: "pnpm vitest --shard 2" },
    });
    const stdout = writtenStdout();
    try {
      await runCommand(hooksGuardCommand, { rawArgs: ["--store", storeRoot] });
    } finally {
      stdout.restore();
    }

    expect(stdout.text()).toContain("Mistake Firewall");
    expect(
      readGuardState(storeRoot, PROJECT_ID)?.sessions["custom-store-guard"]?.firedIds,
    ).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(existsSync(join(defaultDataHome, "megasaver"))).toBe(false);
    expect(process.exitCode).toBe(0);
  });
});
