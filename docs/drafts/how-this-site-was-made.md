# DRAFT — "The site my science deserved" (working title)

**Status: raw material, not for publication as-is.** This was AI-drafted and
has NOT been reviewed or rewritten by Anna. It lives in `docs/drafts/`, not in
the astrobytes collection, precisely so it makes no published claim and carries
no review provenance it hasn't earned.

**Before this ships it needs, at minimum:**

1. **Anna's voice.** The prose below is serviceable and generic. It is not
   hers. Rewrite it — the facts are a scaffold, the sentences are disposable.
2. **A publication decision.** Recommend holding until the progenax methods
   paper is further along (see the note at the end on why).
3. **Real provenance.** When it moves into the collection: `kind: meta`,
   `authorship: ai-drafted`, `reviewedBy: Anna Rosen`, a real `reviewedOn`
   date, and the model — set only once the review has actually happened.
4. **A fact-check.** Every claim below is drawn from what Anna said or what the
   repository verifiably contains. Confirm each one still holds.

---

## The angle (why this post is worth writing at all)

Not "look how fast an AI built my website." That framing cuts against you — a
skeptical peer reads it and quietly discounts the science software next to it.

The honest and more interesting angle: **a computational astrophysicist who
demands provenance from her data demanded the same from her own website.** The
story is the standard, not the speed. The site refuses to make a claim it
can't trace — the same discipline as the research — and that's the through-line
worth writing.

---

## Draft body

For about a decade my website was a WordPress site I had stopped believing in.
It worked, in the sense that it loaded. It was also a dinosaur, and I never had
the time to replace it — the way you never have time to fix the thing that is
merely embarrassing rather than actually broken.

So I rebuilt it, mostly in a day, in the margins of doing other work.

That sentence could read as a boast about speed. It isn't. The interesting part
is not that a website went up quickly; websites go up quickly all the time. The
interesting part is what I refused to compromise on while it did, which turned
out to be the same thing I refuse to compromise on in my research: I do not want
this site to tell you anything it cannot back up.

That sounds obvious until you notice how much of a normal academic website is
quietly unverified. A figure that no longer matches the paper it came from. A
"selected publications" list frozen three years ago. A software page describing
features that exist mostly in the author's intentions. None of it is a lie,
exactly. It is just drift — the slow divergence between what a page says and
what is true — and it is invisible, because a stale page looks exactly like a
current one.

So the site is built to make drift fail loudly. Every figure carries a
cryptographic fingerprint of the exact image it should be; if the file changes
and the record doesn't, the build stops. A figure's caption lives in one place,
so the same plot can't say one number on one page and a different number on
another. The type scale can't be bypassed. Every internal link is checked.
There is even a rule that the software pages may not describe a capability the
code doesn't actually have — which, the first time I turned it on, caught my own
site claiming a feature I had not built yet.

That last one is the part I would tell a student about. The value of a system
that checks your claims is not that it makes you look good. It is that it
occasionally catches you being wrong, in public, under your own name, before
anyone else does.

The build itself was AI-assisted, and I'll say so plainly, because a site about
honesty that hid how it was made would be a bad joke. The judgment was mine: the
research program the site describes, the standards it holds itself to, the
decisions about what to claim and what to hold back. The AI was a fast pair of
hands that I supervised closely — and "closely" is doing real work in that
sentence, because most of my actual effort went into catching the places where
a plausible-sounding sentence had slipped in that I never authorized. Which is,
now that I write it down, exactly the problem the whole site is designed to
solve.

The old site is still archived, if you want to see the dinosaur. This one I
will actually keep current — not because I finally have the time, but because I
finally built something that tells me when I've let it go stale.

---

## Fact-check notes (resolve before publishing)

- "about a decade" — CONFIRM the actual age of the WordPress site. If unknown,
  soften to "years".
- "caught my own site claiming a feature I had not built yet" — this is real:
  the startrax page claimed a differentiable binary-evolution layer that does
  not exist. Keep only if you're comfortable naming the failure publicly; it is
  more credible WITH a concrete example, but it is your call to expose it.
- "mostly in a day" — true per Anna. Keep only if the surrounding framing stays
  on standard-not-speed, or it undercuts the science.
- Do not name specific gate implementations in a way that invites someone to
  copy the design wholesale — describe the behavior, not the mechanism.
- The post must not mention any grant, deadline, or funding context (repo is
  public; project rule).

## Why hold it

"I spent a day polishing my website" lands very differently depending on what
else is visibly shipping. Published alongside the progenax methods paper, it
reads as a confident aside from someone whose real work is landing. Published
into a software section where every package still says "source opens with the
paper," it reads as priorities in the wrong place. Ship the science first, then
this.
