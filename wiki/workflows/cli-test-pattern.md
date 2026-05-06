---
title: CLI handler test pattern
tags: [workflow, testing, cli, citty]
sources:
  - apps/cli/src/commands/doctor.ts
  - apps/cli/src/commands/project.ts
  - apps/cli/test/doctor.test.ts
  - apps/cli/test/project.test.ts
status: active
created: 2026-05-06
updated: 2026-05-06
---

# CLI handler test pattern

Locked v0.1 pattern for testing Citty `defineCommand` handlers in `@megasaver/cli`. Mirrors `commands/doctor.ts` precedent. Use this for every new CLI command — do not reinvent.

## File layout

- Source: `apps/cli/src/commands/<command>.ts` — single file holds handler `defineCommand`, the inner `run<Command>(input): Promise<0 | 1>` pure function, and any per-command helpers.
- Test: `apps/cli/test/<command>.test.ts` — flat (no nested directories). Imports both the handler and inner helpers from `../src/commands/<command>.js`.

## Handler shape

The Citty handler is a thin adapter. The inner `run<Command>` takes an env-slice + IO callbacks so tests inject without mocking globals.

```ts
export type Run<Cmd>Input = {
  // ...args from CLI
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function run<Cmd>(input: Run<Cmd>Input): Promise<0 | 1> { /* ... */ }

export const <cmd>Command = defineCommand({
  meta: { name: "<cmd>", description: "..." },
  args: { /* citty args */ },
  async run({ args }) {
    const code = await run<Cmd>({
      // typeof guards on args
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

## Test invocation

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { <cmd>Command } from "../src/commands/<cmd>.js";

describe("<cmd>Command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
  });

  it("does the thing", async () => {
    await <cmd>Command.run?.({
      args: { /* parsed flags */ },
      cmd: <cmd>Command,
      rawArgs: [],
      data: undefined,
    } as never);
    expect(logSpy.mock.calls[0]?.[0]).toBe("expected");
    expect(process.exitCode).toBe(0);
  });
});
```

`as never` is required because Citty's `run` context type is exported but tests intentionally narrow it. `?.` because `run` is typed optional.

## Filesystem isolation

Tests that touch the store use `mkdtemp(join(tmpdir(), "megasaver-..."))` in `beforeEach` and `rm(root, { recursive: true, force: true })` in `afterEach`. Pass `--store: root` via `args` so `resolveStorePath` short-circuits the XDG branch. Never let a test write under the real `$XDG_DATA_HOME`.

## Known toolchain conflicts

- `process.env.HOME` (dot) fails TS strict (`TS4111: noPropertyAccessFromIndexSignature`); `process.env["HOME"]` (bracket) is required. Biome's `useLiteralKeys` flags bracket as unsafe-fixable to dot. **TS wins** — keep bracket form, suppress with the `biome-ignore` line shown above. Same for `XDG_DATA_HOME`.
- Regex with control characters (`/^[^\x00-\x1f\x7f-\x9f]+$/`) trips Biome `noControlCharactersInRegex`. The regex is intentional (it IS the guard); narrow `// biome-ignore lint/suspicious/noControlCharactersInRegex: ...` on the regex line only.

## Verification gate

Per CLAUDE.md §9: every handler ships with `pnpm --filter @megasaver/cli test` green AND `pnpm --filter @megasaver/cli typecheck` green AND `pnpm exec biome check` clean before commit. `pnpm verify` at branch tip before push.

## Related

- [[entities/core]] — registry signatures the handlers wrap.
- [[entities/cli]] — current CLI surface.
- [[concepts/wiki-first-token-discipline]] — read this page before opening `commands/doctor.ts` to copy the pattern.
