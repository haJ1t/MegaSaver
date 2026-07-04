import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeReplayTrace,
  readReplayTraces,
  replayTraceSchema,
  writeReplayTrace,
} from "../src/replay-trace.js";
import { type FilterOutputInput, filterOutput } from "../src/types.js";

const base = (raw: string, overrides: Partial<FilterOutputInput> = {}): FilterOutputInput => ({
  raw,
  mode: "balanced",
  recordTrace: true,
  ...overrides,
});

const META = {
  sessionId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  toolName: "proxy_run_command",
  task: "find the failure",
  query: "vitest run",
  chunkSetId: "cs-123",
  createdAt: "2026-06-13T00:00:00.000Z",
};

describe("filterOutput ranking trace (Proxy Mode v1.2 §12)", () => {
  it("populates a trace only when recordTrace is set", async () => {
    const off = await filterOutput({ raw: "hello\n", mode: "balanced" });
    expect(off.trace).toBeUndefined();
    const on = await filterOutput(base("hello\n"));
    expect(on.trace).toBeDefined();
  });

  it("records candidates = selected ∪ omitted with no raw text (privacy §12.3)", async () => {
    const raw = `${Array.from({ length: 4000 }, (_, i) => `noise line ${i} lorem ipsum`).join("\n")}\n`;
    const result = await filterOutput(base(raw, { mode: "aggressive" }));
    const t = result.trace;
    expect(t).toBeDefined();
    if (t === undefined) return;
    expect(t.decision).toBe("compressed");
    expect(t.candidates.length).toBe(t.selected.length + t.omitted.length);
    expect(t.omitted.length).toBeGreaterThan(0);
    // No raw text is duplicated into the trace — only references + scores.
    for (const ref of t.candidates) {
      expect(ref).not.toHaveProperty("text");
      expect(typeof ref.startLine).toBe("number");
      expect(typeof ref.score).toBe("number");
    }
  });

  it("captures ablation inputs: engine flag, signals and final scores", async () => {
    const raw = `${Array.from({ length: 600 }, (_, i) => `log line ${i}`).join("\n")}\nuse useAuthToken\n`;
    const result = await filterOutput(
      base(raw, { engineRanking: true, sessionHints: { recentMemory: ["useAuthToken"] } }),
    );
    const t = result.trace;
    expect(t?.engineRanking).toBe(true);
    expect(t?.selected.some((r) => r.engine !== undefined)).toBe(true);
  });

  it("writes a minimal trace for the passthrough decision", async () => {
    const result = await filterOutput(base("tiny\n"));
    expect(result.trace?.decision).toBe("passthrough");
    expect(result.trace?.omitted.length).toBe(0);
  });
});

describe("finalizeReplayTrace", () => {
  it("references the content-store chunkSetId and carries session/project/tool", async () => {
    const result = await filterOutput(base("hello\n"));
    const ranking = result.trace;
    expect(ranking).toBeDefined();
    if (ranking === undefined) return;
    const trace = finalizeReplayTrace(ranking, META);
    expect(trace.chunkSetId).toBe("cs-123");
    expect(trace.sessionId).toBe(META.sessionId);
    expect(trace.projectId).toBe(META.projectId);
    expect(trace.toolName).toBe("proxy_run_command");
    expect(trace.task).toBe("find the failure");
    expect(replayTraceSchema.safeParse(trace).success).toBe(true);
  });
});

describe("finalizeReplayTrace redaction (Slice A inline seam fact)", () => {
  it("stamps a redaction meta onto the trace and round-trips through the reader", async () => {
    const ranking = (await filterOutput(base("hello\n"))).trace;
    if (ranking === undefined) throw new Error("expected trace");
    const trace = finalizeReplayTrace(ranking, {
      ...META,
      redaction: { redacted: true, secretsRedacted: 2 },
    });
    expect(trace.redaction).toEqual({ redacted: true, secretsRedacted: 2 });
    expect(replayTraceSchema.safeParse(trace).success).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), "replay-trace-redaction-"));
    try {
      await writeReplayTrace(dir, trace);
      const [parsed] = readReplayTraces(join(dir, "replay-traces.jsonl"));
      expect(parsed?.redaction).toEqual({ redacted: true, secretsRedacted: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits redaction when the meta has none (legacy trace still parses)", async () => {
    const ranking = (await filterOutput(base("hello\n"))).trace;
    if (ranking === undefined) throw new Error("expected trace");
    const trace = finalizeReplayTrace(ranking, META);
    expect(trace).not.toHaveProperty("redaction");
    expect(replayTraceSchema.safeParse(trace).success).toBe(true);

    const legacy = JSON.stringify({
      sessionId: META.sessionId,
      projectId: META.projectId,
      toolName: META.toolName,
      chunkSetId: META.chunkSetId,
      ranking: trace.ranking,
      createdAt: META.createdAt,
    });
    const dir = await mkdtemp(join(tmpdir(), "replay-trace-legacy-"));
    try {
      const path = join(dir, "replay-traces.jsonl");
      await appendFile(path, `${legacy}\n`, "utf8");
      const [parsed] = readReplayTraces(path);
      expect(parsed?.chunkSetId).toBe(META.chunkSetId);
      expect(parsed?.redaction).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeReplayTrace (best-effort persistence)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "replay-trace-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends a JSONL line referencing the chunkSetId, not raw output", async () => {
    const ranking = (await filterOutput(base("hello world\n"))).trace;
    if (ranking === undefined) throw new Error("expected trace");
    const trace = finalizeReplayTrace(ranking, META);
    await writeReplayTrace(dir, trace);
    const contents = await readFile(join(dir, "replay-traces.jsonl"), "utf8");
    const parsed = JSON.parse(contents.trim());
    expect(parsed.chunkSetId).toBe("cs-123");
    expect(contents).not.toContain("hello world");
  });

  it("never throws when the directory is unwritable", async () => {
    const ranking = (await filterOutput(base("x\n"))).trace;
    if (ranking === undefined) throw new Error("expected trace");
    const trace = finalizeReplayTrace(ranking, META);
    await expect(writeReplayTrace("/nonexistent/\u0000/path", trace)).resolves.toBeUndefined();
  });
});

describe("readReplayTraces (seam phase 2 P2.6)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "replay-trace-read-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses good JSONL lines and skips corrupt or schema-invalid ones", async () => {
    const ranking = (await filterOutput(base("hello\n"))).trace;
    if (ranking === undefined) throw new Error("expected trace");
    const trace = finalizeReplayTrace(ranking, META);
    await writeReplayTrace(dir, trace);
    const path = join(dir, "replay-traces.jsonl");
    await appendFile(path, "{not json\n", "utf8");
    await appendFile(path, '{"sessionId":"x","valid":false}\n', "utf8");
    await writeReplayTrace(dir, trace);

    const traces = readReplayTraces(path);
    expect(traces).toHaveLength(2);
    expect(traces[0]?.chunkSetId).toBe("cs-123");
    expect(traces[1]?.ranking.decision).toBe(trace.ranking.decision);
  });

  it("returns an empty list for a missing file", () => {
    expect(readReplayTraces(join(dir, "absent.jsonl"))).toEqual([]);
  });
});
