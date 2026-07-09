// packages/context-gate/test/firewall-wiring.test.ts
// Integration-style: drive runOutputPipeline against a real temp store with
// (a) a denied secret path and (b) a readable file containing a planted card
// + email, then assert the events.jsonl contents — including the end-to-end
// F-FW-1 value-free invariant.
//
// Mirror the setup of the existing pipeline tests: copy the registry/settings
// bootstrap from packages/context-gate/test/run.test.ts (the canonical
// "pipeline happy path" test) — same fake registry, same settings shape, same
// tmpdir store.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firewallEventSchema, firewallLogPath } from "../src/firewall-ledger.js";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

// Digit-sparse but schema-valid lowercase UUIDs: the F-FW-1 assertion greps the
// raw ledger for any 6+ digit run, so the fixture ids must carry none.
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ProjectId;
const SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as SessionId;
const NOW = "2026-07-08T12:00:00.000Z";
const NEW_ID = "fixed-id";
const CARD = "4111111111111111";

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

describe("firewall wiring — pipeline emits events", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-fw-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-fw-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(path: string) {
    return runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path,
      intent: "find the card",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
  }

  const NOTES_BODY = [
    `line with card ${CARD}`,
    "contact dev@example.com",
    "filler line to keep the pipeline in normal mode\n".repeat(20),
  ].join("\n");

  it("path deny → one blocked-read event with detector secret-path", async () => {
    const secretPath = join(projectRoot, ".env");
    const outcome = await run(secretPath);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("path_denied");

    const lines = readFileSync(firewallLogPath(store), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = firewallEventSchema.parse(JSON.parse(lines[0] as string));
    expect(event.kind).toBe("blocked-read");
    expect(event.detector).toBe("secret-path");
    expect(event.sourcePath?.endsWith(".env")).toBe(true);
  });

  it("planted card + email → redacted + observed events; ledger is value-free (F-FW-1)", async () => {
    const notes = join(projectRoot, "notes.md");
    await writeFile(notes, NOTES_BODY);
    const outcome = await run(notes);
    expect(outcome.ok).toBe(true);

    const ledgerText = readFileSync(firewallLogPath(store), "utf8");
    const events = ledgerText
      .trim()
      .split("\n")
      .map((l) => firewallEventSchema.parse(JSON.parse(l)));
    expect(events.filter((e) => e.kind === "redacted")).toEqual([
      expect.objectContaining({
        detector: "credit_card",
        count: 1,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      }),
    ]);
    expect(events.filter((e) => e.kind === "observed")).toEqual([
      expect.objectContaining({
        detector: "email",
        count: 1,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      }),
    ]);

    // F-FW-1: no matched value ever reaches the ledger.
    expect(/[0-9]{6,}/.test(ledgerText)).toBe(false);
    expect(ledgerText).not.toContain(CARD);
  });

  it("agent-visible result omits the value-free firewall field (stripped like trace)", async () => {
    const notes = join(projectRoot, "notes.md");
    await writeFile(notes, NOTES_BODY);
    const outcome = await run(notes);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The firewall counts are measurement data consumed only by the ledger; they
    // must never spend agent tokens (§P2.6, same as `trace`).
    expect("firewall" in outcome.result).toBe(false);
    expect("trace" in outcome.result).toBe(false);
    // ...while the ledger still recorded the redaction/observation events.
    expect(existsSync(firewallLogPath(store))).toBe(true);
  });

  it("ledger write failure never breaks the pipeline", async () => {
    // Pre-create <store>/firewall as a FILE so mkdir/append fails.
    writeFileSync(join(store, "firewall"), "x");
    const notes = join(projectRoot, "notes.md");
    await writeFile(notes, NOTES_BODY);
    const outcome = await run(notes);
    expect(outcome.ok).toBe(true);
    expect(existsSync(firewallLogPath(store))).toBe(false);
  });
});
