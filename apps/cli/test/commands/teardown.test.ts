import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";
import { runTeardown } from "../../src/commands/teardown.js";

const proSpies = vi.hoisted(() => ({ composeTeardown: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.composeTeardown.mockImplementation(actual.composeTeardown);
  return { ...actual, composeTeardown: proSpies.composeTeardown };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

function event(i: number, returnedBytes: number): TokenSaverEvent {
  return {
    id: `e-${i}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt: "2023-11-05T00:00:00.000Z",
    sourceKind: "file",
    label: "read",
    rawBytes: returnedBytes,
    returnedBytes,
    bytesSaved: 0,
    savingRatio: 0,
    summary: "s",
    mode: "balanced",
  };
}

const tdEvents: TokenSaverEvent[] = Array.from({ length: 25 }, (_, i) => event(i, 100_000));

function tdReader(): SavingsEventReader {
  return () => ({ events: tdEvents, eventsByProject: { "proj-1": tdEvents } });
}

let root: string;
let outDir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-td-"));
  outDir = mkdtempSync(join(tmpdir(), "megasaver-td-out-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.composeTeardown.mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, {
    v: 1,
    tier: "pro",
    id: "cust-1",
    iat: 0,
    exp: null,
  });
  const res = activateLicense(root, key, { publicKey: keys.publicKey, now });
  expect(res.ok).toBe(true);
}

function baseInput(over: Partial<Parameters<typeof runTeardown>[0]> = {}) {
  const written = new Map<string, string>();
  return {
    input: {
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: tdReader(),
      readSaver: () => ({ enabled: true, mode: "balanced" as const }),
      readMemoryFileSizes: () => [],
      outDir,
      writeFile: (p: string, c: string) => void written.set(p, c),
      fileExists: () => false,
      stdout,
      stderr,
      ...over,
    },
    written,
  };
}

describe("runTeardown — gating", () => {
  it.each([{}, { json: true }, { force: true }])(
    "with NO license (%o): upsell, exit 0, nothing read/computed/written",
    async (flags) => {
      const readAllEvents = vi.fn(tdReader());
      const readSaver = vi.fn(() => null);
      const readMemoryFileSizes = vi.fn(() => []);
      const writeFile = vi.fn();

      const { input } = baseInput({
        readAllEvents,
        readSaver,
        readMemoryFileSizes,
        writeFile,
        ...flags,
      });
      const code = await runTeardown(input);

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("Mega Saver Pro");
      expect(text).toContain("mega license activate");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readSaver).not.toHaveBeenCalled();
      expect(readMemoryFileSizes).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(proSpies.composeTeardown).not.toHaveBeenCalled();
    },
  );
});

describe("runTeardown — entitled", () => {
  beforeEach(() => activatePro());

  it("--json emits the report and writes NO files", async () => {
    const writeFile = vi.fn();
    const { input } = baseInput({ json: true, writeFile });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      headline: { tokensReturned: number };
      culprits: unknown[];
      advice: unknown[];
    };
    expect(parsed.headline.tokensReturned).toBeGreaterThan(0);
    expect(Array.isArray(parsed.culprits)).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("file mode writes both artifacts and prints their paths", async () => {
    const { input, written } = baseInput();
    const code = await runTeardown(input);

    expect(code).toBe(0);
    const paths = [...written.keys()];
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.endsWith("teardown.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("teardown.svg"))).toBe(true);
    const md = written.get(join(outDir, "teardown.md")) ?? "";
    expect(md).toContain("## The culprits");
    expect(md).toContain("| file |");
    const svg = written.get(join(outDir, "teardown.svg")) ?? "";
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(out.join("\n")).toContain("teardown.md");
  });

  it("exists-guard refuses without --force and writes NEITHER file", async () => {
    const writeFile = vi.fn();
    const { input } = baseInput({
      writeFile,
      fileExists: (p: string) => p.endsWith("teardown.md"),
    });
    const code = await runTeardown(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--force");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("--force overwrites existing artifacts", async () => {
    const { input, written } = baseInput({ force: true, fileExists: () => true });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    expect(written.size).toBe(2);
  });

  it("real fs round-trip via the default writers", async () => {
    const { defaultTeardownFs } = await import("../../src/commands/teardown.js");
    const fs = defaultTeardownFs();
    const { input } = baseInput({ writeFile: fs.writeFile, fileExists: fs.fileExists });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "teardown.md"), "utf8")).toContain("Methodology");
    expect(readFileSync(join(outDir, "teardown.svg"), "utf8")).toContain("</svg>");
  });
});
