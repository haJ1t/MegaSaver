import { resolve } from "node:path";

export type ResolveBridgeStorePathInput = {
  storeOverride: string | undefined;
  home: string | undefined;
  xdgDataHome: string | undefined;
};

// Mirrors apps/cli/src/store.ts resolveStorePath rules:
// override → XDG_DATA_HOME/megasaver → $HOME/.local/share/megasaver.
export function resolveBridgeStorePath(input: ResolveBridgeStorePathInput): string {
  const { storeOverride, home, xdgDataHome } = input;
  if (storeOverride !== undefined && storeOverride.length > 0) {
    return resolve(storeOverride);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  if (!home || home.length === 0) {
    throw new Error("HOME is not set and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided");
  }
  return resolve(home, ".local", "share", "megasaver");
}
