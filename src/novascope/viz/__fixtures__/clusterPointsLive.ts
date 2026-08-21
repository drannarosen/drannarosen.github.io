/*
 * clusterPointsLive.ts — does the renderer still SHOW anything while the loop is running?
 *
 * ── WHY THIS IS SEPARATE FROM THE PIXEL PIN ──
 *
 * `clusterPointsBaseline` pins what the renderer draws, cell by cell, against a recorded
 * rasteriser. This asks a much weaker question — is there light on the canvas at all — under a
 * condition that pin cannot create.
 *
 * The condition is the point. `/explore/dynamics` went black the moment gravity was switched on,
 * and everything the pin covers was healthy: 400 stars, no NaN, every alpha non-zero, a sane
 * camera, `frames` climbing at 65 Hz. A per-frame reframe cleared the finished frame after
 * `tick()` had painted it, and `redraw()` declined to repaint because the loop was running.
 *
 * That needs the loop RUNNING, a reframe EVERY frame, and a draw preceding the clear. The pin
 * calls `redraw()` on a paused host, which always takes the `if (!raf) draw()` branch and so
 * always repaints after any clear. The bug was invisible to it by construction.
 *
 * ── THE INSTRUMENT: SCREENSHOTS, NOT `drawImage` ──
 *
 * This module deliberately does NOT read pixels. It drives the renderer and lets the caller
 * photograph the canvas, because an in-page readback cannot see what a WebGPU canvas presents.
 * Both obvious readbacks were built and measured against the defective renderer, which was at the
 * same time blanking the real page in the same browser:
 *
 *   drawImage at the END of the frame callback    every frame lit    (sees the pre-clear image)
 *   drawImage at the START of the next callback   every frame blank  (texture already gone)
 *
 * The first would have passed forever; the second fails even on a healthy renderer. Neither is
 * measuring what a reader sees. The compositor's own output is, and Playwright's element
 * screenshot is that — the only instrument that was right about this bug all along.
 *
 * ── THE VACUITY TRAP ──
 *
 * "Not blank" passes for free if the loop never runs: `start()` paints once and a starved rAF
 * leaves that frame up. So `stopLive` returns the frame counter, the reframe count and the page's
 * visibility, and the gate asserts all three. Measured in that harness, `document.hidden` is false
 * and rAF runs at ~120 Hz; the hidden-tab fear that kept rAF out of the pin's probe belongs to the
 * editor's preview pane, not to this one.
 */
import { createClusterPoints, type ClusterPoints } from "../clusterPoints.ts";
import { baselineModel, BASELINE_SIZE } from "./clusterPointsBaseline.ts";

export interface LiveStats {
  backend: "webgpu" | "webgl2";
  ready: boolean;
  /** Page visibility at the end of the run — a hidden page starves rAF and voids the result. */
  hidden: boolean;
  /** Host frames presented across the whole run. */
  frames: number;
  /** Frames driven, and how many of those issued a `setFraming`. */
  driven: number;
  reframes: number;
}

interface LiveHandle {
  cp: ClusterPoints;
  canvas: HTMLCanvasElement;
  stop: () => LiveStats;
  setReframe: (on: boolean) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __clusterLive: LiveHandle | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Mount the renderer and begin driving it, then return so the caller can photograph the canvas.
 *
 * Starts in the CONTROL condition: positions every frame, no reframe. `setReframe(true)` adds the
 * one call that broke, so the two conditions differ in nothing else and are photographed through
 * the same instrument.
 */
export async function startLive(opts: { forceWebGL?: boolean } = {}): Promise<{ ready: boolean }> {
  const canvas = document.createElement("canvas");
  canvas.id = "cluster-live";
  canvas.style.width = `${BASELINE_SIZE}px`;
  canvas.style.height = `${BASELINE_SIZE}px`;
  canvas.style.display = "block";
  /*
   * BLACK BEHIND IT, and this is load-bearing rather than cosmetic.
   *
   * The renderer's canvas is `alpha: true` and composites over whatever is behind it, so an
   * element screenshot photographs the page as well as the stars. On the site's own background
   * every one of the 320x320 pixels cleared the lit threshold — the measurement returned 102400
   * for a healthy frame AND for a blank one, which is a gate with no power at all rather than a
   * gate that passes. Against black, background pixels are 0 and only stars count.
   */
  canvas.style.background = "#000";
  document.body.style.background = "#000";
  document.body.style.margin = "0";
  document.body.replaceChildren(canvas);

  const model = baselineModel();
  const xyz = new Float32Array(model.stars.length * 3);
  for (let i = 0; i < model.stars.length; i++) {
    const s = model.stars[i]!;
    xyz[i * 3] = s.x;
    xyz[i * 3 + 1] = s.y;
    xyz[i * 3 + 2] = s.z;
  }

  let ready = false;
  const cp = createClusterPoints(canvas, model, {
    forceWebGL: opts.forceWebGL ?? false,
    drifting: false,
    onReady: () => {
      ready = true;
    },
  });
  for (let i = 0; i < 80 && !ready; i++) await sleep(100);

  cp.setZoom(1);
  cp.setFraming({ centre: [0, 0, 0], radiusPc: model.maxR });
  cp.redraw();

  let raf = 0;
  let reframing = false;
  let driven = 0;
  let reframes = 0;
  const framesAtStart = cp.frames;

  const step = (): void => {
    driven++;
    if (reframing) {
      /* A MOVING centre, because that is what the page passes: the bound cluster's centroid,
         which drifts. `setFraming` raises `reframe` unconditionally, so a constant centre would
         exercise it too — but a probe should drive what the page drives. */
      const t = driven / 60;
      cp.setFraming({ centre: [0.02 * Math.cos(t * 6), 0.02 * Math.sin(t * 6), 0] });
      reframes++;
    }
    for (let i = 0; i < xyz.length; i += 3) xyz[i]! += 1e-4;
    cp.setPositions(xyz);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  globalThis.__clusterLive = {
    cp,
    canvas,
    setReframe: (on: boolean) => {
      reframing = on;
    },
    stop: () => {
      if (raf) cancelAnimationFrame(raf);
      const stats: LiveStats = {
        backend: cp.backend,
        ready,
        hidden: document.hidden,
        frames: cp.frames - framesAtStart,
        driven,
        reframes,
      };
      cp.dispose();
      canvas.remove();
      globalThis.__clusterLive = undefined;
      return stats;
    },
  };
  return { ready };
}

/** Switch on the per-frame reframe — the treatment. */
export function setReframe(on: boolean): void {
  globalThis.__clusterLive?.setReframe(on);
}

/** Stop driving and report whether the run was valid. */
export function stopLive(): LiveStats | null {
  return globalThis.__clusterLive?.stop() ?? null;
}
