// @ts-check
import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { mathMacros } from './src/lib/mathMacros.ts';

import mdx from '@astrojs/mdx';

// Deployed to GitHub Pages user site (root domain, no base path).
// When migrating to anna-rosen.com, only `site` changes — see docs/domain-migration.md.
// https://astro.build/config
export default defineConfig({
  site: 'https://drannarosen.github.io',
  trailingSlash: 'ignore',

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

  integrations: [mdx()],
});