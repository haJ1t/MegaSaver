import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(tmpdir(), "megasaver-no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2026-08-06T10:00:00Z",
  GIT_COMMITTER_DATE: "2026-08-06T10:00:00Z",
};

export const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });

export function initFixtureRepo(dir: string): void {
  git(dir, "init");
  git(dir, "checkout", "-b", "main");
  git(dir, "config", "user.email", "test@megasaver.dev");
  git(dir, "config", "user.name", "Test");
  writeFileSync(
    join(dir, "alpha.ts"),
    "export function alpha(): number {\n  return 1;\n}\n",
  );
  git(dir, "add", "alpha.ts");
  git(dir, "commit", "-m", "feat(core): seed alpha");
}
