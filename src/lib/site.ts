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
 * all of it.
 *
 * They are GROUPED BY PURPOSE, which is the shape that makes the row scannable
 * rather than merely short:
 *
 *   the science      Research · Publications · Software
 *   the teaching     Teaching · Explore · Astrobytes
 *   the person       Group · About · CV
 *
 * Software sits with the science because it IS a research output here, not a
 * tools page; Explore and Astrobytes sit with Teaching because both explain
 * work to someone who has not done it. Previously the order interleaved these
 * — Research, Explore, Publications, Astrobytes, Software — so no two adjacent
 * items shared a purpose and the row taught a reader nothing about itself.
 *
 * Publications stays its OWN item rather than folding into Research. It is the
 * word peers, search committees and panels scan for, and merging it would put
 * the most-sought destination one click inside another page.
 *
 * /now, /news and /outreach were REMOVED from here, not deleted. Each is
 * linked from the page a reader looking for it would already be on (see the
 * "Elsewhere" block on /about) and from the footer. If you add one back, the
 * question to answer first is which of the nine it beats.
 *
 * Do not restore /astrobytes to a footer-only link. It had no header entry at
 * all for a spell, reachable only from the footer's RSS link, and it keeps a
 * primary slot deliberately.
 *
 * It used to sit beside Publications — formal writing, then informal. It now
 * sits with Teaching and Explore, because what those three share is the harder
 * thing: each explains work to someone who has not done it. The old adjacency
 * paired it by FORM (both are writing); this one pairs it by AUDIENCE.
 *
 * The label for /group is "Group" — it NAMES A THING, and both alternatives
 * that were tried instead made an offer.
 *
 * "Work with me" is a warm, unconditional invitation. "Opportunities" is worse:
 * it announces planned, funded positions waiting to be filled, which is exactly
 * the promise that draws cold requests for paid research and TA work from
 * people with no interest in the science. A nav label has no room to state a
 * condition, so a label that makes an offer cannot qualify it.
 *
 * Not "Jaxstro Lab": not every student works on Jaxstro, and naming the group
 * after the software would misdescribe their work.
 *
 * "Group" was rejected once before, for promising a member roster the page did
 * not have. It carries one now — current and graduated students — so the label
 * has become accurate rather than aspirational.
 *
 * The page itself stays a THRESHOLD rather than an advertisement (see the
 * comment at the top of group.astro): eligibility in the lede, and an email
 * asking three specifics only a reader of the page can supply. /research links
 * to it from the foot as well, so there is also a path that runs through the
 * science.
 */
const nav: NavItem[] = [
  // the science
  { label: "Research", href: "/research" },
  { label: "Publications", href: "/publications" },
  { label: "Software", href: "/software" },
  // the teaching
  { label: "Teaching", href: "/teaching" },
  { label: "Explore", href: "/explore" },
  { label: "Astrobytes", href: "/astrobytes" },
  // the person
  { label: "Group", href: "/group" },
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
