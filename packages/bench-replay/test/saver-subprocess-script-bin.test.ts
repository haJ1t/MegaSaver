import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSpawnedSaver, prepareSaverStore } from "../src/saver-subprocess.js";

// --mega-bin is routinely a JS entrypoint: the harness's own fixtures write a
// mega.cjs, and the real bin the store-isolation test uses is apps/cli/dist/cli.js.
// Handing such a path straight to execFileSync makes the OS loader responsible for
// running it, which only works where a shebang works — win32 fails EFTYPE and took
// the whole windows-latest `verify` job down. The fixture below therefore has NO
// shebang and NO exec bit, so the same "the OS cannot start this file" condition
// reproduces on POSIX: it fails before the fix on every platform, and passes after.
function writeScriptBin(root: string): string {
  const path = join(root, "mega.cjs");
  writeFileSync(
    path,
    `const { readFileSync } = require("node:fs");
const argv = process.argv.slice(2).join(" ");
if (argv.startsWith("session saver default enable")) process.stdout.write('{"ok":true}\\n');
else if (argv.startsWith("session saver resolve")) process.stdout.write('{"enabled":true,"mode":"balanced"}\\n');
else if (argv.startsWith("hooks saver")) {
  readFileSync(0, "utf8");
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { updatedToolOutput: "compressed" } }) + "\\n",
  );
} else {
  process.stderr.write("script bin: unexpected args " + argv + "\\n");
  process.exit(2);
}
`,
    { mode: 0o644 },
  );
  return path;
}

describe("saver subprocess with a script --mega-bin", () => {
  let root: string;
  let megaBin: string;
  let cwd: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "bench-script-bin-"));
    cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    megaBin = writeScriptBin(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("enables and reads back the saver through a non-executable .cjs bin", () => {
    expect(() =>
      prepareSaverStore({ megaBin, cwd, storeRoot: join(root, "store"), mode: "balanced" }),
    ).not.toThrow();
  });

  it("runs the hook through a non-executable .cjs bin", () => {
    const apply = makeSpawnedSaver({
      megaBin,
      cwd,
      sessionId: randomUUID(),
      storeRoot: join(root, "store"),
    });
    expect(apply("raw tool output", { toolUseId: "t1", toolName: "Bash", toolInput: {} })).toBe(
      "compressed",
    );
  });
});
