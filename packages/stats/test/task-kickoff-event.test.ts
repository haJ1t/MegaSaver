import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTaskKickoffEvent,
  readTaskKickoffEvents,
  taskKickoffEventPath,
  taskKickoffEventSchema,
} from "../src/index.js";

const WORKSPACE_KEY = "1a2b3c4d5e6f7a8b";
const APPEND_LINE_SOURCE_URL = new URL("../src/append-line.ts", import.meta.url).href;
const ISOLATED_APPEND_WATCHDOG_MS = 1_000;
let root: string;

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/megasaver-task-kickoff-`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceKey: WORKSPACE_KEY,
    sessionId: "session-1",
    createdAt: "2026-08-01T10:00:00.000Z",
    tokenCount: 321,
    ...overrides,
  };
}

function runIsolatedAppend(path: string) {
  const script = `
    import { appendPrivateLine } from ${JSON.stringify(APPEND_LINE_SOURCE_URL)};
    try {
      appendPrivateLine(process.argv[1], "event\\n");
    } catch (error) {
      const errorCode = error instanceof Error && typeof error.code === "string" ? error.code : null;
      process.stdout.write(JSON.stringify({ errorCode }) + "\\n");
      process.exitCode = 1;
    }
  `;
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "--input-type=module",
      "--eval",
      script,
      path,
    ],
    { encoding: "utf8", timeout: ISOLATED_APPEND_WATCHDOG_MS },
  );
}

describe("TaskKickoffEvent", () => {
  it("parses a valid event", () => {
    expect(taskKickoffEventSchema.parse(event())).toEqual(event());
  });

  it("rejects a negative token count", () => {
    expect(taskKickoffEventSchema.safeParse(event({ tokenCount: -1 })).success).toBe(false);
  });

  it("rejects an unknown field", () => {
    expect(taskKickoffEventSchema.safeParse(event({ extra: true })).success).toBe(false);
  });

  it("reads appended events in append order", () => {
    appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()));
    appendTaskKickoffEvent(
      { root },
      taskKickoffEventSchema.parse(
        event({
          id: "22222222-2222-4222-8222-222222222222",
          sessionId: "session-2",
        }),
      ),
    );

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY).map((row) => row.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("writes a normal task kickoff event to an owner-only regular file", () => {
    const delivered = taskKickoffEventSchema.parse(event());

    appendTaskKickoffEvent({ root }, delivered);

    const path = taskKickoffEventPath(root, WORKSPACE_KEY);
    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([delivered]);
    expect(statSync(path).isFile()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("refuses a stable task kickoff event symlink", () => {
    const outside = join(root, "outside.jsonl");
    const eventPath = taskKickoffEventPath(root, WORKSPACE_KEY);
    writeFileSync(outside, "outside\n", { mode: 0o644 });
    mkdirSync(dirname(eventPath), { recursive: true });
    symlinkSync(outside, eventPath);

    expect(() => appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()))).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
    expect(statSync(outside).mode & 0o777).toBe(0o644);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a stable task kickoff event FIFO without blocking",
    () => {
      const eventPath = taskKickoffEventPath(root, WORKSPACE_KEY);
      mkdirSync(dirname(eventPath), { recursive: true });
      execFileSync("mkfifo", [eventPath]);

      const result = runIsolatedAppend(eventPath);

      expect({
        errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code,
        signal: result.signal,
        status: result.status,
        stdout: result.stdout,
      }).toEqual({
        errorCode: undefined,
        signal: null,
        status: 1,
        stdout: '{"errorCode":"ENXIO"}\n',
      });
      expect(lstatSync(eventPath).isFIFO()).toBe(true);
      rmSync(eventPath);
      expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([]);
    },
  );

  it("does not treat a retraction-shaped row as accounting protocol", () => {
    const delivered = taskKickoffEventSchema.parse(event());
    appendTaskKickoffEvent({ root }, delivered);
    appendFileSync(
      taskKickoffEventPath(root, WORKSPACE_KEY),
      `${JSON.stringify({ kind: "retract", id: delivered.id, workspaceKey: WORKSPACE_KEY })}\n`,
    );

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([delivered]);
  });

  it("skips a corrupt JSONL line", () => {
    appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()));
    const path = taskKickoffEventPath(root, WORKSPACE_KEY);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{corrupt\n");

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([
      taskKickoffEventSchema.parse(event()),
    ]);
  });
});
