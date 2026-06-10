import { join, resolve } from "node:path";

export type ResolveBridgeStorePathInput = {
  storeOverride: string | undefined;
  home: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};

// Mirrors apps/cli/src/store.ts resolveStorePath:
// override → XDG → win32 %LOCALAPPDATA% → posix ~/.local/share.
export function resolveBridgeStorePath(input: ResolveBridgeStorePathInput): string {
  const { storeOverride, home, xdgDataHome, platform, localAppData } = input;
  if (storeOverride !== undefined && storeOverride.length > 0) {
    return resolve(storeOverride);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return join(xdgDataHome, "megasaver");
  }
  if (platform === "win32") {
    const base = localAppData && localAppData.length > 0 ? localAppData : home;
    if (!base || base.length === 0) {
      throw new Error(
        "LOCALAPPDATA/USERPROFILE unset and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided",
      );
    }
    return join(
      localAppData && localAppData.length > 0 ? localAppData : join(base, "AppData", "Local"),
      "megasaver",
    );
  }
  if (!home || home.length === 0) {
    throw new Error("HOME is not set and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided");
  }
  return resolve(home, ".local", "share", "megasaver");
}
