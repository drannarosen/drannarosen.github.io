/*
 * slug.ts — stable, URL-safe fragment ids for section headings.
 *
 * Section titles are human prose ("Selected Awards & Honors") and are used both
 * as `aria-labelledby` targets and as URL fragments (/cv#awards). Raw titles
 * contain spaces and ampersands, which are not usable in a fragment, so every
 * heading id goes through here.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
