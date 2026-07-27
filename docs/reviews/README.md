# Reviews

Dated, point-in-time quality audits. Each one records what was **measured** at that moment,
so a later review can be read as a delta rather than as a fresh opinion.

A review is a snapshot, not a spec. Where a review and an ADR disagree, the ADR wins and the
review is stale — the same rule the vision roadmap carries.

| Date | Review | Scope | Headline |
| --- | --- | --- | --- |
| 2026-07-26 | [Novascope extraction audit](2026-07-26-novascope-extraction-audit.md) | `src/novascope/`, `src/lib/`, `src/pages/`, `src/components/`, `scripts/check-*` | Architecture A−, DRY B+, gates B, extraction-readiness A−. Boundary gate green on 72 files; the ADR 0015 GPU↔CPU parity condition is met by discipline rather than by detection. |
| 2026-07-26 | [core/dynamics review](2026-07-26-core-dynamics-review.md) | `src/novascope/core/dynamics/**`, commits `9ef650f`..`fbb5850` | Physics A, tests A, architecture A−, DRY **B**, performance **B−**. The fixture-first discipline worked (69 quantities to 1.45e-14) and the contract tests have proven teeth — but this work introduced four kinetic-energy implementations, a duplicated radial grid, and a `diagnostics()` costing 4.1× a physics sub-step. |
