# Deployment

The site is a static Astro build deployed to **GitHub Pages** via GitHub
Actions.

## How it works

- **Repo:** `drannarosen/drannarosen.github.io` (a GitHub *user site*).
- **Live URL:** https://drannarosen.github.io/ (root domain, no base path).
- **Trigger:** every push to `main` runs
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
- **Build:** `withastro/action@v3` auto-detects pnpm from the lockfile, runs
  `astro build`, and uploads `dist/` as the Pages artifact.
- **Deploy:** `actions/deploy-pages@v4` publishes the artifact.

Pages is configured with **Build and deployment → Source: GitHub Actions**
(not the legacy branch-based build).

## Local commands

```bash
pnpm install
pnpm dev        # local dev server with hot reload
pnpm build      # production build to dist/
pnpm preview    # preview the built site
pnpm check      # astro type checking (must pass before deploy)
```

## First-time / one-off setup notes

- The repo must have Pages enabled with the **GitHub Actions** source. This was
  set once via the API (`build_type=workflow`); no further action needed.
- No secrets are required — the workflow uses the built-in `GITHUB_TOKEN`.

## Custom domain (later)

Moving to `anna-rosen.com` changes only `site` in `astro.config.mjs` and adds a
`public/CNAME` file plus DNS records. That migration is intentionally deferred;
it must **not** touch existing MX/SPF/DKIM/DMARC email records. A dedicated
`docs/domain-migration.md` will cover it when the time comes.
