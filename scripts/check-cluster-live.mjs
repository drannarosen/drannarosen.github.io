/*
 * check-cluster-live.mjs — the star panel must still show stars while the loop is running.
 *
 * ── THE BUG THIS EXISTS FOR ──
 *
 * `/explore/dynamics` went black the moment gravity was switched on. The two plot figures kept
 * evolving, the clock kept advancing, and the cluster panel showed nothing.
 *
 * Nothing a value check could see was wrong: 400 stars, no NaN, every alpha non-zero, a sane
 * camera, `frames` climbing at 65 Hz. The draw genuinely happened, and the canvas was cleared
 * before it reached the screen — a per-frame reframe reached `renderer.setSize`, and `redraw()`
 * declined to repaint because the loop was running. Render, wipe, present.
 *
 * ── WHY `check:cluster-points` COULD NOT CATCH IT, AND STILL CANNOT ──
 *
 * That gate pins the rendered image cell by cell, which sounds strictly stronger and is not. It
 * drives the renderer with `redraw()` on a PAUSED host, so it always takes the `if (!raf) draw()`
 * branch and always repaints after any clear. The failure needs the loop RUNNING and a reframe
 * every frame; the pin creates neither. It was invisible there by construction, and would have
 * stayed invisible however many cells it pinned. The pin is left untouched — its determinism is
 * worth keeping, and this is a different kind of claim: not "these pixels" but "any pixels".
 *
 * ── SCREENSHOTS, BECAUSE NOTHING ELSE COULD SEE IT ──
 *
 * Two in-page readbacks were built and measured against the defective renderer while it was
 * blanking the real page in this same browser:
 *
 *   drawImage at the END of the frame callback    every frame lit    (sees the pre-clear image)
 *   drawImage at the START of the next callback   every frame blank  (texture already gone)
 *
 * The first passes forever; the second fails on a healthy renderer. Neither sees what a reader
 * sees. So this photographs the canvas through Playwright and decodes the PNG back inside the
 * page — the compositor's own output, which was the only instrument right about this bug.
 *
 * ── CONTROL AND TREATMENT ──
 *
 * The probe drives positions every frame either way. The reframe is switched ON midway, so the
 * two conditions differ in the one call that broke and are photographed identically. A failure
 * therefore points at `setFraming`, not at the loop, the device or the readback.
 *
 * ── WHY IT CAN GUARD CI ──
 *
 * A pixel baseline only means anything against the rasteriser that recorded it, so
 * `check:cluster-points` cannot run on a GPU-less runner. "Not blank" holds on any rasteriser.
 *
 * Usage:
 *   pnpm check:cluster-live
 */
import { withBrowserPage, makeReporter } from "./lib/browser-harness.mjs";

/* Shots per condition. Several, because one frame proves nothing about a loop. */
const SHOTS = 5;
/* A frame is "lit" if this many pixels carry light. Far below a real cluster (~17,000 measured)
   and far above a black frame, so it separates the two without being tuned to either. */
const LIT_FLOOR = 200;

const r = makeReporter("cluster-live (the panel still draws while the loop runs)");
const { ok, log } = r;

/** Decode a PNG inside the page and count pixels carrying light. */
async function litPixels(page, png) {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const img = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 12) n++;
    }
    img.close();
    return n;
  }, png.toString("base64"));
}

const { result, pageErrors } = await withBrowserPage(
  async (page) => {
    const { ready } = await page.evaluate(async () => {
      const mod = await import("/src/novascope/viz/__fixtures__/clusterPointsLive.ts");
      globalThis.__liveMod = mod;
      return await mod.startLive();
    });

    const shoot = async () => {
      const el = await page.$("#cluster-live");
      if (!el) throw new Error("cluster-live: the probe canvas is not in the document");
      return litPixels(page, await el.screenshot());
    };

    /* CONTROL: positions every frame, no reframe. */
    const control = [];
    for (let i = 0; i < SHOTS; i++) control.push(await shoot());

    /* TREATMENT: the same, plus the per-frame reframe. */
    await page.evaluate(() => globalThis.__liveMod.setReframe(true));
    const treatment = [];
    for (let i = 0; i < SHOTS; i++) treatment.push(await shoot());

    const stats = await page.evaluate(() => globalThis.__liveMod.stopLive());
    return { ready, control, treatment, stats };
  },
  { log },
);

const { ready, control, treatment, stats } = result;
const lo = (a) => (a.length ? Math.min(...a) : 0);
const hi = (a) => (a.length ? Math.max(...a) : 0);

log(`  backend ${stats.backend}, ${stats.driven} frames driven, ${stats.reframes} reframed`);

/* ── the instrument has to be valid before any null result means anything ── */
ok(ready, `the device came up (${stats.backend})`);
ok(!stats.hidden, "the page was visible — a hidden page starves rAF and would fake a pass");
ok(stats.frames >= 20, `the render loop actually ran (${stats.frames} frames presented)`);
ok(stats.reframes >= 10, `the reframe was driven (${stats.reframes} setFraming calls)`);

/* ── the control: the same pipeline WITHOUT the call that broke ── */
ok(
  lo(control) >= LIT_FLOOR,
  `control lit — positions every frame, no reframe (${lo(control)}-${hi(control)} px over ${control.length} shots)`,
);

/* ── the claim ── */
const blank = treatment.filter((n) => n < LIT_FLOOR).length;
ok(
  blank === 0,
  blank === 0
    ? `every reframing frame kept its light (${lo(treatment)}-${hi(treatment)} px over ${treatment.length} shots)`
    : `${blank} of ${treatment.length} shots were BLANK while the control was lit — a reframe is ` +
      `clearing the canvas after the draw. See syncSize/redraw ordering in viz/sceneHost.ts: a ` +
      `reframe must not reach renderer.setSize.`,
);

ok(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0].slice(0, 160)}` : ""}`);

r.finish(
  "cluster-live ok — the panel keeps its picture while the loop drives it",
  "  This is NOT a pixel comparison. A failure means the canvas went BLANK, not that it changed.\n" +
    "  If the control failed too, suspect the probe or the device before the renderer.",
);
