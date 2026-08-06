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
  /** Icon key drawn by ProfileIcon. Omit for a text-only link. */
  icon?: "orcid" | "scholar" | "linkedin" | "github";
}

/*
 * Primary navigation shown in the header.
 *
 * NINE items, and the count is the point. This was twelve, which is more than
 * a visitor will scan: the row had no shape, so finding anything meant reading
 * all of it. Ordered work -> communication -> person.
 *
 * /now, /news and /outreach were REMOVED from here, not deleted. Each is
 * linked from the page a reader looking for it would already be on (see the
 * "Elsewhere" block on /about) and from the footer. If you add one back, the
 * question to answer first is which of the nine it beats.
 *
 * Do not restore /astrobytes to a footer-only link: it sits next to
 * Publications deliberately — formal writing, then informal — after a spell
 * with no header entry at all, reachable only from the footer's RSS link.
 *
 * The label for /group is "Work with me", Anna's choice, replacing "Group" —
 * which promised a member roster that page is not. The page itself is written
 * as a THRESHOLD rather than an advertisement (see the comment at the top of
 * group.astro), so the label is the more inviting of the two halves: the
 * filtering is done by the page's lede, which states eligibility plainly, and
 * by an email that asks for three specifics only a reader of the page can
 * supply. If the old problem returns — mail from people Anna cannot advise —
 * the label is the first thing to reconsider, and "Opportunities" is the
 * alternative that was on the table.
 */
const nav: NavItem[] = [
  { label: "Research", href: "/research" },
  { label: "Explore", href: "/explore" },
  { label: "Publications", href: "/publications" },
  { label: "Astrobytes", href: "/astrobytes" },
  { label: "Software", href: "/software" },
  { label: "Teaching", href: "/teaching" },
  { label: "Work with me", href: "/group" },
  { label: "About", href: "/about" },
  { label: "CV", href: "/cv" },
];

/*
 * External / profile links. `null` until confirmed — provide real URLs.
 *
 * The Scholar URL is the CANONICAL form, `?user=<id>&hl=en`. Scholar hands out
 * links carrying an extra `gmla=` token, which is an opaque session/referral
 * value: it is not needed to reach the profile, it records how that particular
 * link was generated, and it can stop working. Strip it from any replacement.
 */
const links: ExternalLink[] = [
  { label: "ORCID", href: "https://orcid.org/0000-0003-4423-0660", icon: "orcid" },
  {
    label: "Google Scholar",
    href: "https://scholar.google.com/citations?user=aQUPlckAAAAJ&hl=en",
    icon: "scholar",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/annalorrainerosen/",
    icon: "linkedin",
  },
  { label: "GitHub", href: null, icon: "github" },
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

/*
 * Links with a known href, ready to render.
 *
 * The return type keeps the WHOLE ExternalLink and only narrows `href`. It used
 * to be spelled out as `{ label, href }`, which silently dropped every other
 * field — adding `icon` type-checked here and then failed at the call site,
 * because the predicate had quietly redefined what a link is.
 */
export function activeLinks(): Array<ExternalLink & { href: string }> {
  return siteConfig.links.filter(
    (l): l is ExternalLink & { href: string } => l.href !== null,
  );
}
