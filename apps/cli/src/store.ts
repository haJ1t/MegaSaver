import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export type ResolveStorePathInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
};

const storeFlagSchema = z.string().trim().min(1);

export function resolveStorePath(input: ResolveStorePathInput): string {
  const { storeFlag, cwd, home, xdgDataHome } = input;
  if (storeFlag !== undefined) {
    storeFlagSchema.parse(storeFlag);
    return isAbsolute(storeFlag) ? storeFlag : resolve(cwd, storeFlag);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  return resolve(home, ".local", "share", "megasaver");
}
