const { contextBridge } = require("electron");
const { dialog } = require("electron");

// Expose a filesystem-native folder picker to the renderer.
// The web File System Access API (showDirectoryPicker) cannot return an
// absolute OS path in pure browser mode — only a handle name. When the GUI
// runs inside Electron, this preload overrides showDirectoryPicker so the
// renderer gets a real path and "\u201CKlas\u00f6r se\u00e7\u201D \u2192 ekle" works in one click.
// Outside Electron (plain browser via `mega gui`), the renderer falls back to
// the webkitdirectory/<input> path and manual paste, so this file is optional there.
const api = {
  async pickFolder() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0] ?? null;
  },
};

try {
  contextBridge.exposeInMainWorld("megasaver", api);
} catch {
  // contextIsolation off or not in Electron — ignore
}

// Also patch showDirectoryPicker when running with nodeIntegration in the
// renderer (dev). This lets the TopBar's handleNativePick() receive a
// handle with a real .path without changing its call-site.
try {
  if (typeof window !== "undefined") {
    const orig = window.showDirectoryPicker;
    window.showDirectoryPicker = async (..._args) => {
      const picked = await api.pickFolder();
      if (picked === null) throw new DOMException("User cancelled", "AbortError");
      return { name: picked.split("/").pop() ?? picked, path: picked };
    };
    // keep orig for fallback if needed
    window.__origShowDirectoryPicker = orig;
  }
} catch {}
