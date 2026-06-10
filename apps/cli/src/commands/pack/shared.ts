import { isAbsolute, resolve } from "node:path";
import { SkillPackError } from "@megasaver/skill-packs";
import { type CliMessage, skillPackErrorMessage } from "../../errors.js";

export type PackEnv = {
  rootFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// --root defaults to cwd (mirrors `mega project create --root`). The
// future skill runtime resolves packs via the registered
// project.rootPath, so installs should target the project root.
export function resolveWorkspaceRoot(env: PackEnv): string {
  if (env.rootFlag !== undefined && env.rootFlag !== "") {
    return isAbsolute(env.rootFlag) ? env.rootFlag : resolve(env.cwd, env.rootFlag);
  }
  return env.cwd;
}

export function packErrorToCli(err: unknown): CliMessage {
  if (err instanceof SkillPackError) return skillPackErrorMessage(err.code, err.message);
  return { message: `error: unexpected failure: ${String(err)}`, exitCode: 1 };
}
