/*
 * state/adapters.ts — pluggable persistence for the cluster store.
 *
 * The store never talks to localStorage directly; it talks to an adapter. That
 * keeps it SSR-safe (no top-level `window`), unit-testable (an in-memory adapter
 * in Node), and collision-free across consumer sites (namespaced keys). It is
 * also the seam where a future sync layer (over the same seed) would attach —
 * see the Extraction blueprint and the "no backend" decision.
 */

export interface PersistenceAdapter {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

/** In-memory adapter — the default on the server and in tests. Never touches the DOM. */
export function memoryAdapter(seed: Record<string, string> = {}): PersistenceAdapter {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    load: (key) => (store.has(key) ? store.get(key)! : null),
    save: (key, value) => void store.set(key, value),
  };
}

/**
 * Browser localStorage adapter. Checks for availability at CALL time (never at
 * module load), so importing this on the server is safe; it degrades to a no-op
 * read/write if storage is unavailable (private mode, SSR, disabled).
 */
export function localStorageAdapter(): PersistenceAdapter {
  const available = () => {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  };
  return {
    load: (key) => (available() ? localStorage.getItem(key) : null),
    save: (key, value) => {
      if (available()) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* quota / disabled — persistence is best-effort, never fatal */
        }
      }
    },
  };
}
