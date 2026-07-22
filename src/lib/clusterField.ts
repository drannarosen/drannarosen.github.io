/*
 * clusterField.ts — renderer for the hero star-cluster visual.
 *
 * Architecture mirrors Cosmic Playground's starfield: a single canvas driven
 * by requestAnimationFrame, DPR-capped, paused when the tab is hidden or the
 * canvas scrolls offscreen, and fully static under prefers-reduced-motion.
 * Physics (masses, colors, sizes, positions) come from imf.ts — this file only
 * draws and animates.
 *
 * The cluster is a 3D Plummer sphere rotated slowly about the vertical axis, so
 * bright massive stars swing gently between foreground and background. Motion
 * is deliberately near-subliminal ("felt, not noticed").
 */
import { sampleCluster, type Star } from "@novascope/core/imf";

export interface ClusterFieldConfig {
  canvas: HTMLCanvasElement;
  /** Number of stars. Default 520. */
  count?: number;
  /** RNG seed for a reproducible cluster. */
  seed?: number;
  /** Seconds for one full rotation. Default 480 (very slow). */
  rotationPeriodSec?: number;
  /** Cluster on-screen radius as a fraction of min(width,height). Default 0.32. */
  scaleFrac?: number;
  /** Cluster center as fractions of the canvas. Default { x: 0.62, y: 0.46 }. */
  center?: { x: number; y: number };
  /** Force reduced motion (otherwise read from the media query). */
  reducedMotion?: boolean;
}

const MAX_DPR = 1.5;

export function initClusterField(config: ClusterFieldConfig): () => void {
  const { canvas } = config;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};

  const count = config.count ?? 520;
  const rotationPeriod = config.rotationPeriodSec ?? 240;
  const scaleFrac = config.scaleFrac ?? 0.32;
  const centerFrac = config.center ?? { x: 0.62, y: 0.46 };

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = config.reducedMotion ?? motionQuery.matches;

  const stars: Star[] = sampleCluster({ count, seed: config.seed });

  let dpr = 1;
  let width = 0;
  let height = 0;
  let scale = 0;
  let cx = 0;
  let cy = 0;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    scale = Math.min(width, height) * scaleFrac;
    cx = width * centerFrac.x;
    cy = height * centerFrac.y;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(timeSec: number): void {
    ctx!.clearRect(0, 0, width, height);
    ctx!.globalCompositeOperation = "lighter"; // additive — stars sum to glow

    const theta = reduceMotion ? 0.35 : (2 * Math.PI * timeSec) / rotationPeriod;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    for (const s of stars) {
      // Rotate about the vertical (y) axis in 3D → x,z mix.
      const xr = s.x * cosT + s.z * sinT;
      const zr = -s.x * sinT + s.z * cosT;

      const sx = cx + xr * scale;
      const sy = cy + s.y * scale;

      // Depth cue: nearer stars (larger zr) slightly larger & brighter.
      const depth = 1 + zr * 0.12;
      const radius = Math.max(0.35, s.sizePx * depth);

      let opacity = s.baseOpacity * (0.85 + 0.15 * depth);
      if (!reduceMotion && s.twinkles) {
        opacity *= 0.68 + 0.32 * Math.sin(timeSec * 1.7 + s.mass * 3.1);
      }
      opacity = Math.min(1, Math.max(0, opacity));

      const [r, g, b] = s.color;
      const cr = Math.round(r * 255);
      const cg = Math.round(g * 255);
      const cb = Math.round(b * 255);

      // Soft glow for the bright, massive stars only (cheap: they are rare).
      if (radius > 1.6) {
        const glowR = radius * 4.5;
        const grad = ctx!.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${opacity * 0.5})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Crisp core.
      ctx!.fillStyle = `rgba(${cr},${cg},${cb},${opacity})`;
      ctx!.beginPath();
      ctx!.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx!.fill();
    }

    ctx!.globalCompositeOperation = "source-over";
  }

  /* ── Lifecycle: rAF loop, paused when hidden or offscreen ──────────── */
  let rafId = 0;
  let running = false;
  let onScreen = true;
  let startTime: number | null = null;

  function frame(now: number): void {
    if (startTime === null) startTime = now;
    draw((now - startTime) / 1000);
    if (reduceMotion) {
      running = false;
      return; // one static frame is enough
    }
    rafId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    if (document.hidden || !onScreen) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  const io = new IntersectionObserver(
    (entries) => {
      onScreen = entries[0]?.isIntersecting ?? true;
      if (onScreen) start();
      else stop();
    },
    { threshold: 0 },
  );

  function onResize(): void {
    resize();
    if (!running) {
      // Repaint a single frame so a static/paused canvas stays correct.
      draw(startTime === null ? 0 : (performance.now() - startTime) / 1000);
    }
  }

  function onMotionChange(): void {
    reduceMotion = motionQuery.matches;
    if (reduceMotion) stop();
    startTime = null;
    if (reduceMotion) resize(), draw(0.35 * rotationPeriod);
    else start();
  }

  resize();
  io.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  motionQuery.addEventListener("change", onMotionChange);
  start();
  if (reduceMotion) draw(0.35 * rotationPeriod);

  return function cleanup(): void {
    stop();
    io.disconnect();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    motionQuery.removeEventListener("change", onMotionChange);
  };
}
