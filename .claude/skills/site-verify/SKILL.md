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
