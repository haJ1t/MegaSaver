import { execFileSync } from "node:child_process";
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemorySweep } from "../../src/commands/memory/sweep.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const T_CREATE = "2026-07-02T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOO_V1 = "export function foo(): number {\n  return 1;\n}\n";
const FOO_V2 = "export function foo(): number {\n  return 2;\n}\n";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

type StoredRow = {
  id: string;
  stale?: boolean;
  tier?: string;
  lastVerified?: { result: string };
};

let store: string;
let repo: string;
let proPublicKey: KeyObject | undefined;
let out: string[];
let err: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-sweep-verify-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-sweep-verify-repo-"));
  proPublicKey = undefined;
  out = [];
  err = [];
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  await writeFile(join(repo, "a.ts"), FOO_V1);
  git(["add", "."], repo);
  git(["commit", "-m", "add a"], repo);
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

async function seedContradictedFixture(): Promise<void> {
  const code = await runMemoryCreate({
    projectName: "demo",
    scopeFlag: "project",
    contentFlag: "foo returns 1",
    sessionFlag: undefined,
    fileFlags: ["a.ts"],
    symbolFlags: ["foo"],
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: () => {},
    stderr: () => {},
    newId: () => ENTRY_ID,
    now: () => T_CREATE,
  });
  expect(code).toBe(0);
  await writeFile(join(repo, "a.ts"), FOO_V2);
  git(["add", "."], repo);
  git(["commit", "-m", "change foo"], repo);
}

function sweepInput(over: Record<string, unknown> = {}) {
  return {
    projectName: "demo",
    storeFlag: store,
    jsonFlag: false,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    now: NOW,
    nowMs: () => Date.parse(NOW),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  } as Parameters<typeof runMemorySweep>[0];
}

async function readRows(): Promise<StoredRow[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredRow);
}

describe("mega memory sweep — verify pre-pass", () => {
  it("free tier: sweep is byte-identical to today (no pre-pass, no new output)", async () => {
    await seedContradictedFixture();
    const code = await runMemorySweep(sweepInput());
    expect(code).toBe(0);
    expect(out).toEqual(["archived=0 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.stale).toBe(false);
    expect(row?.lastVerified).toBeUndefined();
    expect(row?.tier).toBeUndefined();
  });

  it("entitled: pre-pass flips the contradicted row and the same run archives it", async () => {
    await seedContradictedFixture();
    activatePro();
    const code = await runMemorySweep(sweepInput());
    expect(code).toBe(0);
    expect(out).toEqual(["archived=1 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.stale).toBe(true);
    expect(row?.lastVerified?.result).toBe("contradicted");
    expect(row?.tier).toBe("archival");
  });

  it("--no-verify skips the pre-pass even when entitled", async () => {
    await seedContradictedFixture();
    activatePro();
    const code = await runMemorySweep(sweepInput({ verifyFlag: false }));
    expect(code).toBe(0);
    expect(out).toEqual(["archived=0 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.lastVerified).toBeUndefined();
  });
});
