/*
 * check-novascope-boundary.mjs — the import-boundary gate for the novascope
 * package (ADR 0012, Architecture §8).
 *
 * The whole portability guarantee rests on ONE rule: the science core imports
 * nothing but the science core. A gate turns that from an aspiration into an
 * enforced invariant — the same discipline check-sun/check-stellar apply to the
 * physics itself. If this passes, extraction stays a folder move; if it fails,
 * something just coupled the core to the site and the boundary must be restored.
 *
 * Layers (Architecture §8), low → high; a layer may only import DOWNWARD:
 *   core (0) → state (1) → viz (2) → components (3)
 * Rules enforced for every .ts under src/novascope/:
 *   - no import of `astro`, `astro:*`, a `*.astro` file, or a framework runtime;
 *   - no import of a HIGHER @novascope layer (upward dependency);
 *   - no relative import that escapes the file's own layer root (e.g. into
 *     src/lib or a sibling layer);
 *   - core additionally: no DOM globals (window/document/globalThis member use).
 *
 * Scoped to the core today because that is all that exists; the layer table
 * already covers state/viz/components for when they land.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PKG = resolve(ROOT, "src/novascope");

const LAYER_ORDER = ["core", "state", "viz", "components"];

/** Every .ts file under a directory, recursively. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** The novascope layer a file belongs to, from its path. */
function layerOf(absPath) {
  const rel = relative(PKG, absPath); // e.g. "core/imf/index.ts"
  return rel.split("/")[0];
}

/** Pull every import/export-from/dynamic-import specifier out of source. */
function specifiers(src) {
  const specs = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // import … from "x"
    /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // export … from "x"
    /\bimport\s*['"]([^'"]+)['"]/g, //                 import "x" (side-effect)
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //       import("x")
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

const violations = [];
const files = walk(PKG);

for (const file of files) {
  const rel = relative(ROOT, file);
  const layer = layerOf(file);
  const layerIdx = LAYER_ORDER.indexOf(layer);
  const src = readFileSync(file, "utf8");

  for (const spec of specifiers(src)) {
    // 1. Framework / Astro coupling — forbidden in every layer of the pure core+.
    if (spec === "astro" || spec.startsWith("astro:") || spec.endsWith(".astro")) {
      violations.push(`${rel}: imports Astro ("${spec}") — the package must not depend on the framework`);
      continue;
    }

    // 2. @novascope/<layer> imports — must not point UPWARD.
    const m = spec.match(/^@novascope\/([^/]+)/);
    if (m) {
      const targetIdx = LAYER_ORDER.indexOf(m[1]);
      if (targetIdx > layerIdx) {
        violations.push(`${rel}: ${layer} imports higher layer "${spec}" — dependencies may only point downward`);
      }
      continue; // downward or same-layer @novascope import is fine
    }

    // 3. Relative imports must stay within the file's own layer root.
    if (spec.startsWith(".")) {
      const resolved = resolve(dirname(file), spec);
      const layerRoot = resolve(PKG, layer);
      if (relative(layerRoot, resolved).startsWith("..")) {
        violations.push(`${rel}: relative import "${spec}" escapes the ${layer}/ boundary`);
      }
      continue;
    }

    // 4. Bare package imports: allow pure libraries, forbid known DOM/framework runtimes.
    if (/^(react|react-dom|preact|vue|svelte|solid-js)(\/|$)/.test(spec)) {
      violations.push(`${rel}: imports UI runtime "${spec}" — not allowed in the package core`);
    }
  }

  // 5. Core must not touch the DOM. Flag member access on window/document/globalThis.
  if (layer === "core") {
    const domRe = /\b(window|document|globalThis)\s*[.[]/g;
    let m;
    while ((m = domRe.exec(src))) {
      violations.push(`${rel}: core touches the DOM ("${m[0].trim()}") — core must be environment-free`);
    }
  }
}

if (violations.length) {
  console.error(`✗ novascope boundary — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\nThe core must import nothing but the core (ADR 0012, Architecture §8).");
  process.exit(1);
}

console.log(`✓ novascope boundary — ${files.length} file(s) clean; core imports nothing but the core.`);
