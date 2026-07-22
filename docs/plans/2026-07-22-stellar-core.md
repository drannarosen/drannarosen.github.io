# Stellar Physics Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This is correctness-critical astrophysics — also honor **astro-code-dev** (no magic numbers; every coefficient traces to a cited source) and **research-workflow:reference-parity-audit** (the port must reproduce startrax, checked at physical landmarks).

**Goal:** A pure, physics-grounded `src/lib/stellar.ts` giving zero-age main-sequence properties (L, R, Teff, spectral type, MS lifetime, remnant fate) for a star of given mass at solar metallicity, ported from startrax's verified relations and gated by a validation harness.

**Architecture:** Port the numeric relations from startrax (Python/JAX) to plain TypeScript, citing the same equation digests. Validate not by hand-typed expectations but against a **committed fixture of startrax's own outputs** at a mass grid — the TS port must match Python within tolerance. The harness (`scripts/check-stellar.mjs`) follows the existing `check-sun.mjs` pattern: run with `node --experimental-strip-types`, assert, `exit(1)` on failure, wire into `prebuild`.

**Tech Stack:** TypeScript (strict), Node `--experimental-strip-types` harness (no test framework — mirror `scripts/check-sun.mjs`), startrax `.venv` (Python) to generate the reference fixture once.

**Port sources (startrax, `~/projects/jaxstro-dev/startrax`):**
- Tout L/R/Teff: `src/startrax/hurley/sse/foundations/zams.py` (digest `tout1996-zams`, 75/75 verified)
- Hurley t_MS: `src/startrax/hurley/sse/foundations/boundaries.py` + `coefficients.py`
- Fryer remnant: `src/startrax/remnant_prescriptions.py`, `pair_instability.py`, `wd_ifmr.py`
- Spectral type: NOT in startrax — add a small Pecaut & Mamajek (2013), ApJS 208, 9 table fresh.

**Units:** M [M☉], L [L☉], R [R☉], Teff [K], t_MS [Myr]. Z fixed at Z☉ for the site (Tout `_Z_REF = 0.02`); functions accept Z but callers pass 0.02. Tout valid 0.1 ≤ M ≤ 100 M☉; clip Z ∈ [1e-4, 0.03].

---

### Task 1: Reference fixture from startrax

**Files:**
- Create: `scripts/fixtures/stellar-startrax.json`
- Create (throwaway, do not commit): a Python snippet run in startrax's venv.

**Step 1:** In `~/projects/jaxstro-dev/startrax`, using its `.venv` python, evaluate `zams_luminosity`, `zams_radius`, `zams_effective_temperature` (from `startrax.hurley.sse.foundations.zams`) at Z=0.02 for the mass grid `[0.1,0.3,1.0,2.0,5.0,10.0,20.0,40.0,60.0,100.0]`, plus the Hurley `t_MS` and the Fryer remnant fate/mass at the same masses. Print as JSON rows `{m, L, R, Teff, tMS_Myr, remnant_kind, remnant_mass}`.

**Step 2:** Save that JSON to `scripts/fixtures/stellar-startrax.json` with a header comment noting it was generated from startrax commit `<hash>` at Z=0.02, and the exact functions called.

**Step 3:** Commit.
```bash
git add scripts/fixtures/stellar-startrax.json
git commit -m "test(stellar): reference fixture from startrax ZAMS/t_MS/remnant"
```

---

### Task 2: Tout ZAMS luminosity & radius → Teff

**Files:**
- Create: `src/lib/stellar.ts`
- Create: `scripts/check-stellar.mjs`
- Modify: `package.json` (add `check:stellar`, add to `prebuild`)

**Step 1 (failing harness):** Write `scripts/check-stellar.mjs` mirroring `scripts/check-sun.mjs`: import `zamsLuminosity`, `zamsRadius`, `effectiveTemperature` from `../src/lib/stellar.ts`; load the fixture; for each row assert `relErr(L) < 1e-3`, `relErr(R) < 1e-3`, `relErr(Teff) < 1e-3`; collect failures; `console.error` + `exit(1)` if any. Add an explicit solar check: M=1 → L≈1, R≈1, Teff≈5772±5 K.

**Step 2:** Run `node --experimental-strip-types scripts/check-stellar.mjs` → Expected: FAIL (module not found / functions undefined).

**Step 3 (implement):** In `stellar.ts`, port the Tout eq (1)-(2) rational fits and their metallicity-polynomial coefficients **verbatim from `zams.py`** (`_TOUT_L_COEFFS`, the radius coefficients, `_metallicity_coeffs`, `_Z_REF`). Add `effectiveTemperature(L, R)` via Stefan-Boltzmann in solar units: `Teff = 5772 * (L)**0.25 / (R)**0.5`. Header comment cites Tout et al. (1996) + the digest; each coefficient block cites its `zams.py` origin.

**Step 4:** Run the harness → Expected: PASS (all grid rows + solar within tol).

**Step 5:** Commit.
```bash
git add src/lib/stellar.ts scripts/check-stellar.mjs package.json
git commit -m "feat(stellar): Tout 1996 ZAMS L, R, Teff (validated vs startrax)"
```

---

### Task 3: Spectral type (Pecaut & Mamajek 2013)

**Files:**
- Modify: `src/lib/stellar.ts`
- Modify: `scripts/check-stellar.mjs`

**Step 1 (failing):** Add harness assertions on `spectralType(Teff)` boundaries: 40000→"O", 20000→"B", 9000→"A", 6500→"F", 5772→"G", 4500→"K", 3200→"M" (class letter only). Run → FAIL.

**Step 2 (implement):** Add an embedded Pecaut & Mamajek (2013) Teff→type table (dwarf sequence, ~30 rows: Teff, class, subclass) and `spectralType(Teff)` that interpolates to the nearest subclass and returns e.g. `"O7V"`. Cite the source in a comment (table is from the paper's online compilation).

**Step 3:** Run → PASS. **Step 4:** Commit `feat(stellar): Teff→spectral type (Pecaut & Mamajek 2013)`.

---

### Task 4: Hurley main-sequence lifetime

**Files:** Modify `src/lib/stellar.ts`, `scripts/check-stellar.mjs`

**Step 1 (failing):** Add harness assertions vs fixture `tMS_Myr` (`relErr < 1e-2`) + landmarks: M=1 → ~10000 Myr (±10%), M=20 → few Myr (< 15 Myr). Run → FAIL.

**Step 2 (implement):** Port Hurley `t_MS` (and its `t_BGB`/hook dependencies) from `boundaries.py`/`coefficients.py`, coefficients verbatim, citing Hurley+2000 + digest. Return Myr.

**Step 3:** Run → PASS. **Step 4:** Commit `feat(stellar): Hurley 2000 MS lifetime (validated vs startrax)`.

---

### Task 5: Fryer 2012 remnant fate

**Files:** Modify `src/lib/stellar.ts`, `scripts/check-stellar.mjs`

**Step 1 (failing):** Add harness assertions vs fixture `remnant_kind`: M=1 → "white dwarf", M=20 → "neutron star" or "black hole" per the fixture, top of grid → per fixture (PISN/black hole). Run → FAIL.

**Step 2 (implement):** Port the Fryer (2012) rapid/delayed remnant prescription + the PISN and WD-IFMR branches from `remnant_prescriptions.py`/`pair_instability.py`/`wd_ifmr.py`, returning `{kind, mass}` where kind ∈ {white dwarf, neutron star, black hole, pair-instability}. Cite Fryer+2012 (ApJ 749, 91) and the startrax modules. Return a coarse fate the card can show.

**Step 3:** Run → PASS. **Step 4:** Commit `feat(stellar): Fryer 2012 remnant fate (validated vs startrax)`.

---

### Task 6: Wire the gate + refactor imf.ts onto the core

**Files:** Modify `package.json` (confirm `check:stellar` in `prebuild`), `src/lib/imf.ts`

**Step 1:** Confirm `prebuild` runs `node --experimental-strip-types scripts/check-stellar.mjs` (add if missing). Run `pnpm build` → the stellar gate passes in-pipeline.

**Step 2 (refactor):** Replace `imf.ts`'s toy `massToTeff` (M^0.53) and `massToLuminosity` (M^3.5) with calls to `stellar.ts` (`zamsLuminosity`, `effectiveTemperature`); keep `teffToRGB` as-is. `Star` gains nothing yet — only its L/Teff source changes. Update the module comment (no longer "simplified relations").

**Step 3 (verify the hero):** `pnpm dev`, browser at 1440×900, load `/` — confirm the hero cluster still renders (bright rare blue stars among faint red), no console errors. Screenshot.

**Step 4:** `pnpm build` green (all gates). Commit `refactor(imf): sample stellar properties from the physics core`.

**Step 5:** STOP — report. The coda UI (2D inspector + HR diagram + interaction) is a separate plan, written after this core is green.

---

## Out of scope for this plan

The coda UI, the HR diagram, hover/tap/keyboard interaction, and the no-JS
fallback. This plan delivers only the validated, reusable science core and the
imf.ts refactor. The UI plan follows once the core is green.
