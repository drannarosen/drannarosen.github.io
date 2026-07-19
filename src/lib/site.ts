/*
 * site.ts — single source of truth for identity + navigation + external links.
 * Links that aren't known yet are `null` and simply don't render, so nothing
 * is fabricated. Fill these in as they become available.
 */

export interface NavItem {
  label: string;
  href: string;
}

export interface ExternalLink {
  label: string;
  href: string | null;
}

/** Primary navigation shown in the header. */
const nav: NavItem[] = [
  { label: "Research", href: "/research" },
  { label: "Software", href: "/software" },
  { label: "Teaching", href: "/teaching" },
  { label: "Group", href: "/group" },
  { label: "About", href: "/about" },
  { label: "CV", href: "/cv" },
];

/** External / profile links. `null` until confirmed — provide real URLs. */
const links: ExternalLink[] = [
  { label: "ORCID", href: "https://orcid.org/0000-0003-4423-0660" },
  { label: "GitHub", href: null },
  { label: "Google Scholar", href: null },
  { label: "CV (PDF)", href: null },
];

export const siteConfig = {
  name: "Anna Rosen",
  role: "Computational Astrophysicist",
  title: "Assistant Professor of Astronomy",
  affiliation: "San Diego State University",
  email: "alrosen@sdsu.edu",
  nav,
  links,
};

/** Links with a known href, ready to render. */
export function activeLinks(): Array<{ label: string; href: string }> {
  return siteConfig.links.filter(
    (l): l is { label: string; href: string } => l.href !== null,
  );
}
