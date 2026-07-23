/*
 * state — the reactive session store (Layer 1). Identity + view + persistence;
 * a factory, never a global. The notebook/log is a later Navigation feature.
 */
export type { ClusterView, ClusterStore, ClusterStoreOptions } from "./store.ts";
export { createClusterStore, defaultView } from "./store.ts";
export type { PersistenceAdapter } from "./adapters.ts";
export { memoryAdapter, localStorageAdapter } from "./adapters.ts";
