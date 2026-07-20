// @ts-check
import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { mathMacros } from './src/lib/mathMacros.ts';

import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

// Deployed to GitHub Pages on the custom apex domain anna-rosen.com
// (migrated from drannarosen.github.io on 2026-07-19 — see
// docs/domain-migration.md). `site` builds every canonical URL and every
// absolute Open Graph image URL, so it must match the domain actually served
// or link previews fetch from the wrong host.
// https://astro.build/config
export default defineConfig({
  site: 'https://anna-rosen.com',
  trailingSlash: 'ignore',

  /*
   * Paths from the WordPress site this replaced, recovered from the Wayback
   * Machine. Anything that ever cited anna-rosen.com/curriculum-vitae/ — a
   * talk slide, a paper footnote, someone's bookmarks — would otherwise 404.
   *
   * Astro emits a real page with a meta refresh and a canonical link. That is
   * the only mechanism that works here: GitHub Pages has no server-side
   * redirects, and Cloudflare's rules cannot fire while the proxy is off.
   */
  redirects: {
    '/curriculum-vitae': '/cv',
    '/research-publications': '/publications',
    '/teaching/lamat-python-bootcamp-2015': '/teaching',
  },

  // Markdown math: $inline$ and $$display$$ are parsed by remark-math and typeset
  // by KaTeX at BUILD time (no client JS, no CDN — ADR-0007). Shares the same macro
  // preamble as the <Math> component, so notation is identical in prose and pages.
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      [
        rehypeKatex,
        {
          macros: mathMacros,
          output: 'htmlAndMathml', // MathML for screen readers
          throwOnError: false, // a bad expression renders red instead of failing the build
        },
      ],
    ],
  },

  integrations: [
    mdx(),
    // Unlisted sandboxes carry `noindex` in their <head>, but a crawler has to
    // fetch the page to see that. Excluding them from the sitemap means they
    // are never advertised in the first place.
    sitemap({
      filter: (page) =>
        !['/style-guide', '/volume-lab', '/cluster-lab', '/model-path'].some((p) =>
          page.replace(/\/$/, '').endsWith(p),
        ),
    }),
  ],
});