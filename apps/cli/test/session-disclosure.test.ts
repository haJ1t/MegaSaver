import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_DISCLOSURE_INPUT_BYTES } from "../src/commands/session/disclosure/path-claims.js";
import { readDisclosureReceipt } from "../src/commands/session/disclosure/receipt-store.js";
import { runSessionDisclosure } from "../src/commands/session/index.js";
import type { ExecGit } from "../src/git-delta.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-06T12:00:00.000Z";

let root: string;
let work: string;

const fakeGit: ExecGit = (args) => {
  if (args[0] === "status") return " M src/a.ts\0?? pnpm-lock.yaml\0";
  if (args[0] === "log") return "src/committed.ts\n";
  if (args[0] === "rev-parse") return "abc123\n";
  if (args[0] === "diff") return "";
  throw new Error(`unexpected git ${args[0] ?? "<none>"}`);
};

async function seedSession(): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: NOW, updatedAt: NOW },
    ]),
  );
  await writeFile(
    join(root, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: "2026-08-06T10:00:00.000Z",
        endedAt: null,
      },
    ]),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "megasaver-disclosure-cmd-"));
  work = await mkdtemp(join(tmpdir(), "megasaver-disclosure-work-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

async function run(input: {
  sessionId?: string;
  textFile?: string | undefined;
  json?: boolean;
  execGit?: ExecGit;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSessionDisclosure({
    sessionId: input.sessionId ?? SESSION_ID,
    textFile: input.textFile,
    json: input.json === true,
    storeFlag: root,
    cwd: work,
    home: "/home/u",
    xdgDataHome: undefined,
    platform: "linux",
    localAppData: undefined,
    execGit: input.execGit ?? fakeGit,
    now: () => NOW,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

describe("mega session disclosure", () => {
  it("compute mode reconciles the narrative against the delta and persists the receipt", async () => {
    await seedSession();
    const narrative = join(work, "narrative.md");
    await writeFile(narrative, "Updated `src/a.ts` and `docs/ghost.md`.");
    const { code, out, err } = await run({ textFile: narrative });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(readDisclosureReceipt(root, SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      generatedAt: NOW,
      claimed: ["docs/ghost.md", "src/a.ts"],
      observed: ["pnpm-lock.yaml", "src/a.ts", "src/committed.ts"],
      undisclosed: ["pnpm-lock.yaml", "src/committed.ts"],
      phantom: ["docs/ghost.md"],
    });
    const text = out.join("\n");
    expect(text).toContain("undisclosed (touched, never mentioned): 2");
    expect(text).toContain("phantom (mentioned, untouched): 1");
  });

  it("rejects an oversize narrative with the pinned message and empty stdout", async () => {
    await seedSession();
    const big = join(work, "big.md");
    await writeFile(big, Buffer.alloc(MAX_DISCLOSURE_INPUT_BYTES + 1, 0x61));
    const { code, out, err } = await run({ textFile: big });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["error: input file exceeds 8388608 bytes"]);
  });

  it("report mode replays the persisted receipt identically", async () => {
    await seedSession();
    const narrative = join(work, "narrative.md");
    await writeFile(narrative, "Updated `src/a.ts`.");
    const first = await run({ textFile: narrative });
    expect(first.code).toBe(0);
    const second = await run({});
    expect(second.code).toBe(0);
    expect(second.out).toEqual(first.out);
  });

  it("json mode emits the receipt as JSON", async () => {
    await seedSession();
    const narrative = join(work, "narrative.md");
    await writeFile(narrative, "Updated `src/a.ts`.");
    const { code, out } = await run({ textFile: narrative, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.claimed).toContain("src/a.ts");
  });

  it("unknown session → session not found", async () => {
    await seedSession();
    const { code, out, err } = await run({
      sessionId: "99999999-9999-4999-8999-999999999999",
      textFile: join(work, "x.md"),
    });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("not found");
  });

  it("unreadable file → cannot read input file", async () => {
    await seedSession();
    const { code, out, err } = await run({ textFile: join(work, "missing.md") });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("cannot read input file");
  });

  it("no receipt in report mode → no disclosure receipt", async () => {
    await seedSession();
    const { code, out, err } = await run({});
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("no disclosure receipt");
  });

  it("throwing execGit → not a git repository", async () => {
    await seedSession();
    const narrative = join(work, "narrative.md");
    await writeFile(narrative, "`src/a.ts`");
    const throwing: ExecGit = () => {
      throw new Error("not a git repository");
    };
    const { code, out, err } = await run({ textFile: narrative, execGit: throwing });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("not a git repository");
  });

  it("invalid session id → invalid session id", async () => {
    const { code, out, err } = await run({ sessionId: "not-a-uuid", textFile: undefined });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("invalid session id");
  });
});
