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
