# Website Workflow Skills — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture the reusable discipline this site was built with as well-structured project skills, and document (not build) a future distributable plugin.

**Architecture:** Three project skills in `.claude/skills/`, each triggered at a different moment: `site-claims` (already exists — honesty of published claims), a new `site-integrity` (building safely: derive facts, gate drift, one source of truth), and a new `site-verify` (shipping safely: verify in the browser, confirm the deploy not the push). AGENTS.md gains a short pointer to them. A separate design doc scopes the distributable plugin as a staged follow-on, explicitly NOT built now.

**Tech stack:** Markdown skill files with YAML frontmatter (`name`, `description`). No code, no tests in the pytest sense — verification is that the skills load, the existing build gates stay green, and no fabricated claim is introduced.

**Non-negotiable while executing:** every new file must satisfy the funding-and-timeline rule in the Conventions section of AGENTS.md (the repo is public). The war stories used here cite only courses, figures, search, meters, and the deploy — all safe.

---

### Task 1: Create the `site-integrity` skill

**Files:**
- Create: `.claude/skills/site-integrity/SKILL.md`

**Step 1: Write the skill file** with exactly this content:

```markdown
---
name: site-integrity
description: Use when adding or changing DATA on drannarosen.github.io — a list, derived content, a cross-reference between pages, a status field, or a new build check. Enforces the engineering discipline that kept the site honest: derive facts instead of hand-maintaining them, make drift fail the build, and keep one source of truth per fact.
---

# Building the site so it can't quietly go wrong

The site's hardest bugs were all one shape: **a hand-maintained thing standing
in for a fact that could have been derived.** It looks fine, it passes review,
and it silently stops being true. Design against that shape.

## The rule

When you add data, a list, a cross-reference, or a status:

1. **Derive it if you can.** If the answer exists somewhere structured, compute
   it — do not retype it. A hand-kept copy is a copy that drifts.
2. **If it must be authored, give it ONE home.** Every fact lives in exactly
   one place; every other use references it. Two copies of a fact are two
   claims that can disagree.
3. **Gate the thing derivation can't guarantee.** Coverage is free once derived;
   what's left is a stale exclusion, a broken reference, a missing record. Make
   that fail the build, loudly, with a message naming the fix.

## The war stories (all real, all this repo)

- **Teaching by array order.** `/now` showed `courses.slice(0, 2)` and called
  them current. In July it announced two semesters that had already ended.
  Fix: structured terms, `coursesNow(now)` derives what's running; the label is
  derived from the same data so it can't disagree.
- **Figure captions by hand.** Each page re-declared a figure's alt text,
  dimensions and caption. Five of ten figures appear in more than one place, so
  a replaced figure left one page asserting the old number. Fix: `figures.json`
  is the one description; pages reference by id; `check:figures` fails when the
  `usedIn` set changes.
- **Search by a hand-written page list.** Eighteen of thirty-one pages were
  missing and nothing failed. Fix: crawl the built HTML; a page is indexed
  because it was built. The only guard left is a stale exclusion, which fails
  the build.
- **Two axes coupled.** Readiness and paper-state were nearly merged, which
  read a mature package with no repo as vapour. Fix: separate axes, each set by
  hand, never one derived from the other — deriving would fabricate a claim.

## How the gates are shaped

The existing checks are the template. Each one: derives the truth from the
built artifact or the single record, compares it to what's declared, and exits
non-zero with a message that says exactly what to change. `check:figures`,
`check-markup`, `search/build-index`, `check-links`, `check-sun`, `check-type`
are all this shape. A new check should match it — and run in `prebuild` or
`postbuild` so it can never be skipped, the way the deploy once skipped every
hook (see [[site-verify]]).

## When NOT to gate

A gate that blocks the build to force an editorial choice gets edited out of
the way. The `/now` figure cap WARNS past five and ships — retiring a plot is
Anna's call, not the build's. Gate facts that must be true; warn on choices
that are hers.

Related: [[site-claims]] (honesty of the words), [[site-verify]] (shipping).
```

**Step 2: Verify the skill file loads**

Run: `head -5 .claude/skills/site-integrity/SKILL.md`
Expected: valid YAML frontmatter with `name: site-integrity`.

**Step 3: Verify no forbidden content**

Run the repo's forbidden-vocabulary check (per the AGENTS.md funding-and-timeline rule) against the new file.
Expected: no matches.

**Step 4: Commit**

```bash
git add .claude/skills/site-integrity/SKILL.md
git commit -m "Add site-integrity skill: derive facts, gate drift, one source of truth"
```

---

### Task 2: Create the `site-verify` skill

**Files:**
- Create: `.claude/skills/site-verify/SKILL.md`

**Step 1: Write the skill file** with exactly this content:

```markdown
---
name: site-verify
description: Use when finishing or shipping a change to drannarosen.github.io — before claiming a visual change works, and after pushing. Enforces browser verification at a real desktop width and confirmation that the change actually DEPLOYED, not merely pushed.
---

# Confirm it works, and confirm it shipped

Two lessons, both learned the hard way on this site.

## Verify in the browser, at a real width

For anything a reader would see, verify it in the preview rather than assuming
the edit worked.

- **Record `innerWidth` in the same call that measures geometry.** The preview
  pane silently resizes itself — 1440 to 528 between calls, and a reload can
  reset it. A responsive rule then correctly stops matching and looks exactly
  like a broken selector. This was misdiagnosed twice as "stale CSS" and a
  server restart wrongly "fixed" it. Set the width explicitly with
  `resize_window 1440x900` right before measuring; never infer it from an
  earlier call. Astro's CSS HMR works — do not restart the server on layout
  weirdness.
- **Finish visual checks at 1440px** (desktop is the priority). Reading served
  CSS directly has two traps: Vite normalises values (`magenta` → `#f0f`) and
  rewrites media queries (`min-width: 60rem` → `width >= 60rem`), and it strips
  comments — so grepping for the literal text you wrote reports a false
  negative.

## "Pushed" is not "live"

`git push` and the site updating are two events, and one can succeed while the
other fails.

- Every push to `main` triggers the deploy workflow: install → `pnpm build`
  (all gates) → publish. **A failing gate skips the deploy**, and GitHub keeps
  serving the last good build. The repo advances; the live site does not; and
  nothing tells you unless you look.
- This actually happened: a figure check gained a `sharp` import while the
  workflow ran it with no install, and — worse — the old workflow ran
  `astro build` directly, skipping every `prebuild`/`postbuild` hook, so the
  search index and half the gates never ran on a real deploy. Three pushes
  succeeded; the site was three commits stale.
- **After a push, confirm the green deploy** (`gh run list`, or the Actions
  tab), not just the push. Treat a green deploy as the finish line. If
  `pnpm build` passes locally it will pass in CI, because they now run the
  identical command.

Related: [[site-integrity]] (why the gates exist), [[site-claims]] (the words).
```

**Step 2: Verify the skill file loads**

Run: `head -5 .claude/skills/site-verify/SKILL.md`
Expected: valid YAML frontmatter with `name: site-verify`.

**Step 3: Verify no forbidden content**

Run the repo's forbidden-vocabulary check against the new file.
Expected: no matches.

**Step 4: Commit**

```bash
git add .claude/skills/site-verify/SKILL.md
git commit -m "Add site-verify skill: verify in the browser, confirm the deploy not the push"
```

---

### Task 3: Point AGENTS.md at the skills

**Files:**
- Modify: `AGENTS.md` — add a short "Working discipline" subsection at the end of the `## Conventions` section (after the first-person rule), pointing at the three skills. Do NOT duplicate their content; a pointer only, so there is one home for each (the skill itself).

**Step 1: Add this block** immediately after the "Write in the **first person**" bullet:

```markdown

Three project skills carry the working discipline, each triggered at a
different moment — read the skill, do not re-derive it here:

- **site-claims** — honesty of every published claim (never invent a fact).
- **site-integrity** — building safely: derive facts, gate drift, one source
  of truth per fact.
- **site-verify** — shipping safely: verify in the browser at 1440px, and
  confirm the deploy went green, not just that the push succeeded.
```

**Step 2: Verify the pointer is a pointer, not a copy**

Run: `grep -c "war stor\|innerWidth\|courses.slice" AGENTS.md`
Expected: `0` for the newly added block's lines — the detail lives in the skills, not here. (Existing AGENTS.md mentions of `innerWidth` in the layout-verification section are fine and pre-date this.)

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "Point AGENTS.md at the three working-discipline skills"
```

---

### Task 4: Write the distributable-plugin design doc (staged, not built)

**Files:**
- Create: `docs/plans/2026-07-21-website-workflows-plugin-design.md`

**Step 1: Write the design doc** capturing:

- **What it is and is not.** A distributable Claude Code plugin bundling the
  GENERALIZABLE half of this site's discipline for reuse in other repos. NOT
  built now — this doc is the design, to be executed only when a concrete reuse
  or sharing goal exists (a second site, or publishing the methodology).
- **What generalizes** (goes in the plugin): the three skills, minus the
  site-specific war-story specifics — reworded to be about "your site" rather
  than jaxstro; and GENERIC versions of the gate scripts (a drift-check
  template, a "pushed ≠ live" deploy-confirm helper, a link/markup checker)
  parameterised rather than hard-coded to this repo's paths.
- **What stays site-specific** (never in the plugin): `figures.json` schema and
  the figure gate, jaxstro naming, the release meter, the specific content of
  AGENTS.md, ORCID sync, the OG generator's card list.
- **Packaging:** `plugin.json`, semver, a marketplace entry; commands worth
  including (e.g. a `/new-page` scaffold that wires a page into search and the
  gates from the start); which skills auto-trigger.
- **The trigger to build it:** do not build until there is a second consumer.
  Building a distributable plugin for one site is the over-engineering the
  project's own locked principle warns against. The local skills prove the
  design first.

**Step 2: Verify no forbidden content**

Run the repo's forbidden-vocabulary check against the new file.
Expected: no matches.

**Step 3: Commit**

```bash
git add docs/plans/2026-07-21-website-workflows-plugin-design.md
git commit -m "Design the staged distributable website-workflows plugin (not built yet)"
```

---

### Task 5: Whole-repo verification

**Step 1: The build still passes** (skills and docs are inert, but confirm nothing was disturbed)

Run: `pnpm check && pnpm build`
Expected: `0 errors`, and `[figures] ok`, `[search] ok`, `[links] internal ok`, `[markup] ok`.

**Step 2: All three skills are present and load**

Run: `for s in site-claims site-integrity site-verify; do head -3 .claude/skills/$s/SKILL.md; done`
Expected: three valid frontmatter blocks.

**Step 3: Push and confirm the DEPLOY, not just the push** (per site-verify)

```bash
git push origin main
gh run list --limit 1 --json status,conclusion
```
Expected: the run completes with `conclusion: success`. Docs/skills don't change the site output, but confirming green is the habit.
