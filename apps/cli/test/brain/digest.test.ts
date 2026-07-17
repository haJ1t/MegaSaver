import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { type FailedAttempt, dedupeKeywordFor, extractSessionMemories } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIGEST_UPSELL, runBrainDigest } from "../../src/commands/brain/digest.js";
import { brainCommand } from "../../src/commands/brain/index.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222"; // older
const SESSION_B = "44444444-4444-4444-8444-444444444444"; // newer
const MEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEM_AUTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEM_PRED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FA_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FA_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TS_OLD = "2026-07-01T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let out: string[];
let err: string[];
let proPublicKey: KeyObject | undefined;

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

function memoryRow(
  id: string,
  sessionId: string | null,
  over: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    scope: sessionId === null ? "project" : "session",
    type: "bug",
    title: `title ${id.slice(0, 8)}`,
    content: "content",
    keywords: [],
    confidence: "low",
    source: "test_failure",
    approval: "suggested",
    stale: false,
    createdAt: TS_OLD,
    updatedAt: TS_OLD,
    ...over,
  });
}

function failureRow(id: string, sessionId: string): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    task: "fix login",
    failedStep: "run auth tests",
    errorOutput: "boom 401",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS_OLD,
  });
}

async function seed(memoryRows: string[], failureRows: string[] = []): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS_OLD, updatedAt: TS_OLD },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_A,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "older session",
        startedAt: TS_OLD,
        endedAt: null,
      },
      {
        id: SESSION_B,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "newer session",
        startedAt: TS_NEW,
        endedAt: null,
      },
    ]),
  );
  if (memoryRows.length > 0) {
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${memoryRows.join("\n")}\n`);
  }
  if (failureRows.length > 0) {
    await mkdir(join(store, "failed-attempts"), { recursive: true });
    await writeFile(
      join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
      `${failureRows.join("\n")}\n`,
    );
  }
}

type StoredRow = {
  id: string;
  approval: string;
  title: string;
  content: string;
  updatedAt: string;
  lastActiveAt?: string;
  validTo?: string | null;
};

async function readRows(): Promise<StoredRow[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredRow);
}

// Byte-level proof that a read-only surface wrote nothing: existsSync on one
// known path would miss a mutated row or any other stray file.
async function snapshotStore(): Promise<Record<string, string>> {
  const entries = await readdir(store, { recursive: true, withFileTypes: true });
  const snapshot: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    snapshot[relative(store, full)] = await readFile(full, "utf8");
  }
  return snapshot;
}

type FakeTty = PassThrough & { setRawMode: ReturnType<typeof vi.fn> };

function fakeStdin(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.setRawMode = vi.fn();
  return stream;
}

// Every injected stream must terminate. A stream that only ever goes quiet
// leaves the keystroke loop awaiting a key forever, so a regression that
// wrongly routes a read-only surface into the loop would hang the suite
// instead of failing it. EOF makes that abort, and fail, immediately.
function endedStdin(): FakeTty {
  const stream = fakeStdin();
  stream.end();
  return stream;
}

function digestInput(
  over: Partial<Parameters<typeof runBrainDigest>[0]> = {},
): Parameters<typeof runBrainDigest>[0] {
  return {
    storeRoot: store,
    projectName: "demo",
    limitFlag: undefined,
    json: false,
    now: () => NOW,
    nowMs: () => Date.parse(NOW),
    ensureStore: () => ensureStoreReady(store),
    isTTY: false,
    stdin: endedStdin(),
    editor: undefined,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-brain-digest-"));
  out = [];
  err = [];
  proPublicKey = undefined;
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("mega brain digest", () => {
  it("is registered as a brain subcommand", () => {
    expect(Object.keys(brainCommand.subCommands ?? {})).toContain("digest");
  });

  it("free tier: prints the upsell, exits 0, touches nothing", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    const before = await snapshotStore();
    const code = await runBrainDigest(digestInput());
    expect(code).toBe(0);
    expect(out).toContain(DIGEST_UPSELL);
    expect(await snapshotStore()).toEqual(before);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("--json prints the queue newest-session-first with project scope last, read-only", async () => {
    // MEM_PRED is project-scope (sessionId null) and must sort behind every
    // session-scoped row regardless of seed order.
    await seed([
      memoryRow(MEM_PRED, null),
      memoryRow(MEM_B, SESSION_A),
      memoryRow(MEM_A, SESSION_B),
    ]);
    activatePro();
    const code = await runBrainDigest(digestInput({ json: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as {
      total: number;
      showing: number;
      pending: Array<{ id: string }>;
    };
    expect(parsed.total).toBe(3);
    expect(parsed.showing).toBe(3);
    expect(parsed.pending.map((p) => p.id)).toEqual([MEM_A, MEM_B, MEM_PRED]);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
  });

  it("non-TTY: numbered fallback with approve/reject hint, no raw mode", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = endedStdin();
    const code = await runBrainDigest(digestInput({ stdin }));
    expect(code).toBe(0);
    expect(stdin.setRawMode).not.toHaveBeenCalled();
    expect(out.some((l) => l.startsWith("1. ") && l.includes(MEM_A))).toBe(true);
    expect(out.some((l) => l.includes("mega memory approve"))).toBe(true);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
  });

  it("--limit caps rows and the header reports showing N of M", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ limitFlag: "1" }));
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("showing 1 of 2"))).toBe(true);
    expect(out.filter((l) => /^\d+\. /.test(l))).toHaveLength(1);
  });

  it("invalid --limit exits 1 before any store work", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ limitFlag: "0" }));
    expect(code).toBe(1);
    expect(err.some((l) => l.includes("invalid --limit"))).toBe(true);
  });

  it("unknown project exits 1", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ projectName: "nope" }));
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });

  it("interactive: y approves, n rejects, quit writes digest-state", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_A)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yn");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === MEM_A)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === MEM_B)?.approval).toBe("rejected");
    const state = JSON.parse(await readFile(join(store, "digest-state.json"), "utf8")) as {
      lastDigestAt: string;
    };
    expect(state.lastDigestAt).toBe(NOW);
  });

  // `u` is only reachable while the loop is still iterating: runDigestLoop
  // emits quit the moment the queue exhausts, so a decision on the LAST row
  // can never be undone. Hence a trailing row + digest-loop's own "yuss"
  // pattern (approve A · undo · skip A · skip B · quit) — "yus" here would
  // block forever on a 4th key that never arrives.
  it("aborting mid-queue (EOF) keeps decided work but never stamps digest-state", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_A)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("y");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("approved");
    // An interrupted digest is not a reviewed one: stamping lastDigestAt here
    // would hide the untriaged remainder from the next run's collapsed line.
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
  });

  it("interactive: u flips the last decision back to suggested", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_A)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yuss");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
    expect(out.some((l) => l.includes(`undid — ${MEM_A} back to suggested`))).toBe(true);
  });

  it("undo after a supersession close renders the reopen hint; predecessor stays closed", async () => {
    await seed([
      memoryRow(MEM_PRED, SESSION_B, { approval: "approved" }),
      memoryRow(MEM_A, SESSION_B, { supersedesId: MEM_PRED }),
      memoryRow(MEM_B, SESSION_A),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yuss");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(
      out.some((l) =>
        l.includes(`predecessor ${MEM_PRED} stays closed — mega memory reopen ${MEM_PRED}`),
      ),
    ).toBe(true);
    const pred = (await readRows()).find((r) => r.id === MEM_PRED);
    expect(pred?.validTo).toBe(NOW);
  });

  it("collapsed auto-approved line; a expands; n revokes to suggested", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "approved",
        confidence: "high",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
        lastActiveAt: TS_NEW,
      }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("ans");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("1 auto-approved while you were away"))).toBe(true);
    const revoked = (await readRows()).find((r) => r.id === MEM_AUTO);
    expect(revoked?.approval).toBe("suggested");
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
    // The flip patches approval + updatedAt and NOTHING else: a stamped validTo
    // would silently vanish the row from default recall, and re-keying
    // lastActiveAt would silently re-rank it (effective-confidence decay keys
    // off lastActiveAt ?? updatedAt ?? createdAt).
    expect(revoked?.updatedAt).toBe(NOW);
    expect(revoked?.validTo).toBeUndefined();
    expect(revoked?.lastActiveAt).toBe(TS_NEW);
  });

  it("spot-review y keeps an auto-approved row without churning it", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "approved",
        confidence: "high",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("ays");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    const kept = (await readRows()).find((r) => r.id === MEM_AUTO);
    expect(kept?.approval).toBe("approved");
    // `y` on an already-approved row is a true no-op: keeping a row the
    // machine wrote must not restamp updatedAt (the shared flip's no-op guard,
    // exercised through the digest rather than `mega memory approve`).
    expect(kept?.updatedAt).toBe(TS_NEW);
    expect(out.some((l) => l.includes(`kept ${MEM_AUTO} (no change)`))).toBe(true);
  });

  it("an edit that fails validation aborts the approve (stays suggested)", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    // Editor output is a trust boundary: a control char is rejected by
    // titleSchema, which must abort the approve rather than crash the loop.
    const spawnEditor = (_editor: string, path: string): { status: number | null } => {
      writeFileSync(path, "bad\u0007title\n\nEdited content\n"); // BEL: escaped, never literal
      return { status: 0 };
    };
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("invalid edit — approve aborted"))).toBe(true);
    const row = (await readRows()).find((r) => r.id === MEM_A);
    expect(row?.approval).toBe("suggested");
    expect(row?.title).toBe(`title ${MEM_A.slice(0, 8)}`);
  });

  it("lastDigestAt scopes the collapse — rows autopilot wrote before it are not re-offered", async () => {
    await seed([
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "approved",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_OLD,
        updatedAt: TS_OLD,
      }),
    ]);
    await writeFile(join(store, "digest-state.json"), JSON.stringify({ lastDigestAt: TS_NEW }));
    activatePro();
    const code = await runBrainDigest(digestInput({ json: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as {
      autoApprovedSinceLastDigest: number;
      lastDigestAt: string | null;
    };
    // lastDigestAt echoed back proves the state file was actually read — a
    // malformed one would safeParse to null and silently match everything.
    expect(parsed.lastDigestAt).toBe(TS_NEW);
    expect(parsed.autoApprovedSinceLastDigest).toBe(0);
  });

  it("a rejected row carrying autopilot evidence is never resurrected by n", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "rejected",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("an");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    // Only rows still APPROVED are "auto-approved while you were away". A row
    // the human already rejected must not re-enter the spot-review set: there
    // `n` means "revoke to suggested", so reject would RESURRECT it (§8.5).
    expect((await readRows()).find((r) => r.id === MEM_AUTO)?.approval).toBe("rejected");
    expect(out.some((l) => l.includes("auto-approved while you were away"))).toBe(false);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("rejected");
  });

  it("a second a does not re-splice the same auto-approved rows", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "approved",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("aayyy");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    // The latch is what bounds the queue: splice() inserts at index without
    // advancing it, so an unlatched second `a` re-inserts the same rows and
    // the human triages them twice — N presses, N copies.
    expect(out.filter((l) => l.includes("spot-review"))).toHaveLength(1);
    expect(out.some((l) => l.includes("no auto-approved rows to review"))).toBe(true);
  });

  it("approving a linked candidate discloses the close on stdout", async () => {
    await seed([
      memoryRow(MEM_PRED, SESSION_B, { approval: "approved" }),
      memoryRow(MEM_A, SESSION_B, { supersedesId: MEM_PRED }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("y");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    // The close really happens, so silence here would be a silent supersession:
    // approve-and-move-on never presses `u`, so this line is the only
    // disclosure that a memory was closed.
    expect((await readRows()).find((r) => r.id === MEM_PRED)?.validTo).toBe(NOW);
    expect(out.some((l) => l.includes(`note: closed ${MEM_PRED}`))).toBe(true);
  });

  it("a human-approved row is never offered for spot-review", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_PRED, SESSION_B, { approval: "approved", createdAt: TS_NEW }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("as");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    // The autopilot@1 evidence prefix is the ONLY marker of machine authorship
    // (§8.3). Without it a row the human approved by hand would be revocable
    // by a stray `n` during spot-review.
    expect(out.some((l) => l.includes("auto-approved while you were away"))).toBe(false);
    expect(out.some((l) => l.includes("no auto-approved rows to review"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_PRED)?.approval).toBe("approved");
  });

  it("empty queue prints the honest empty line and stamps state on a TTY", async () => {
    await seed([]);
    activatePro();
    const code = await runBrainDigest(digestInput({ isTTY: true }));
    expect(code).toBe(0);
    expect(out).toContain("Nothing to triage — 0 failures recorded since ever.");
    expect(existsSync(join(store, "digest-state.json"))).toBe(true);
  });

  it("empty queue on a plain non-TTY stays read-only", async () => {
    await seed([]);
    activatePro();
    const before = await snapshotStore();
    const code = await runBrainDigest(digestInput({ isTTY: false }));
    expect(code).toBe(0);
    expect(out).toContain("Nothing to triage — 0 failures recorded since ever.");
    // A piped run is not a human looking at the digest: stamping lastDigestAt
    // here would hide the next run's auto-approved rows from the real human.
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
    expect(await snapshotStore()).toEqual(before);
  });

  it("e with $EDITOR unset skips the row (stays suggested)", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: undefined }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("$EDITOR is not set — skipped"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("a blank $EDITOR is treated as unset, never spawned", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const spawnEditor = vi.fn(() => ({ status: 0 }));
    // EDITOR="" would otherwise reach `sh -c '"$0"' <tmpfile>` and try to
    // execute the temp file itself.
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: "  ", spawnEditor }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(spawnEditor).not.toHaveBeenCalled();
    expect(out.some((l) => l.includes("$EDITOR is not set — skipped"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("editor non-zero exit aborts the approve (stays suggested)", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(
      digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor: () => ({ status: 1 }) }),
    );
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("approve aborted"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("editor success rewrites title/content, re-keys decay, then approves", async () => {
    await seed([memoryRow(MEM_A, SESSION_B, { lastActiveAt: TS_OLD })]);
    activatePro();
    const stdin = fakeStdin();
    const spawnEditor = (_editor: string, path: string): { status: number | null } => {
      writeFileSync(path, "Edited title\n\nEdited content\n");
      return { status: 0 };
    };
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === MEM_A);
    expect(row?.approval).toBe("approved");
    expect(row?.title).toBe("Edited title");
    expect(row?.content).toBe("Edited content");
    // Decay keys off `lastActiveAt ?? updatedAt` (memory-entry.ts:232) and
    // approval flips deliberately never re-key it (:214), so a content-bearing
    // edit must stamp it here or the freshly edited row keeps decaying as if
    // untouched — updatedAt cannot rescue it.
    expect(row?.lastActiveAt).toBe(NOW);
  });

  it("the un-injected default editor path spawns the real $EDITOR", async () => {
    const fixture = join(store, "fixture.md");
    await writeFile(fixture, "Spawned title\n\nSpawned content\n");
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    // No spawnEditor injection: this is the path `brainDigestCommand` actually
    // takes in production (`input.spawnEditor ?? defaultSpawnEditor`), so it
    // runs the real spawnSync("sh", ["-c", '$EDITOR "$0"']) end-to-end.
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: `cp ${fixture}` }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === MEM_A);
    expect(row?.approval).toBe("approved");
    expect(row?.title).toBe("Spawned title");
    expect(row?.content).toBe("Spawned content");
  });

  it("an editor that writes nothing approves without re-keying decay", async () => {
    await seed([memoryRow(MEM_A, SESSION_B, { lastActiveAt: TS_OLD })]);
    activatePro();
    const stdin = fakeStdin();
    const spawnEditor = (_editor: string, path: string): { status: number | null } => {
      writeFileSync(path, "");
      return { status: 0 };
    };
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor }));
    stdin.write("e");
    stdin.end();
    const code = await loop;
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === MEM_A);
    expect(row?.approval).toBe("approved");
    // An edit that changed no content must not restamp lastActiveAt — that
    // would silently re-rank the row under effective-confidence decay.
    expect(row?.lastActiveAt).toBe(TS_OLD);
    expect(row?.title).toBe(`title ${MEM_A.slice(0, 8)}`);
  });

  it("does not render an occurrences note for a one-off failure", async () => {
    const failures = [failureRow(FA_1, SESSION_B)];
    const candidates = extractSessionMemories({
      sessionId: SESSION_B as SessionId,
      projectId: PROJECT_ID as ProjectId,
      failedAttempts: failures.map((row) => JSON.parse(row) as FailedAttempt),
    });
    expect(candidates[0]?.occurrences).toBe(1);
    const keyword = dedupeKeywordFor(candidates[0]?.dedupeKey ?? "");
    await seed([memoryRow(MEM_A, SESSION_B, { keywords: [keyword] })], failures);
    activatePro();
    const code = await runBrainDigest(digestInput());
    expect(code).toBe(0);
    // "seen 1× this session" is noise, not signal — the note is a repeat marker.
    expect(out.some((l) => l.includes("seen "))).toBe(false);
  });

  it("renders 'seen N× this session' for collapsed repeat failures", async () => {
    const failures = [failureRow(FA_1, SESSION_B), failureRow(FA_2, SESSION_B)];
    const candidates = extractSessionMemories({
      sessionId: SESSION_B as SessionId,
      projectId: PROJECT_ID as ProjectId,
      failedAttempts: failures.map((row) => JSON.parse(row) as FailedAttempt),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.occurrences).toBe(2);
    const keyword = dedupeKeywordFor(candidates[0]?.dedupeKey ?? "");
    await seed([memoryRow(MEM_A, SESSION_B, { keywords: [keyword] })], failures);
    activatePro();
    const code = await runBrainDigest(digestInput());
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("seen 2× this session"))).toBe(true);
  });
});
