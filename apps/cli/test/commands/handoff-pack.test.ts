// apps/cli/test/commands/handoff-pack.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHandoffPacket, readHandoffEvents } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunHandoffPackInput, runHandoffPack } from "../../src/commands/handoff/pack.js";
import { HANDOFF_UPSELL, gate, parseExpires } from "../../src/commands/handoff/shared.js";
import type { ExecGit } from "../../src/git-delta.js";
import { ensureStoreReady } from "../../src/store.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 18, 12, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
const now = () => NOW_MS;
const HOUR = 3_600_000;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

let storeRoot: string;
let projectRoot: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-proj-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "h1", iat: 0, exp: null });
  expect(activateLicense(storeRoot, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

describe("handoff shared — HANDOFF_UPSELL", () => {
  it("names the feature, the activation command, and the pro URL", () => {
    expect(HANDOFF_UPSELL).toContain("Hot handoff");
    expect(HANDOFF_UPSELL).toContain("mega license activate");
    expect(HANDOFF_UPSELL).toContain("https://megasaver.dev/pro");
  });
});

describe("handoff shared — gate", () => {
  it("unentitled: prints the upsell and returns false", () => {
    const ok = gate({ storeRoot, now, publicKey: keys.publicKey, stdout });
    expect(ok).toBe(false);
    expect(out).toEqual([HANDOFF_UPSELL]);
  });

  it("entitled: returns true and prints nothing", () => {
    activatePro();
    const ok = gate({ storeRoot, now, publicKey: keys.publicKey, stdout });
    expect(ok).toBe(true);
    expect(out).toEqual([]);
  });
});

describe("handoff shared — parseExpires", () => {
  it("defaults to now + 24h", () => {
    expect(parseExpires(undefined, NOW_MS)).toBe(NOW_MS + 24 * HOUR);
  });

  it("parses <n>h and <n>d", () => {
    expect(parseExpires("3h", NOW_MS)).toBe(NOW_MS + 3 * HOUR);
    expect(parseExpires("2d", NOW_MS)).toBe(NOW_MS + 48 * HOUR);
    expect(parseExpires("1h", NOW_MS)).toBe(NOW_MS + HOUR);
    expect(parseExpires("10d", NOW_MS)).toBe(NOW_MS + 240 * HOUR);
  });

  it("rejects malformed values with null", () => {
    for (const bad of ["0h", "h", "12", "1w", "-1h", "1.5h", "", "01h", "1H"]) {
      expect(parseExpires(bad, NOW_MS)).toBeNull();
    }
  });
});

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "alpha",
    rootPath: projectRoot,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  } as never);
  registry.createMemoryEntry({
    projectId: PROJECT_ID,
    id: "22222222-2222-4222-8222-222222222222",
    type: "decision",
    title: "use vitest",
    content: "vitest over jest for ESM",
    keywords: [],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    scope: "project",
    sessionId: null,
    approval: "approved",
  } as never);
}

// Unlisted git calls throw — exactly what a real failing git does; tryGit maps it to null.
const gitFixture: ExecGit = (args) => {
  const key = args.join(" ");
  if (key === "rev-parse --abbrev-ref HEAD") return "feat/x\n";
  if (key.startsWith("log ")) return "";
  if (key === "status --porcelain") return " M src/app.ts\n";
  if (key === "diff") return "diff --git a/src/app.ts b/src/app.ts\n+const x = 1;\n";
  if (key === "diff --cached") return "";
  if (key === "rev-parse HEAD") return "deadbeef\n";
  throw new Error(`unexpected git call: ${key}`);
};

function packedFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".megahandoff"));
}

function run(over: Partial<RunHandoffPackInput> = {}) {
  const ensureStore = vi.fn(() => ensureStoreReady(storeRoot));
  const code = runHandoffPack({
    storeRoot,
    cwd: projectRoot,
    now,
    newId: () => "33333333-3333-4333-8333-333333333333",
    to: "codex",
    dryRun: false,
    copy: false,
    json: false,
    publicKey: keys.publicKey,
    execGit: gitFixture,
    ensureStore,
    stdout,
    stderr,
    ...over,
  });
  return { code, ensureStore };
}

describe("runHandoffPack — gating and boundaries", () => {
  it("unentitled non-dry-run: upsell, exit 0, zero store IO, nothing written", async () => {
    const { code, ensureStore } = run();
    expect(await code).toBe(0);
    expect(out).toEqual([HANDOFF_UPSELL]);
    expect(ensureStore).not.toHaveBeenCalled();
    expect(packedFiles(projectRoot)).toEqual([]);
  });

  it("unlicensed --dry-run: reads run, prints counts, writes nothing", async () => {
    await seedProject();
    const { code, ensureStore } = run({ dryRun: true });
    expect(await code).toBe(0);
    expect(ensureStore).toHaveBeenCalled();
    expect(out.join("\n")).toContain("dry-run: would pack memories 1");
    expect(packedFiles(projectRoot)).toEqual([]);
    expect(readHandoffEvents({ root: storeRoot }, PROJECT_ID)).toEqual([]);
  });

  it("invalid --to: exit 1 before gate and store", async () => {
    const { code, ensureStore } = run({ to: "vim" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid target "vim"');
    expect(ensureStore).not.toHaveBeenCalled();
  });

  it("invalid --expires: exit 1 with the flag named", async () => {
    activatePro();
    const { code } = run({ expires: "1w" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid --expires "1w"');
  });

  it("cwd outside any registered project: exit 1 pointing at mega init", async () => {
    activatePro();
    await seedProject();
    const outside = mkdtempSync(join(tmpdir(), "megasaver-cli-handoff-outside-"));
    try {
      const { code } = run({ cwd: outside });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("mega init");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("malformed permissions.yaml aborts fail-closed, nothing written", async () => {
    activatePro();
    await seedProject();
    mkdirSync(join(projectRoot, ".megasaver"), { recursive: true });
    writeFileSync(join(projectRoot, ".megasaver", "permissions.yaml"), "deny: [\n");
    const { code } = run();
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("permissions.yaml");
    expect(packedFiles(projectRoot)).toEqual([]);
    expect(readHandoffEvents({ root: storeRoot }, PROJECT_ID)).toEqual([]);
  });
});

describe("runHandoffPack — entitled", () => {
  beforeEach(async () => {
    activatePro();
    await seedProject();
  });

  it("packs to the default <project>-<YYYYMMDD-HHmm>.megahandoff, parseable, event appended", async () => {
    const { code } = run();
    expect(await code).toBe(0);
    const path = join(projectRoot, "alpha-20260718-1200.megahandoff");
    expect(packedFiles(projectRoot)).toEqual(["alpha-20260718-1200.megahandoff"]);
    const packet = parseHandoffPacket(readFileSync(path, "utf8"), { now: NOW_MS });
    expect(packet.manifest.targetAgent).toBe("codex");
    expect(packet.manifest.sourceAgent).toBe("unknown");
    expect(packet.manifest.expiresAt).toBe(new Date(NOW_MS + 24 * HOUR).toISOString());
    expect(packet.payload.memories).toHaveLength(1);
    expect(packet.payload.resumeInstructions).toContain("another agent");
    const events = readHandoffEvents({ root: storeRoot }, PROJECT_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("pack");
    expect(events[0]?.targetAgent).toBe("codex");
    expect(out.join("\n")).toContain(`packed ${path}`);
  });

  it("--out overrides the file name; --from lands in manifest and resume text", async () => {
    const { code } = run({ outPath: "custom.megahandoff", from: "claude-code" });
    expect(await code).toBe(0);
    const packet = parseHandoffPacket(
      readFileSync(join(projectRoot, "custom.megahandoff"), "utf8"),
      { now: NOW_MS },
    );
    expect(packet.manifest.sourceAgent).toBe("claude-code");
    expect(packet.payload.resumeInstructions).toContain("claude-code");
  });

  it("--expires 3h shortens the manifest expiry", async () => {
    const { code } = run({ expires: "3h", outPath: "e.megahandoff" });
    expect(await code).toBe(0);
    const packet = parseHandoffPacket(readFileSync(join(projectRoot, "e.megahandoff"), "utf8"), {
      now: NOW_MS,
    });
    expect(packet.manifest.expiresAt).toBe(new Date(NOW_MS + 3 * HOUR).toISOString());
  });

  it("--json emits the pack report", async () => {
    const { code } = run({ json: true, outPath: "j.megahandoff" });
    expect(await code).toBe(0);
    const report = JSON.parse(out.join("\n")) as {
      status: string;
      path: string;
      counts: { memories: number };
      redactionFindings: number;
    };
    expect(report.status).toBe("packed");
    expect(report.path).toBe(join(projectRoot, "j.megahandoff"));
    expect(report.counts.memories).toBe(1);
  });

  it("--copy hands the PATH (never content) to the clipboard hook; absent flag never copies", async () => {
    const copyPath = vi.fn();
    const first = run({ copy: true, copyPath, outPath: "c.megahandoff" });
    expect(await first.code).toBe(0);
    expect(copyPath).toHaveBeenCalledTimes(1);
    expect(copyPath).toHaveBeenCalledWith(join(projectRoot, "c.megahandoff"));
    copyPath.mockClear();
    const second = run({ copy: false, copyPath, outPath: "c2.megahandoff" });
    expect(await second.code).toBe(0);
    expect(copyPath).not.toHaveBeenCalled();
  });

  it("degraded git: exit 0, note printed, packet still written", async () => {
    const noGit: ExecGit = () => {
      throw new Error("no git");
    };
    const { code } = run({ execGit: noGit, outPath: "g.megahandoff" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("git unavailable");
    const packet = parseHandoffPacket(readFileSync(join(projectRoot, "g.megahandoff"), "utf8"), {
      now: NOW_MS,
    });
    expect(packet.payload.git).toBeNull();
  });

  it("no open session: report notes it, exit 0", async () => {
    const { code } = run({ outPath: "s.megahandoff" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("no open session");
  });
});
