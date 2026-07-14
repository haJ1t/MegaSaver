import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_HISTORY_UPSELL, runMemoryHistory } from "../../src/commands/memory/history.js";
import { memoryCommand } from "../../src/commands/memory/index.js";
import { runMemoryReopen } from "../../src/commands/memory/reopen.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";
const TS_OLD = "2026-06-01T00:00:00.000Z";
const T_CLOSE = "2026-07-10T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; validTo?: string | null };

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

describe("mega memory history / reopen", () => {
  let store: string;
  let proPublicKey: KeyObject | undefined;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-history-reopen-"));
    proPublicKey = undefined;
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  function activatePro(): void {
    const keys = generateKeyPairSync("ed25519");
    const key = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "t1",
      iat: 0,
      exp: null,
    });
    activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
    proPublicKey = keys.publicKey;
  }

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS_OLD, updatedAt: TS_OLD },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      keywords: [],
      confidence: "high",
      source: "manual",
      stale: false,
      approval: "approved",
    };
    const rows = [
      {
        ...base,
        id: OLD_ID,
        title: "Use npm",
        content: "use npm for installs",
        validTo: T_CLOSE,
        createdAt: TS_OLD,
        updatedAt: TS_OLD,
      },
      {
        ...base,
        id: NEW_ID,
        title: "Use pnpm",
        content: "use pnpm for installs",
        supersedesId: OLD_ID,
        reason: "npm broke on CI",
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function historyInput(
    id: string,
    over: Partial<Parameters<typeof runMemoryHistory>[0]> = {},
  ): Parameters<typeof runMemoryHistory>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  function reopenInput(
    id: string,
    over: Partial<Parameters<typeof runMemoryReopen>[0]> = {},
  ): Parameters<typeof runMemoryReopen>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      now: () => NOW,
      ...over,
    };
  }

  it("registers history and reopen subcommands", () => {
    const names = Object.keys(memoryCommand.subCommands ?? {});
    expect(names).toContain("history");
    expect(names).toContain("reopen");
  });

  it("pins the exact upsell sentence", () => {
    expect(MEMORY_HISTORY_UPSELL).toBe(
      "Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>.",
    );
  });

  it("free tier with ancestors prints the counted upsell line, exit 0", async () => {
    await seedStore();
    const code = await runMemoryHistory(historyInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([`1 prior versions. ${MEMORY_HISTORY_UPSELL}`]);
  });

  it("free tier without ancestors omits the count prefix", async () => {
    await seedStore();
    const code = await runMemoryHistory(historyInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_HISTORY_UPSELL]);
  });

  it("pro tier prints the chain oldest to newest", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryHistory(historyInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([
      `${OLD_ID}  Use npm`,
      `  ${TS_OLD} -> ${T_CLOSE}`,
      `${NEW_ID}  Use pnpm`,
      `  ${TS_NEW} -> current`,
      "  reason: npm broke on CI",
    ]);
  });

  it("pro tier --json emits the full chain array oldest to newest", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryHistory(historyInput(NEW_ID, { jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "[]") as Array<{ id: string }>;
    expect(parsed.map((e) => e.id)).toEqual([OLD_ID, NEW_ID]);
  });

  it("reopen clears validTo and prints the confirmation", async () => {
    await seedStore();
    const code = await runMemoryReopen(reopenInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([`reopened ${OLD_ID} ("Use npm")`]);
    expect((await readRows()).find((r) => r.id === OLD_ID)?.validTo).toBeNull();
  });

  it("reopen of a non-closed entry errors with exit 1", async () => {
    await seedStore();
    await runMemoryReopen(reopenInput(OLD_ID));
    lines.length = 0;
    errLines.length = 0;
    const again = await runMemoryReopen(reopenInput(OLD_ID));
    expect(again).toBe(1);
    expect(errLines).toContain(`error: memory ${OLD_ID} is not closed`);

    errLines.length = 0;
    const never = await runMemoryReopen(reopenInput(NEW_ID));
    expect(never).toBe(1);
    expect(errLines).toContain(`error: memory ${NEW_ID} is not closed`);
  });

  it("reopen --json prints the updated entry", async () => {
    await seedStore();
    const code = await runMemoryReopen(reopenInput(OLD_ID, { jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "{}") as { id: string; validTo?: string | null };
    expect(parsed.id).toBe(OLD_ID);
    expect(parsed.validTo).toBeNull();
  });
});
