import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSavingsFix } from "../../src/commands/savings/fix.js";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";

const proSpies = vi.hoisted(() => ({ computeFixPlan: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.computeFixPlan.mockImplementation(actual.computeFixPlan);
  return { ...actual, computeFixPlan: proSpies.computeFixPlan };
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

function event(
  i: number,
  sourceKind: TokenSaverEvent["sourceKind"],
  returnedBytes: number,
): TokenSaverEvent {
  return {
    id: `e-${i}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt: "2023-11-05T00:00:00.000Z",
    sourceKind,
    label: "read",
    rawBytes: returnedBytes,
    returnedBytes,
    bytesSaved: 0,
    savingRatio: 0,
    summary: "s",
    mode: "balanced",
  };
}

const fixEvents: TokenSaverEvent[] = Array.from({ length: 25 }, (_, i) =>
  event(i, "file", 100_000),
);

function fixReader(): SavingsEventReader {
  return () => ({ events: fixEvents, eventsByProject: { "proj-1": fixEvents } });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-fix-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.computeFixPlan.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

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

function baseInput(over: Partial<Parameters<typeof runSavingsFix>[0]> = {}) {
  return {
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readAllEvents: fixReader(),
    readSaver: () => null,
    readMemoryFileSizes: () => [],
    writeSaver: vi.fn(),
    stdout,
    stderr,
    ...over,
  };
}

describe("runSavingsFix — gating", () => {
  it.each([{}, { apply: true }, { json: true }])(
    "with NO license (%o): upsell, exit 0, nothing read/computed/written",
    async (flags) => {
      const readAllEvents = vi.fn(fixReader());
      const readSaver = vi.fn(() => null);
      const readMemoryFileSizes = vi.fn(() => []);
      const writeSaver = vi.fn();

      const code = await runSavingsFix(
        baseInput({ readAllEvents, readSaver, readMemoryFileSizes, writeSaver, ...flags }),
      );

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("Mega Saver Pro");
      expect(text).toContain("mega license activate");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readSaver).not.toHaveBeenCalled();
      expect(readMemoryFileSizes).not.toHaveBeenCalled();
      expect(writeSaver).not.toHaveBeenCalled();
      expect(proSpies.computeFixPlan).not.toHaveBeenCalled();
    },
  );
});

describe("runSavingsFix — propose mode (entitled)", () => {
  beforeEach(() => activatePro());

  it("prints tagged actions and the --apply footer; NEVER writes", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(baseInput({ writeSaver }));

    expect(code).toBe(0);
    expect(proSpies.computeFixPlan).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text).toContain("[apply]");
    expect(text).toContain("Token saver is off");
    expect(text).toContain("(est.)");
    expect(text).toContain("Run with --apply to apply 1 fix(es).");
    expect(writeSaver).not.toHaveBeenCalled();
  });

  it("advice-only plan omits the --apply footer", async () => {
    const code = await runSavingsFix(
      baseInput({
        readSaver: () => ({ enabled: true, mode: "balanced" }),
        readMemoryFileSizes: () => [{ path: "CLAUDE.md", bytes: 20_000 }],
      }),
    );

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[advice]");
    expect(text).toContain("CLAUDE.md");
    expect(text).not.toContain("Run with --apply");
  });

  it("no actions at all → honest empty line, exit 0", async () => {
    const code = await runSavingsFix(
      baseInput({
        readAllEvents: () => ({ events: [], eventsByProject: {} }),
        readSaver: () => ({ enabled: true, mode: "balanced" }),
      }),
    );

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Nothing to fix — no waste signals yet.");
  });

  it("--json emits { plan } without applied", async () => {
    const code = await runSavingsFix(baseInput({ json: true }));

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      plan: { actions: { kind: string }[] };
      applied?: unknown;
    };
    expect(parsed.plan.actions.map((a) => a.kind)).toContain("enable-saver");
    expect(parsed.applied).toBeUndefined();
  });
});

describe("runSavingsFix — apply mode (entitled)", () => {
  beforeEach(() => activatePro());

  it("--apply calls writeSaver once with enabled/balanced and prints was→now", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(baseInput({ apply: true, writeSaver }));

    expect(code).toBe(0);
    expect(writeSaver).toHaveBeenCalledTimes(1);
    expect(writeSaver).toHaveBeenCalledWith({ enabled: true, mode: "balanced" });
    const text = out.join("\n");
    expect(text).toContain("applied: enable-saver");
    expect(text).toContain("was: absent");
    expect(text).toContain("now: enabled/balanced");
  });

  it("--apply round-trips through the REAL saver store (default reader+writer)", async () => {
    const { defaultSaverReader, defaultSaverWriter } = await import(
      "../../src/commands/savings/fix.js"
    );
    const { readExactRecord } = await import("@megasaver/context-gate");
    const { encodeWorkspaceKey } = await import("@megasaver/shared");
    const cwd = "/tmp/fix-workspace";

    const code = await runSavingsFix(
      baseInput({
        apply: true,
        readSaver: defaultSaverReader(root, cwd),
        writeSaver: defaultSaverWriter(root, cwd),
      }),
    );

    expect(code).toBe(0);
    const rec = readExactRecord(root, encodeWorkspaceKey(cwd));
    expect(rec).toEqual({ kind: "v1-exact", enabled: true, mode: "balanced" });
    // The wrapper reads back what the writer wrote — full reader/writer agreement.
    expect(defaultSaverReader(root, cwd)()).toEqual({ enabled: true, mode: "balanced" });
  });

  it("--apply with an advice-only plan writes nothing and says so", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(
      baseInput({
        apply: true,
        writeSaver,
        readSaver: () => ({ enabled: true, mode: "balanced" }),
        readMemoryFileSizes: () => [{ path: "CLAUDE.md", bytes: 20_000 }],
      }),
    );

    expect(code).toBe(0);
    expect(writeSaver).not.toHaveBeenCalled();
    // Default fixEvents (25 "file"/"read" events, no savings) also trigger
    // R3 advise-tool-route and R4 advise-outline alongside R5 for CLAUDE.md,
    // so the advice-only plan here has 3 items, not 1.
    expect(out.join("\n")).toContain("Nothing to apply — 3 advice item(s) above.");
  });

  it("--apply --json emits { plan, applied }", async () => {
    const code = await runSavingsFix(baseInput({ apply: true, json: true, writeSaver: vi.fn() }));

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      plan: unknown;
      applied: { kind: string; was: string; now: string }[];
    };
    expect(parsed.applied).toEqual([
      { kind: "enable-saver", was: "absent", now: "enabled/balanced" },
    ]);
  });

  it("bump path reports was: safe", async () => {
    // 1 event, 4_000_000 returned bytes → 1M tokens, ratio ≈ 0.09 → R2 fires at safe.
    const weakEvents = [event(0, "file", 4_000_000)];
    const writeSaver = vi.fn();
    const code = await runSavingsFix(
      baseInput({
        apply: true,
        writeSaver,
        readAllEvents: () => ({ events: weakEvents, eventsByProject: {} }),
        readSaver: () => ({ enabled: true, mode: "safe" }),
      }),
    );

    expect(code).toBe(0);
    expect(writeSaver).toHaveBeenCalledWith({ enabled: true, mode: "balanced" });
    expect(out.join("\n")).toContain("was: safe");
  });

  it("disabled saver applies with was: disabled", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(
      baseInput({
        apply: true,
        writeSaver,
        readSaver: () => ({ enabled: false, mode: "balanced" }),
      }),
    );

    expect(code).toBe(0);
    expect(writeSaver).toHaveBeenCalledWith({ enabled: true, mode: "balanced" });
    expect(out.join("\n")).toContain("was: disabled");
  });
});

describe("defaultMemoryFileReader", () => {
  it("stats only existing files, size only", async () => {
    const { defaultMemoryFileReader } = await import("../../src/commands/savings/fix.js");
    const { mkdtempSync: mkTmp, writeFileSync } = await import("node:fs");
    const dir = mkTmp(join(tmpdir(), "megasaver-fix-md-"));
    writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(1_000));

    const files = defaultMemoryFileReader(dir)();
    expect(files).toEqual([{ path: "CLAUDE.md", bytes: 1_000 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
