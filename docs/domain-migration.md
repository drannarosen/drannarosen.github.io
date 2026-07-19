# Domain migration: drannarosen.github.io → anna-rosen.com

Goal: serve this site at **anna-rosen.com** and retire the old WordPress site —
**without breaking email** to `@anna-rosen.com`.

> ⚠️ **The one rule that matters most:** changing where a *website* lives means
> touching only **A / AAAA / CNAME** records for the web. **Never touch the
> `MX`, `SPF` (TXT), `DKIM` (TXT), or `DMARC` (TXT) records** — those route your
> email. Leave them exactly as they are and email keeps working through the
> whole migration.

## First, know the four roles (they're often different companies)

| Role | What it does | How to find it |
|------|--------------|----------------|
| **Registrar** | Where the domain is *rented* (e.g. Namecheap, GoDaddy, Google Domains/Squarespace) | Look up `anna-rosen.com` on [whois](https://who.is) or your billing |
| **DNS provider** | Where the records live (the *nameservers*) — may be the registrar or Cloudflare | `dig NS anna-rosen.com +short` |
| **Web host** | Where the WordPress site is served today | Whoever you pay for WordPress hosting |
| **Email provider** | Where `@anna-rosen.com` mail is handled (may be the same host, or Google/Microsoft) | `dig MX anna-rosen.com +short` |

You only change records at the **DNS provider**. The **web host** is what you
cancel at the end. The **email provider** you leave completely alone.

## Step-by-step (safe order)

### 1. Confirm the new site is healthy at drannarosen.github.io
Already done — it's live and auto-deploys on push.

### 2. Add the custom domain on the code side (I can do this on request)
- Add `public/CNAME` containing a single line: `anna-rosen.com`
- Change `site` in `astro.config.mjs` to `https://anna-rosen.com`
- Commit + push (deploys automatically)

Do this *together with* step 3 — ideally right before.

### 3. Point DNS at GitHub Pages (at your DNS provider)
For an **apex** domain (`anna-rosen.com`) GitHub Pages needs these **A** records:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
…and (optional but recommended) the matching **AAAA** records:
```
2606:50c0:8000::153   2606:50c0:8001::153
2606:50c0:8002::153   2606:50c0:8003::153
```
For **www**, add a **CNAME**: `www` → `drannarosen.github.io`.

**Remove** the old A/CNAME records that currently point the web at WordPress.
**Do not remove** MX or any TXT record you didn't create for this.

> If your DNS is on **Cloudflare**, set these records to **DNS-only** (grey
> cloud) initially so GitHub can issue the TLS certificate; you can re-enable
> proxying later.

### 4. Set the custom domain in the repo
GitHub → repo **Settings → Pages → Custom domain** → enter `anna-rosen.com` →
Save. Wait for the DNS check to pass, then tick **Enforce HTTPS** (may take a
few minutes to an hour for the certificate).

### 5. Verify
- `https://anna-rosen.com` and `https://www.anna-rosen.com` both load the new site
- Send yourself a test email to/from `@anna-rosen.com` — **confirms email still works**

### 6. Only now, retire WordPress
Once the domain reliably serves the new site **and** email is confirmed working:
- In WordPress, take the site offline / unpublish, or
- Cancel the WordPress **hosting** plan (not the domain registration, and not
  email if it's bundled — check first).

Keep a backup/export of the old WordPress content first (the URL inventory is in
`docs/wordpress-migration-inventory.md` when created). Don't cancel anything on
the same day you cut over — give it a few days in case you need to roll back.

## Rollback
If something's wrong, revert the DNS A/CNAME records to their old values at the
DNS provider. Propagation is usually minutes. Because email records were never
touched, mail is unaffected either way.

## What I can do vs. what only you can do
- **I can:** add `public/CNAME`, update `astro.config.mjs`, and set the repo's
  custom domain via the API — on your explicit go-ahead.
- **Only you can:** change DNS records and cancel WordPress hosting. I won't
  touch DNS or the WordPress site.
