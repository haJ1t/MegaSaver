// Node 25 ships an experimental native localStorage that clobbers jsdom's
// implementation but exposes no methods, so any localStorage.* call fails with
// "is not a function". Tests install this in-memory shim before each spec so
// the GUI components (ProjectPicker / App) can call setItem/getItem/clear
// without crashing. Real browsers use the native Storage; this only paves
// over the Node-25-on-vitest test runner gap.

export function installLocalStoragePolyfill(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}
