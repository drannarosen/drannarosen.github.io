# Domain migration: drannarosen.github.io → anna-rosen.com

Goal: serve this site at **anna-rosen.com** and retire the old WordPress site —
**without breaking email** to `@anna-rosen.com`.

> ⚠️ **The one rule that matters most:** changing where a *website* lives means
> touching only **A / AAAA / CNAME** records for the web. **Never touch the
> `MX`, `SPF` (TXT), `DKIM` (TXT), or `DMARC` (TXT) records** — those route your
> email. Leave them exactly as they are and email keeps working through the
> whole migration.

## Your current setup (discovered from public DNS, 2026-07)

| Role | Who | Notes |
|------|-----|-------|
| **Registrar** | Squarespace Domains (formerly Google Domains) | Where you log in to manage the domain |
| **DNS** | WordPress.com (`ns1/2/3.wordpress.com`) | Records are edited via WordPress.com today |
| **Web host** | WordPress.com (`192.0.78.24/25`) | The site you're replacing |
| **Email** | **None** — no `MX` records exist | ✅ No email to break; the migration is low-risk |

Because there's no email on the domain, the usual "don't touch MX/SPF/DKIM"
warning below is precautionary only — there is currently nothing there to
disturb. (If you ever add email later, that changes.)

## The two flips (they are independent)

The single most useful thing to understand: **your DNS provider is not your web
host.** WordPress.com happens to be *both* right now, but they are separate jobs,
and you can change one without touching the other.

| Flip | What changes | Visible effect | Reversible? |
|------|--------------|----------------|-------------|
| **1. Move nameservers** (WordPress.com → Cloudflare), records unchanged | *Who answers* DNS | **Nothing.** WordPress keeps serving the site exactly as today | Yes — switch nameservers back |
| **2. Repoint A/CNAME** (WordPress → GitHub Pages) | *What the answer is* | The new site goes live | Yes — restore the old records |

Flip 1 is a **safe no-op**: you can do it, verify nothing broke, and sit there for
as long as you like before doing flip 2. Moving DNS does **not** move or delete
your WordPress site.

### Two paths — pick one

- **Path A — Cloudflare first (recommended long-term).** Do flip 1 (nameservers →
  Cloudflare, keeping the WordPress records), confirm the old site still loads,
  then later do flip 2 by editing records at Cloudflare. This gets DNS control out
  of WordPress cleanly and sets up Cloudflare Pages later if you ever want it.
- **Path B — fastest to launch.** Skip Cloudflare for now; just edit the A/CNAME
  records **at WordPress.com** to point at GitHub Pages (flip 2 only). Fewest
  moving parts. You may first need to *disconnect* the domain from the WordPress
  site in the WP.com dashboard. You can still move to Cloudflare any time later.

Either way the GitHub records are the same (below).

### Cloudflare DNS vs Cloudflare Pages — not the same thing

| | What it is | What it replaces |
|---|---|---|
| **Cloudflare DNS** | The phone book: answers "where does `anna-rosen.com` live?" Hosts nothing. Free. | WordPress.com's nameservers |
| **Cloudflare Pages** | A *host*: builds from the GitHub repo and serves files on Cloudflare's CDN | GitHub Pages |

You can use Cloudflare DNS while still hosting on GitHub Pages — that is the
recommended Phase 1. Only adopt Pages if you later want per-branch preview
deploys or a stronger CDN for the heavy `/explore` data files.

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

Don't cancel anything on the same day you cut over — give it a few days in case
you need to roll back.

**On the prepaid year: it's a sunk cost.** You've paid whether or not you use it,
so there's no value in delaying the switch — waiting only means `anna-rosen.com`
keeps showing the outdated site for months. Repoint the domain now, let the plan
run out unused (the WordPress site stays reachable at its `*.wordpress.com`
address as a private archive), and simply don't renew.

#### Export checklist — do this BEFORE the plan lapses

> ⚠️ **The trap:** the XML export contains posts and pages, but **media files are
> only referenced by URL** — the images themselves live in WordPress's media
> library and disappear with the plan. Export the text *and* download the media,
> or you'll be left with an archive full of dead image links.

- [ ] **Tools → Export → All content** → save the `.xml` file
- [ ] **Download the media library** separately (Media → select all → download, or
      an export plugin / `wget` mirror of the site)
- [ ] Note any URLs worth preserving as redirects (old permalinks)
- [ ] Commit anything worth keeping into this repo (`public/` for images, markdown
      for text) so it is version-controlled and served for free

What you give up, and what replaces it:

| Lose with WordPress | Replacement here |
|---------------------|------------------|
| Media / file storage | `public/` in the repo (Git-tracked, free) |
| CMS editing UI | Markdown + Astro content collections |
| Contact form | `mailto:` link (email already in `src/lib/site.ts`) |
| Comments / plugins / analytics | Intentionally none (ADR-0007, privacy-first) |

## Rollback
If something's wrong, revert the DNS A/CNAME records to their old values at the
DNS provider. Propagation is usually minutes. Because email records were never
touched, mail is unaffected either way.

## What I can do vs. what only you can do
- **I can:** add `public/CNAME`, update `astro.config.mjs`, and set the repo's
  custom domain via the API — on your explicit go-ahead.
- **Only you can:** change DNS records and cancel WordPress hosting. I won't
  touch DNS or the WordPress site.
