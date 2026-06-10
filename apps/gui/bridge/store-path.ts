import { resolve } from "node:path";

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
    return resolve(xdgDataHome, "megasaver");
  }
  if (platform === "win32") {
    if (localAppData && localAppData.length > 0) {
      return resolve(localAppData, "megasaver");
    }
    if (home && home.length > 0) {
      return resolve(home, "AppData", "Local", "megasaver");
    }
    throw new Error(
      "LOCALAPPDATA/USERPROFILE unset and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided",
    );
  }
  if (!home || home.length === 0) {
    throw new Error("HOME is not set and no XDG_DATA_HOME or MEGASAVER_GUI_STORE provided");
  }
  return resolve(home, ".local", "share", "megasaver");
}
