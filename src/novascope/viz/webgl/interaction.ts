/*
 * interaction.ts — pointer/wheel/touch controls for a ClusterEngine.
 *
 * Decoupled from the engine: it reads the current view (getView) and drives
 * changes through setView, so a surface can opt into direct manipulation OR drive
 * the view programmatically (scrollytelling) without the two fighting.
 *
 *   drag                       → orbit (yaw + pitch), stops auto-spin
 *   shift-drag / right / 2-fing → pan
 *   wheel / pinch              → zoom
 *   double-click               → reset view (resume auto-spin)
 */

import type { ClusterEngine } from "./engine.ts";
import { ZOOM_MIN, ZOOM_MAX } from "./engine.ts";

const ROT = 3.0; // radians per full canvas-height drag
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Attach direct-manipulation controls to `canvas`. Returns a detach function. */
export function attachInteraction(
  canvas: HTMLCanvasElement,
  engine: ClusterEngine,
  onArm?: (armed: boolean) => void,
): () => void {
  const ac = new AbortController();
  const sig: AddEventListenerOptions = { signal: ac.signal };
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";

  /*
   * "Armed" gesture model, matching viz/camera's attachOrbit. The pane accepts
   * wheel-zoom only after a pointer press, and disarms when the pointer leaves.
   * Without it, scrolling the PAGE over an un-clicked pane is hijacked into a
   * zoom — the accidental-zoom the census engine already fixed. `onArm` reports
   * the state so a caller can show an affordance.
   */
  let armed = false;
  const setArmed = (v: boolean): void => {
    if (v === armed) return;
    armed = v;
    onArm?.(v);
  };

  canvas.addEventListener("wheel", (e) => {
    // Return BEFORE preventDefault so an un-armed pane lets the page scroll.
    if (!armed) return;
    e.preventDefault();
    engine.setView({ zoom: clampZoom(engine.getView().zoom * Math.exp(e.deltaY * 0.001)) });
  }, { signal: ac.signal, passive: false });

  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let mode: "rotate" | "pan" = "rotate";
  const spread = (): number => {
    const v = [...pts.values()];
    return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault(), sig);
  canvas.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    setArmed(true);
    if (pts.size === 1) mode = (e.shiftKey || e.button === 2) ? "pan" : "rotate";
    if (pts.size === 2) { mode = "pan"; pinch = spread(); }
  }, sig);

  canvas.addEventListener("pointerleave", () => setArmed(false), sig);

  canvas.addEventListener("pointermove", (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const h = canvas.getBoundingClientRect().height;
    const dx = (e.clientX - prev.x) / h, dy = (e.clientY - prev.y) / h;
    const v = engine.getView();
    if (pts.size === 1) {
      if (mode === "pan") {
        engine.setView({ panX: v.panX + dx, panY: v.panY - dy });
      } else {
        engine.setView({ spin: false, yaw: v.yaw + dx * ROT, pitch: v.pitch + dy * ROT });
      }
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch > 0) {
      const d = spread();
      engine.setView({ zoom: clampZoom((v.zoom * pinch) / d) });
      pinch = d;
    }
  }, sig);

  const release = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    pinch = 0;
    if (pts.size === 0) canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", release, sig);
  canvas.addEventListener("pointercancel", release, sig);
  canvas.addEventListener("dblclick", () => engine.resetView(), sig);

  return () => ac.abort();
}
