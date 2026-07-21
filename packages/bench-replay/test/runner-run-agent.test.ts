import { type Server, createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — the runner is a plain .mjs CLI script with no types; only
// runAgent is imported, and the module's CLI dispatch is guarded behind an
// entry-point check so this import does not execute a command.
import { runAgent } from "../../../scripts/bench-replay.mjs";

const NODE = process.execPath;

describe("runAgent", () => {
  // The capture proxy runs in the SAME process as the record loop, so the agent
  // MUST be spawned without blocking the event loop — a synchronous spawn would
  // starve the proxy of the request bodies the agent sends it, and the two would
  // deadlock. This asserts the loop stays live: an in-process timer must fire
  // WHILE the child is still running, which is impossible under a blocking spawn.
  it("does not block the event loop while the child runs", async () => {
    let timerFiredAt = 0;
    const started = Date.now();
    const timer = setTimeout(() => {
      timerFiredAt = Date.now() - started;
    }, 100);

    const result = await runAgent(NODE, ["-e", "setTimeout(() => {}, 600)"], {
      cwd: process.cwd(),
      env: process.env,
    });
    clearTimeout(timer);

    expect(result.status).toBe(0);
    // The 100ms timer fired long before the ~600ms child exited — proof the loop
    // was never blocked. Under a synchronous spawn timerFiredAt would be ~600.
    expect(timerFiredAt).toBeGreaterThan(0);
    expect(timerFiredAt).toBeLessThan(400);
  });

  it("serves an in-process HTTP request during the child's lifetime", async () => {
    let served = false;
    const server: Server = createServer((_req, res) => {
      served = true;
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    // The child fetches the in-process server mid-run; the response can only be
    // produced if this process's event loop is free to accept the connection.
    const child = `
      const t = setTimeout(() => {}, 400);
      fetch("http://127.0.0.1:${port}/").then(async (r) => {
        process.stdout.write(await r.text());
        clearTimeout(t);
      });
    `;
    const result = await runAgent(NODE, ["-e", child], {
      cwd: process.cwd(),
      env: process.env,
    });
    server.close();

    expect(result.status).toBe(0);
    expect(served).toBe(true);
    expect(result.stdout).toContain("ok");
  });

  it("captures stdout and reports a non-zero exit", async () => {
    const ok = await runAgent(NODE, ["-e", "process.stdout.write('hello')"], {
      cwd: process.cwd(),
      env: process.env,
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("hello");

    const bad = await runAgent(NODE, ["-e", "process.exit(3)"], {
      cwd: process.cwd(),
      env: process.env,
    });
    expect(bad.status).toBe(3);
  });
});

// Keep the import path honest: if the script moves, this resolves to a real file.
void fileURLToPath(new URL("../../../scripts/bench-replay.mjs", import.meta.url));
