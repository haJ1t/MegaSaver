import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryExplain } from "../../src/commands/memory/explain.js";
import { runMemoryList } from "../../src/commands/memory/list.js";
import { runMemorySearch } from "../../src/commands/memory/search.js";
import { MEMORY_AS_OF_UPSELL } from "../../src/commands/memory/shared.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";
const TS_OLD = "2026-06-01T00:00:00.000Z";
const T_CLOSE = "2026-07-10T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const T_BEFORE = "2026-07-05T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

describe("mega memory explain lineage + search/list --as-of", () => {
  let store: string;
  let proPublicKey: KeyObject | undefined;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-explain-asof-"));
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
        validFrom: TS_NEW,
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }

  const env = {
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
  };

  function explainInput(id: string): Parameters<typeof runMemoryExplain>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
    };
  }

  function searchInput(
    over: Partial<Parameters<typeof runMemorySearch>[0]> = {},
  ): Parameters<typeof runMemorySearch>[0] {
    return {
      projectName: "demo",
      queryFlag: undefined,
      typeFlag: undefined,
      confidenceFlag: undefined,
      scopeFlag: undefined,
      includeStale: false,
      limitFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  function listInput(
    over: Partial<Parameters<typeof runMemoryList>[0]> = {},
  ): Parameters<typeof runMemoryList>[0] {
    return {
      projectName: "demo",
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  it("pins the exact --as-of upsell sentence", () => {
    expect(MEMORY_AS_OF_UPSELL).toBe(
      "Time-travel queries (--as-of) are a Mega Saver Pro feature. Activate a key: mega license activate <key>.",
    );
  });

  it("explain shows lineage lines on the successor", async () => {
    await seedStore();
    const code = await runMemoryExplain(explainInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toContain(`${"validFrom".padEnd(16, " ")}${TS_NEW}`);
    expect(lines).toContain(`${"supersedesId".padEnd(16, " ")}${OLD_ID}`);
    expect(lines).toContain(`${"supersedes".padEnd(16, " ")}${OLD_ID} ("Use npm")`);
  });

  it("explain shows validTo and supersededBy on the predecessor", async () => {
    await seedStore();
    const code = await runMemoryExplain(explainInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toContain(`${"validTo".padEnd(16, " ")}${T_CLOSE}`);
    expect(lines).toContain(`${"supersededBy".padEnd(16, " ")}${NEW_ID} ("Use pnpm")`);
  });

  it("pro search --as-of returns the predecessor at a historical instant", async () => {
    await seedStore();
    activatePro();
    const code = await runMemorySearch(searchInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith(OLD_ID))).toBe(true);
    expect(lines.some((l) => l.startsWith(NEW_ID))).toBe(false);
  });

  it("search without the flag returns only the successor and never gates", async () => {
    await seedStore();
    // No license on purpose: if the no-flag path called checkEntitlement, the
    // upsell (not the hits) would print.
    const code = await runMemorySearch(searchInput());
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith(NEW_ID))).toBe(true);
    expect(lines.some((l) => l.startsWith(OLD_ID))).toBe(false);
    expect(lines.join("\n")).not.toContain("Pro feature");
  });

  it("free search --as-of prints the upsell and exits 0", async () => {
    await seedStore();
    const code = await runMemorySearch(searchInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_AS_OF_UPSELL]);
  });

  it("free list --as-of prints the upsell and exits 0", async () => {
    await seedStore();
    const code = await runMemoryList(listInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_AS_OF_UPSELL]);
  });

  it("pro list --as-of filters to entries current at the instant", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryList(listInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith(OLD_ID)).toBe(true);
  });

  it("list without the flag shows everything, unchanged", async () => {
    await seedStore();
    const code = await runMemoryList(listInput());
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("Pro feature");
  });

  it("pro search --as-of with an invalid datetime exits 1", async () => {
    await seedStore();
    activatePro();
    const code = await runMemorySearch(searchInput({ asOfFlag: "yesterday" }));
    expect(code).toBe(1);
    expect(errLines).toContain('error: invalid as-of "yesterday", expected ISO-8601 datetime');
  });

  it("pro list --as-of with an invalid datetime exits 1", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryList(listInput({ asOfFlag: "yesterday" }));
    expect(code).toBe(1);
    expect(errLines).toContain('error: invalid as-of "yesterday", expected ISO-8601 datetime');
  });
});
