/*
 * state/store.ts — the reactive session store (Architecture §3, Cluster-state
 * spec). Holds the cluster IDENTITY (which cluster) and the VIEW (how you're
 * looking at it: age t, selected star, toggles), persists both, and notifies
 * subscribers on change.
 *
 * A FACTORY, never a module-level global: two explorables on one page, or two
 * consumer sites, get independent stores that never collide. Persistence is an
 * injected adapter under a namespaced key. The notebook/log is deliberately not
 * built yet (a Navigation-phase feature) — this is the seam, not the stub.
 */
import {
  type ClusterIdentity,
  defaultIdentity,
  deserializeIdentity,
  serializeIdentity,
} from "../core/cluster/index.ts";
import { type PersistenceAdapter, memoryAdapter } from "./adapters.ts";

/** How the reader is currently looking at the cluster (not its identity). */
export interface ClusterView {
  t: number; // age, Myr
  selectedId: number | null; // the followed "favourite" star
  toggles: Record<string, boolean>; // heartbeat toggles: winds on/off, gravity, …
}

export function defaultView(over: Partial<ClusterView> = {}): ClusterView {
  return { t: 0, selectedId: null, toggles: {}, ...over };
}

export interface ClusterStoreOptions {
  /** Starting identity. If omitted, restored from persistence, else the default. */
  identity?: ClusterIdentity;
  view?: Partial<ClusterView>;
  adapter?: PersistenceAdapter;
  /** Namespaced storage key; distinguishes instances on one page / across sites. */
  instance?: string;
}

interface Persisted {
  identity: string; // serialized ClusterIdentity (query string)
  view: ClusterView;
}

export interface ClusterStore {
  getIdentity(): ClusterIdentity;
  setIdentity(next: ClusterIdentity): void;
  getView(): ClusterView;
  setView(patch: Partial<ClusterView>): void;
  /** Subscribe to any change; returns an unsubscribe. Fires on identity or view. */
  subscribe(fn: (s: { identity: ClusterIdentity; view: ClusterView }) => void): () => void;
  /** The identity as a shareable query string (the URL form). */
  toQuery(): string;
  readonly key: string;
}

export function createClusterStore(opts: ClusterStoreOptions = {}): ClusterStore {
  const adapter = opts.adapter ?? memoryAdapter();
  const key = `novascope:${opts.instance ?? "default"}`;

  // Restore, then apply explicit options on top.
  const restored = readPersisted(adapter, key);
  let identity = opts.identity ?? restored?.identity ?? defaultIdentity();
  let view = defaultView({ ...restored?.view, ...opts.view });

  const subscribers = new Set<(s: { identity: ClusterIdentity; view: ClusterView }) => void>();
  const persist = () => adapter.save(key, JSON.stringify({ identity: serializeIdentity(identity), view }));
  const notify = () => {
    const snap = { identity, view };
    for (const fn of subscribers) fn(snap);
  };

  // Persist the resolved starting state so a fresh instance is recoverable.
  persist();

  return {
    key,
    getIdentity: () => identity,
    setIdentity(next) {
      identity = next;
      persist();
      notify();
    },
    getView: () => view,
    setView(patch) {
      view = { ...view, ...patch };
      persist();
      notify();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => void subscribers.delete(fn);
    },
    toQuery: () => serializeIdentity(identity),
  };
}

function readPersisted(
  adapter: PersistenceAdapter,
  key: string,
): { identity: ClusterIdentity; view: ClusterView } | null {
  const raw = adapter.load(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Persisted;
    return {
      identity: deserializeIdentity(parsed.identity), // tolerant, versioned (§9.6)
      view: defaultView(parsed.view),
    };
  } catch {
    return null; // corrupt payload → fall back to defaults, never throw
  }
}
