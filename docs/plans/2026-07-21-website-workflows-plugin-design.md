# Distributable "website workflows" plugin — design (staged, NOT built)

**Status: design only.** This documents what a reusable Claude Code plugin
built from this site's discipline would contain, so it can be executed later —
**not now**. Building a distributable plugin for a single website is the
over-engineering the project's own locked principle warns against ("the failure
mode to design against is over-engineering, not under-engineering"). The local
project skills (`site-claims`, `site-integrity`, `site-verify`) prove the design
in use first; this plugin is worth building only when a second consumer exists.

## The trigger to build it

Do not start until one of these is real:

- **A second site** built the same way (e.g. a group site, a course site, a
  migrated `cosmic-playground`) that would genuinely reuse the discipline.
- **A decision to publish** the methodology for others.

Until then, the skills live in this repo and cost nothing. A plugin adds
`plugin.json`, versioning, and a marketplace entry — machinery that only pays
off across repos.

## What generalizes (goes in the plugin)

The reusable half is the *methodology*, not this site's specifics.

- **The three skills, de-specialised.** `site-claims`, `site-integrity`,
  `site-verify` reworded to speak about "your site" rather than jaxstro,
  progenax, `/now`, etc. The war stories stay — they are the teaching — but
  framed as patterns ("a hand-maintained list standing in for a derivable
  fact") rather than repo trivia. The principles are portable: never publish an
  unverified claim; derive facts and gate drift; one source of truth per fact;
  pushed ≠ live.
- **Generic gate templates.** Parameterised versions of the checks, not the
  hard-coded scripts:
  - a *drift-check* template: derive-from-artifact, compare-to-record,
    exit-non-zero-with-fix — the shape every existing check shares;
  - a *search-index crawler* that indexes built pages by real text with an
    excluded-with-reason list and a stale-exclusion guard;
  - a *link/markup* checker over `dist/`;
  - a *deploy-confirm* helper that fails loudly if CI ran `astro build`
    directly instead of the hook-running `pnpm build`, or if a check step runs
    before install.
- **Commands worth including.** A `/new-page` scaffold that wires a new page
  into search and the gates from the start (the opposite of the opt-in list
  that rotted); a `/verify` command that runs the browser-at-1440 + confirm-the-
  green-deploy routine.

## What stays site-specific (never in the plugin)

These are this repo's business and would be noise or lies elsewhere:

- `figures.json` schema, `src/lib/figures.ts`, and the figure gate.
- The Jaxstro naming rules and the package/release-meter model.
- The specific content of `AGENTS.md`, the ORCID publication sync, the OG-card
  generator's card list, the `/now` composition, the solar-geometry check.

## Packaging (when built)

- `plugin.json` with semver; a marketplace entry.
- Skills marked to auto-trigger on the right moments (adding data → integrity;
  finishing/shipping → verify; writing content → claims).
- Gate templates shipped as scripts the consuming repo wires into its own
  `prebuild`/`postbuild`, with paths passed in rather than assumed.
- A short README that leads with the one idea worth stealing: **make the site
  unable to quietly go wrong — derive facts, gate drift, and never let "pushed"
  be mistaken for "live."**

## Explicitly out of scope for the first build

No CMS, no backend, no analytics helper, no theme. The plugin is discipline and
gates, not a site generator.
