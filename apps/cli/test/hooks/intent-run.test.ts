import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hooksIntentCommand } from "../../src/commands/hooks/intent.js";

const hookState = vi.hoisted(() => ({
  stdin: "",
  runTaskKickoffProcess: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((...args: unknown[]) => {
      if (args[0] === 0) return hookState.stdin;
      return Reflect.apply(actual.readFileSync, actual, args);
    }) as typeof actual.readFileSync,
  };
});

vi.mock("../../src/hooks/task-kickoff-process.js", () => ({
  TASK_KICKOFF_DEADLINE_MS: 500,
  runTaskKickoffProcess: hookState.runTaskKickoffProcess,
}));

const {
  captureIntent,
  intentFilePath,
  readSessionIntent,
  runIntentHookFromProcess,
  sessionIntentFilePath,
} = await import("../../src/hooks/intent-run.js");

let storeRoot: string;
let storeParent: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
const originalXdgDataHome = process.env["XDG_DATA_HOME"];
const originalExitCode = process.exitCode;

function setXdgDataHome(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["XDG_DATA_HOME"] = value;
}

beforeEach(() => {
  storeParent = mkdtempSync(join(tmpdir(), "intent-"));
  storeRoot = join(storeParent, "megasaver");
  setXdgDataHome(storeParent);
  process.exitCode = undefined;
  hookState.stdin = "";
  hookState.runTaskKickoffProcess.mockReset();
});
afterEach(() => {
  rmSync(storeParent, { recursive: true, force: true });
  setXdgDataHome(originalXdgDataHome);
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("runIntentHookFromProcess", () => {
  it("passes the raw payload to the bounded worker without parent-side persistence", async () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const sessionId = "prompt-session";
    const payload = {
      prompt: `use key ${secret} please`,
      cwd,
      session_id: sessionId,
    };
    hookState.stdin = JSON.stringify(payload);
    hookState.runTaskKickoffProcess.mockResolvedValue({ wrote: false });

    await runIntentHookFromProcess();

    expect(hookState.runTaskKickoffProcess).toHaveBeenCalledWith(
      expect.objectContaining({ payload, storeRoot }),
    );
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
    expect(existsSync(sessionIntentFilePath(storeRoot, wk, sessionId))).toBe(false);
  });

  it("exits zero when the task kickoff process throws", async () => {
    hookState.stdin = JSON.stringify({ prompt: "fix the parser", cwd, session_id: "failed-pack" });
    hookState.runTaskKickoffProcess.mockRejectedValue(new Error("boom"));

    await runIntentHookFromProcess();

    expect(hookState.runTaskKickoffProcess).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it("forwards the installed --store value to task kickoff assembly", async () => {
    const configuredStore = join(storeParent, "custom-store");
    hookState.stdin = JSON.stringify({ prompt: "use configured store", cwd, session_id: "custom" });
    hookState.runTaskKickoffProcess.mockResolvedValue({ wrote: false });

    await runCommand(hooksIntentCommand, { rawArgs: ["--store", configuredStore] });

    expect(hookState.runTaskKickoffProcess).toHaveBeenCalledWith(
      expect.objectContaining({ storeRoot: configuredStore }),
    );
  });
});

describe("captureIntent", () => {
  it("writes {prompt, ts} to the workspace-keyed file", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd }, () => 123);
    const raw = readFileSync(intentFilePath(storeRoot, wk), "utf8");
    expect(JSON.parse(raw)).toEqual({ prompt: "fix the parser", ts: 123 });
  });

  it("writes nothing for an empty/whitespace prompt", () => {
    captureIntent(storeRoot, { prompt: "   ", cwd }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });

  it("writes nothing for a malformed payload", () => {
    captureIntent(storeRoot, { nope: true }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });

  it("redacts secrets in the prompt before persisting", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    captureIntent(storeRoot, { prompt: `use key ${secret} please`, cwd }, () => 1);
    const raw = readFileSync(intentFilePath(storeRoot, wk), "utf8");
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw).prompt).toBe("use key AKIA[REDACTED] please");
  });

  // The file holds the user's verbatim prompt. NTFS ignores POSIX mode bits.
  it.skipIf(process.platform === "win32")("writes the prompt owner-only", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd }, () => 1);
    const path = intentFilePath(storeRoot, wk);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("repairs a world-readable intent dir", () => {
    const dir = dirname(intentFilePath(storeRoot, wk));
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    captureIntent(storeRoot, { prompt: "fix the parser", cwd }, () => 1);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe("readSessionIntent", () => {
  it("returns undefined when the file is missing", () => {
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns the prompt for a valid file", () => {
    captureIntent(storeRoot, { prompt: "add logging", cwd }, () => 1);
    expect(readSessionIntent(storeRoot, wk, undefined, () => 1)).toBe("add logging");
  });

  it("returns undefined for malformed JSON", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(intentFilePath(storeRoot, wk), "{ not json", "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns undefined for an empty stored prompt", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(intentFilePath(storeRoot, wk), JSON.stringify({ prompt: "", ts: 1 }), "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns undefined for valid JSON with a schema mismatch", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(
      intentFilePath(storeRoot, wk),
      JSON.stringify({ prompt: "x", ts: "not-a-number" }),
      "utf8",
    );
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });
});

describe("D17: per-session intent + TTL", () => {
  const sidA = "11111111-1111-4111-8111-111111111111";
  const sidB = "22222222-2222-4222-8222-222222222222";

  it("two sessions in one workspace read their own prompts", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd, session_id: sidA }, () => 1000);
    captureIntent(storeRoot, { prompt: "write the docs", cwd, session_id: sidB }, () => 1000);
    expect(readSessionIntent(storeRoot, wk, sidA, () => 1000)).toBe("fix the parser");
    expect(readSessionIntent(storeRoot, wk, sidB, () => 1000)).toBe("write the docs");
  });

  it("id-less payloads still work via the legacy latest-wins file", () => {
    captureIntent(storeRoot, { prompt: "legacy prompt", cwd }, () => 1000);
    expect(readSessionIntent(storeRoot, wk, undefined, () => 1000)).toBe("legacy prompt");
    // an unknown session id falls back to the legacy file
    expect(readSessionIntent(storeRoot, wk, sidA, () => 1000)).toBe("legacy prompt");
  });

  it("intent expires after 30 minutes", () => {
    const t0 = 1_000_000_000_000;
    captureIntent(storeRoot, { prompt: "old prompt", cwd, session_id: sidA }, () => t0);
    const late = () => t0 + 30 * 60_000 + 1;
    expect(readSessionIntent(storeRoot, wk, sidA, late)).toBeUndefined();
    expect(readSessionIntent(storeRoot, wk, undefined, late)).toBeUndefined();
  });

  it("a hostile session_id cannot escape the store (falls back to legacy)", () => {
    captureIntent(storeRoot, { prompt: "safe prompt", cwd, session_id: "../../evil" }, () => 1000);
    // per-session write was skipped (bad id); legacy file still written and readable
    expect(readSessionIntent(storeRoot, wk, "../../evil", () => 1000)).toBe("safe prompt");
  });
});
