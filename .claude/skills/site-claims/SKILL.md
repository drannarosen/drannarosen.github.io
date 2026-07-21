---
name: site-claims
description: Use whenever writing, editing, or reviewing any text that will appear on drannarosen.github.io — page copy, frontmatter, figure captions, taglines, package descriptions, CV entries, or commit-visible docs. Enforces that every published claim traces to something Anna said, the repo contains, or a cited source says.
---

# Claims on Anna's site

Everything here publishes under Anna's name. An invented detail is not a
rough draft — it is her, in public, asserting something untrue. She has to
defend it to peers, students, and referees. She cannot spot it, because it
reads exactly like the sentences around it.

## The rule

A statement may go on the site only if one of these is true:

1. **Anna said it** — in this conversation or a recorded decision.
2. **The repo contains it** — verified by reading the code, tests, or
   validation artifacts. Not the README's marketing copy.
3. **A cited source says it** — a paper, an official table, a published record.

Otherwise it does not go on the site. **Leave the field out.** An omission is
invisible to a reader; an invention is a claim.

## Where this keeps failing

Every real incident has the same shape: a field wanted content, no content
existed, and a plausible sentence appeared to fill it.

| What shipped | What was actually known |
| --- | --- |
| `jaxstro`: "methods paper in prep" | Nothing had been said about any paper. It gets a *software* paper only. |
| `startrax`: "differentiable binary-evolution layer in progress" | No binary code exists in the package. |
| `/now`: "where most of my mornings go" | Which paper, and roughly when. Nothing about mornings. |

None were malicious. All read naturally. That is why they are dangerous.

## Highest-risk fields

Treat these as requiring a source every time:

- **Publication venue, kind, and status** — never name a journal; never assert
  a paper exists, is planned, is in preparation, or is submitted, unless told.
- **Timelines** — dates, "by the end of", "next semester", "soon".
- **What a package can do** — verify against tests and validation artifacts,
  never a docstring or a plan document. Plans describe intentions, not code.
- **People** — degree programmes, titles, roles, affiliations.
- **Anna herself** — habits, schedule, working patterns, feelings, motives.
  She has a name and a CV; she does not have a documented daily routine.

## When there is nothing to say

Say less. A short honest page beats a padded one, and this site is explicitly
designed to look deliberate with an empty body. If a field genuinely needs
filling, ask one question rather than writing one sentence.

## When reporting back

Say which claims came from where. If something was inferred rather than
stated, flag it in the response — before it ships, not after.
