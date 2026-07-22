---
title: "Tooling — 'dev-only spec section' as a guardrail (plugin capability)"
kind: tooling
order: 90
status: idea
tagline: "Generalise this planning surface into astro-site-guardrails, later."
research: []
---

A note-to-future-self capturing a reusable pattern so it can become a plugin
capability in **`astro-site-guardrails`** (`~/projects/claude-plugins/astro-site-guardrails/`).
Do this **later**, as its own task — it is a separate repo and should not derail the
explore-series work. This page holds all the context needed to pick it up cold.

## The pattern

A **dev-only internal content section**: pages that render under `pnpm dev` for the
author to review and iterate on, but are **provably absent from the production build** —
no public URL, and nothing for the search crawler or sitemap to find. This planning
surface (`/explore-plan`) is the reference implementation.

How it's done here:

- A content collection (`explorePlan`) holds the docs.
- The route `src/pages/explore-plan/[...slug].astro` has
  `getStaticPaths() { if (!import.meta.env.DEV) return []; … }`, so **production emits
  nothing** under that prefix.
- It is left out of the nav (`src/lib/site.ts`), so it is unlinked.
- Because no page is built, the postbuild search crawler and the sitemap never see it.

## Why it's a GUARDRAIL, not scaffolding

The plugin's theme is "make the site unable to quietly go wrong." The failure this
prevents is real and silent: **on a public site, internal planning notes can leak into
production** and be indexed/shared without anyone noticing. So the plugin piece is not
just "scaffold a section" — it is a **gate that proves the internal content never
reached `dist/`**. That verification is what earns it a place beside the other gates.

The proof, run by hand here (make it a check script):

```bash
# every internal prefix must be absent from the built site
test "$(find dist -path '*explore-plan*' | wc -l)" -eq 0
grep -c "explore-plan" dist/search.json dist/sitemap*.xml   # expect 0 0
```

## Proposed plugin capability

1. **A command/skill** (`plugin-dev:command-development` / `skill-development`) that
   scaffolds a dev-only section: content collection + dev-gated `[...slug]` route +
   a noindex meta + a reminder to leave it out of nav.
2. **A gate script** (the guardrail): given a list of **internal path prefixes**, fail
   the build if any appears in `dist/`, `dist/search.json`, or the sitemap. Generic and
   config-driven, so it protects any number of dev-only sections, not just this one.
   This is the reusable, high-value half.

## Make it versatile (Anna's nudge)

- Config-driven list of internal prefixes; support several dev-only sections at once.
- Parameterise the gating predicate: `DEV`-only is one mode; "staging-only" (an env
  flag) or "flagged draft" could be others. The gate stays the same — *assert absence
  in the public artifact*.
- Ship the check as a standalone script the consuming repo wires into `postbuild`,
  paths passed in — matching the plugin's existing "gate templates" roadmap (v0.2.0).

## Pointers for the future session

- Plugin repo: `~/projects/claude-plugins/astro-site-guardrails/` (BSD-3, v0.1.0).
- Reference implementation: this repo — `src/pages/explore-plan/[...slug].astro`,
  the `explorePlan` collection in `src/content.config.ts`.
- Skills: `plugin-dev:command-development`, `plugin-dev:hook-development`,
  `plugin-dev:skill-development`. It slots under the plugin's existing v0.2.0
  "parameterized gate-script templates" line in its README roadmap.
