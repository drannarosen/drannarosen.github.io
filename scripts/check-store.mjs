/*
 * check-store.mjs — build gate for the cluster store (src/novascope/state).
 * Validates the store's contracts: reactivity (subscribers fire on change),
 * persistence roundtrip through an injected adapter, and factory isolation
 * (separate instances don't collide). Runs in Node with an in-memory adapter,
 * which is exactly why persistence is injectable and the store is SSR-safe.
 */
import { createClusterStore, memoryAdapter } from "../src/novascope/state/index.ts";
import { defaultIdentity, serializeIdentity } from "../src/novascope/core/cluster/index.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("cluster store contracts:");

const adapter = memoryAdapter();
const s = createClusterStore({ adapter, instance: "test" });

let fired = 0;
const unsub = s.subscribe(() => fired++);

const custom = defaultIdentity({ seed: 999, sampling: { mode: "count", target: 333 } });
s.setIdentity(custom);
ok(s.getIdentity().seed === 999, "setIdentity updates identity");
ok(fired === 1, "subscriber fires on setIdentity");

s.setView({ t: 5 });
ok(s.getView().t === 5, "setView updates view");
ok(fired === 2, "subscriber fires on setView");

unsub();
s.setView({ t: 6 });
ok(fired === 2, "no notification after unsubscribe");

// Persistence roundtrip: a fresh store on the same adapter+instance restores state.
const s2 = createClusterStore({ adapter, instance: "test" });
ok(s2.toQuery() === serializeIdentity(custom), "identity restored from persistence");
ok(s2.getView().t === 6, "view restored from persistence");

// Factory isolation: a different instance key is independent (default identity).
const s3 = createClusterStore({ adapter, instance: "other" });
ok(s3.getIdentity().seed === defaultIdentity().seed, "separate instance is independent");

if (failures) {
  console.error(`\n[store] ${failures} contract(s) FAILED.`);
  process.exit(1);
}
console.log("\n[store] ok — reactivity, persistence roundtrip, and factory isolation hold.");
