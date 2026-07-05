import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunGuiResult, runGui } from "../../src/commands/gui.js";

// The CLI ships the built GUI dist, but the workspace apps/gui/dist is the same
// artifact resolveShippedGuiDistDir falls back to in dev. Point the command at
// it directly so the test does not depend on a prior `npm pack`.
const DIST_DIR = join(__dirname, "..", "..", "..", "gui", "dist");

let store: string;
let started: RunGuiResult | undefined;
const lines: string[] = [];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-cli-gui-"));
  lines.length = 0;
  started = undefined;
});
afterEach(async () => {
  if (started) await started.stop();
  rmSync(store, { recursive: true, force: true });
});

function baseInput(overrides: Partial<Parameters<typeof runGui>[0]> = {}) {
  return {
    port: 0,
    open: false,
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    distDir: DIST_DIR,
    stdout: (l: string) => lines.push(l),
    stderr: (l: string) => lines.push(l),
    ...overrides,
  };
}

describe("mega gui — runGui", () => {
  it("binds 127.0.0.1 on an ephemeral port and serves the GUI + walls /api", async () => {
    started = await runGui(baseInput());
    const addr = started.server.address();
    expect(addr).not.toBeNull();
    expect(typeof addr === "object" && addr && addr.address).toBe("127.0.0.1");

    const base = `http://127.0.0.1:${started.port}`;

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");

    const noToken = await fetch(`${base}/api/health`);
    expect(noToken.status).toBe(401);

    const withHeader = await fetch(`${base}/api/health`, {
      headers: { authorization: `Bearer ${started.token}` },
    });
    expect(withHeader.status).toBe(200);

    const withQuery = await fetch(`${base}/api/health?token=${started.token}`);
    expect(withQuery.status).toBe(200);
  });

  it("prints a tokenized 127.0.0.1 url", async () => {
    started = await runGui(baseInput());
    const printed = lines.find((l) => l.includes("http://127.0.0.1:"));
    expect(printed).toBeDefined();
    expect(printed).toContain("127.0.0.1");
    expect(printed).toContain(`token=${started.token}`);
  });

  it("ALWAYS builds the handler with a token (no auth-less path)", async () => {
    started = await runGui(baseInput());
    expect(started.token.length).toBeGreaterThanOrEqual(16);
    // Proof the wall is armed: the raw /api probe above returns 401. Re-assert
    // here so a mutation dropping the token is caught by this test in isolation.
    const res = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    expect(res.status).toBe(401);
  });

  it("derives the CORS allowlist from the BOUND port (not the requested port 0)", async () => {
    // With port:0 the bound port is only known after listen. A browser served
    // same-origin sends Origin: http://127.0.0.1:<boundPort> on its writes; if
    // the allowlist was derived from the requested port (0), that write is
    // wrongly 403'd. Assert the real serving origin is accepted.
    started = await runGui(baseInput());
    const origin = `http://127.0.0.1:${started.port}`;
    const res = await fetch(`http://127.0.0.1:${started.port}/api/health?token=${started.token}`, {
      headers: { origin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("does NOT open a browser when open:false", async () => {
    const openBrowser = vi.fn();
    started = await runGui(baseInput({ openBrowser }));
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("opens the browser with the tokenized url when open:true", async () => {
    const openBrowser = vi.fn();
    started = await runGui(baseInput({ open: true, openBrowser }));
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith(started.url);
  });
});
