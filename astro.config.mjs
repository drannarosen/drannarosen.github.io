// @ts-check
import { defineConfig } from 'astro/config';

// Deployed to GitHub Pages user site (root domain, no base path).
// When migrating to anna-rosen.com, only `site` changes — see docs/domain-migration.md.
// https://astro.build/config
export default defineConfig({
  site: 'https://drannarosen.github.io',
  trailingSlash: 'ignore',
});
