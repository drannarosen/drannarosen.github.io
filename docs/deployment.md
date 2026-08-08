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

The artifact route (`upload-pages-artifact` + `deploy-pages`) is the modern
default and it is what took this account to 90% of its included Actions
storage.

**GitHub bills Actions storage on bytes CREATED per billing cycle, not on a
snapshot.** Two consequences that are easy to get wrong, and both were:

- Shortening artifact retention does not help. Retention was already one day —
  `upload-pages-artifact` defaults to `retention-days: 1`, and the 90 days shown
  in repo settings is the *maximum allowed*, not what is applied.
- Deleting old artifacts reclaims nothing for the current cycle. Those bytes
  have already been counted.

`dist` is 28 MB, of which 19 MB is `data/gravoturb` — static simulation output
that never changes and was re-uploaded on every single push. Compressed, each
deploy cost 12.6 MB. Measured on 2026-08-08: **31 deploys in one cycle = 390 MB
against a 0.5 GB allowance**, i.e. roughly forty deploys a month before the
account starts being billed.

A branch deploy stores nothing in Actions. Git deduplicates by content, so the
19 MB of unchanged binaries is stored once rather than per push.

`force_orphan: true` is what makes that safe. Without it the branch accumulates
one commit per deploy and the repository grows without bound — the usual and
fair objection to committing build output. With it, `gh-pages` is always exactly
one commit, and unchanged blobs are shared rather than re-sent.

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

Because deploys are no longer free, pushes are **approved individually and
capped at one a day**. Commit locally as much as you like and batch them. The
dev server is what gets reviewed anyway, so nothing is lost by staying local.

## Other workflows

- **GPU gates** (`parity.yml`) — uploads no artifacts.
- **Sync publications from ORCID** (`sync-publications.yml`) — uploads no
  artifacts.

Neither contributes to Actions storage; the Pages artifact was the entire cost.
