# Deployment

The site is a static Astro build served by **GitHub Pages** from the
**`gh-pages` branch**.

## How it works

- **Repo:** `drannarosen/drannarosen.github.io` (a GitHub *user site*).
- **Live URL:** https://anna-rosen.com — the custom apex domain. See
  [`domain-migration.md`](./domain-migration.md).
- **Trigger:** every push to `main` runs
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
- **Build:** `pnpm build`, which is the SAME command run locally, so the
  prebuild gates (sun geometry, type scale, figure provenance, OG cards) and
  postbuild gates (search index, internal links, unrendered markup, redirects,
  explore cards) all run on a real deploy.
- **Publish:** `peaceiris/actions-gh-pages@v4` force-pushes `dist/` to the
  `gh-pages` branch as a single orphan commit. Pages serves that branch.

Pages is configured with **Build and deployment → Source: Deploy from a branch
→ `gh-pages` / (root)**.

`dist/CNAME` comes from `public/CNAME`, so the custom domain travels in the
published tree and does not need re-declaring anywhere.

## Why a branch and not the Actions artifact

**Read the correction below before citing anything in this section elsewhere.** The branch
deploy was adopted for a reason that turned out to be wrong, and the reason is more useful to
remember than the conclusion.

### What this section used to say, and why it was wrong

It said GitHub bills Actions storage **on bytes CREATED per billing cycle**, and concluded that
shortening retention does not help and that deleting artifacts reclaims nothing. Checked against
GitHub's own documentation and Anna's billing ledger on 2026-08-08 (the same check recorded in
`CLAUDE.md`):

- Storage is billed in **GB-hours** — size × time, GitHub's own worked example being "storing
  3 GB for 10 days = 720 GB-hours". Deleting artifacts therefore *does* stop future accrual;
  what it cannot do is un-count what has already accrued this cycle.
- **This repository is public, so its Actions usage is discounted to $0** — minutes *and*
  storage. August 2026: 157 minutes and 381 GB-hours, gross $1.07, net **$0.00**. The only
  non-zero line on the whole personal account that year was a *private* repo.

So the 0.5 GB scare was never this repository's doing, and neither was the deploy cost that
justified rationing pushes.

### What is still true

`dist` is 28 MB, of which `dist/data` is 19 MB — static simulation output that never changes and
was re-uploaded on every push (measured 2026-08-08). That is real churn, and a branch deploy
still avoids it: git deduplicates by content, so unchanged binaries are stored once rather than
per push.

`force_orphan: true` is what makes that safe. Without it the branch accumulates one commit per
deploy and the repository grows without bound — the usual and fair objection to committing build
output. With it, `gh-pages` is always exactly one commit, and unchanged blobs are shared rather
than re-sent.

### The honest status of the decision

The branch deploy is **not** wrong, but it is no longer *justified by cost*, because there is no
cost. What it buys now is tidiness: no artifact churn, and a published tree you can `git log`.
What it costs is a manual Pages setting and the switchover order below, which can take the site
down if reversed.

The switchover has **not happened yet** — `d72538e` is committed and unpushed at the time of
writing. Continuing is a choice, not a commitment already made, and reverting to the artifact
route is cheaper now than it will be after the source is switched.

## Where the simulation data lives — HERE, and it stays here

`public/data/gravoturb/` is **17 MB across 49 files** (measured 2026-08-08), and it publishes to
`dist/data`, 19 MB of the 28 MB build. It is static output from `progenax gravoturb
build_cluster_ic` — it does not change between deploys.

**There was a plan to move it into a separate data repository. That plan is dropped, on Anna's
call, and the reason is worth keeping**: it existed only because shipping 19 MB on every deploy
looked expensive, and it was not. The billing model was misread (see above), the repository is
public, and its Actions usage bills at $0. A second repository would have bought nothing and cost
a submodule or a fetch step, a second set of credentials, and a way for the site and its data to
land on different versions of each other.

Nothing in the repository ever recorded that plan, which is why it is recorded here now — as a
decision that was made and reversed, so it is not re-proposed from the same wrong premise a third
time.

What keeps this honest instead of merely convenient:

- `scripts/check-data.mjs` derives the required file list from the loaders' own `fetch()` calls
  rather than a hand-written list, so a renamed realization fails the build instead of 404ing in
  a reader's browser, and a file nothing reads is reported as an orphan.
- `force_orphan: true` on the publish means `gh-pages` never accumulates copies of it.

One loose end that check already names and this decision does not resolve: `velocities.f32` — six
files, 1.1 MB — is a BUILD-TIME input read only by `scripts/reference/gen-dynamics-ref.mjs`, yet
it sits under `public/` and ships on every deploy. Moving it out of `public/` is a real change to
the export script's output path and to that check's assumptions, so it stays Anna's call rather
than a silent cleanup.

## Switching over — ORDER MATTERS

Doing these in the wrong order takes the site down.

1. **Push the workflow change to `main` first.** The run publishes a `gh-pages`
   branch. Pages is still set to the Actions source at this point, so the live
   site keeps serving the last artifact deploy — it goes stale for a few
   minutes, it does not break.
2. **Then** switch **Settings → Pages → Build and deployment → Source** to
   *Deploy from a branch*, branch `gh-pages`, folder `/ (root)`.
3. Confirm the custom domain is still `anna-rosen.com` and that *Enforce HTTPS*
   is still ticked. Switching the source can require re-saving the domain; the
   `CNAME` file in the published tree is what makes this survive.
4. Verify the live site, and check that the run created no new artifact:

   ```bash
   gh api repos/drannarosen/drannarosen.github.io/actions/artifacts \
     --jq '[.artifacts[] | select(.expired==false)] | length'
   ```

Reversing 1 and 2 points Pages at a branch that does not exist yet, which is a
404 on the live domain until the first publish lands.

## Rolling back

Set **Source** back to *GitHub Actions* and revert the workflow commit. The last
artifact-based deployment is still live until something replaces it, so the
rollback is a settings change plus a revert, in that order.

## Local commands

```bash
pnpm install
pnpm dev        # local dev server with hot reload
pnpm build      # production build to dist/ — the same command CI runs
pnpm preview    # preview the built site (search needs this, not `dev`)
pnpm check      # astro type checking
```

## Push discipline

**Ask before every push.** That is Anna's standing preference and it holds.

It is a preference, not a budget. The doc used to cap pushes at one a day "because deploys are
no longer free"; they are free, and that cap rested on the misreading corrected above. Commit
locally and batch as much as suits the work — the dev server is what gets reviewed, so nothing
is lost by staying local, and nothing is gained by counting.

## Other workflows

- **GPU gates** (`parity.yml`) — uploads no artifacts.
- **Sync publications from ORCID** (`sync-publications.yml`) — uploads no artifacts.

Neither contributes to Actions storage, and on a public repository that storage is billed at $0
in any case.
