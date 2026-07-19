/*
 * clusterArt.ts — render Anna's real gravoturb cluster (exported by
 * scripts/gravoturb/export_cluster.py) as web art.
 *
 * Two modes share one lifecycle (DPR cap, resize, reduced-motion, pause when
 * hidden/offscreen, cleanup):
 *   'flat'   — the 2D projected gas field (smooth image) + stars projected in x,y
 *   'rotate' — stars + a 3D gas-mote cloud, tumbling about the vertical axis
 *
 * Palette is restrained: the gas is near-monochrome teal; the ONLY real color is
 * the stars, carrying their true spectral color via teffToRGB.
 */
import { teffToRGB } from "./imf";

export interface ClusterMeta {
  ngrid: number;
  box_pc: number;
  n_stars: number;
  n_gas_points: number;
  gas_log_min: number;
  gas_log_max: number;
  lambda_corr: number;
}

export interface ClusterData {
  meta: ClusterMeta;
  stars: Float32Array; // n_stars * 6: x,y,z,mass,teff,radius
  gas: Float32Array; // ngrid*ngrid, log10 surface density
  gasPoints: Uint8Array; // n_gas_points * 4: i,j,k,dens
}

export async function loadClusterData(
  base = "/data/gravoturb",
): Promise<ClusterData> {
  const [meta, starsBuf, gasBuf, gpBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
    fetch(`${base}/gas.f32`).then((r) => r.arrayBuffer()),
    fetch(`${base}/gas_points.u8`).then((r) => r.arrayBuffer()),
  ]);
  return {
    meta,
    stars: new Float32Array(starsBuf),
    gas: new Float32Array(gasBuf),
    gasPoints: new Uint8Array(gpBuf),
  };
}

/* Deterministic tiny PRNG so the mote jitter is stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Prepared {
  // stars, box-centered pc + display attributes
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  sr: string[]; // css "r,g,b" per star
  ssize: Float32Array; // point radius (px scale factor)
  // gas motes, jittered to box-centered pc + brightness 0..1
  gx: Float32Array;
  gy: Float32Array;
  gz: Float32Array;
  gb: Float32Array;
}

function prepare(data: ClusterData): Prepared {
  const { meta, stars, gasPoints } = data;
  const n = meta.n_stars;
  const box = meta.box_pc;

  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const sr: string[] = new Array(n);
  const ssize = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    sx[i] = stars[o];
    sy[i] = stars[o + 1];
    sz[i] = stars[o + 2];
    const teff = stars[o + 4];
    const radius = stars[o + 5];
    const [r, g, b] = teffToRGB(teff);
    sr[i] = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    ssize[i] = 0.5 + 1.7 * Math.sqrt(Math.min(radius, 25));
  }

  const m = meta.n_gas_points;
  const ng = meta.ngrid;
  const rng = mulberry32(1234);
  const gx = new Float32Array(m);
  const gy = new Float32Array(m);
  const gz = new Float32Array(m);
  const gb = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const o = i * 4;
    // sub-cell jitter dissolves the grid lattice into a smooth cloud
    gx[i] = ((gasPoints[o] + rng()) / ng) * box - box / 2;
    gy[i] = ((gasPoints[o + 1] + rng()) / ng) * box - box / 2;
    gz[i] = ((gasPoints[o + 2] + rng()) / ng) * box - box / 2;
    gb[i] = gasPoints[o + 3] / 255;
  }
  return { sx, sy, sz, sr, ssize, gx, gy, gz, gb };
}

export interface ClusterArtOptions {
  mode: "flat" | "rotate";
  rotationPeriodSec?: number;
  reducedMotion?: boolean;
}

const MAX_DPR = 1.5;

export function initClusterArt(
  canvas: HTMLCanvasElement,
  data: ClusterData,
  opts: ClusterArtOptions,
): () => void {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};

  const prep = prepare(data);
  const box = data.meta.box_pc;
  const rotationPeriod = opts.rotationPeriodSec ?? 140;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = opts.reducedMotion ?? motionQuery.matches;

  // Pre-render the flat gas field to an offscreen NGRID canvas (once).
  const ng = data.meta.ngrid;
  const gasImg = document.createElement("canvas");
  gasImg.width = ng;
  gasImg.height = ng;
  {
    const gctx = gasImg.getContext("2d")!;
    const img = gctx.createImageData(ng, ng);
    const lo = data.meta.gas_log_min;
    const hi = data.meta.gas_log_max;
    for (let j = 0; j < ng; j++) {
      for (let i = 0; i < ng; i++) {
        const v = (data.gas[j * ng + i] - lo) / (hi - lo); // 0..1
        const a = Math.pow(Math.max(0, v), 1.3); // soften the low end
        const p = (j * ng + i) * 4;
        // near-monochrome teal gas
        img.data[p] = 60 + 90 * a;
        img.data[p + 1] = 150 + 80 * a;
        img.data[p + 2] = 150 + 70 * a;
        img.data[p + 3] = 235 * a;
      }
    }
    gctx.putImageData(img, 0, 0);
  }

  let dpr = 1;
  let w = 0;
  let h = 0;
  let scale = 0;
  let cx = 0;
  let cy = 0;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = (Math.min(w, h) / box) * 0.9;
    cx = w / 2;
    cy = h / 2;
  }

  function drawStar(sxp: number, syp: number, radius: number, color: string, alpha: number): void {
    if (radius > 1.4) {
      const gr = ctx!.createRadialGradient(sxp, syp, 0, sxp, syp, radius * 5);
      gr.addColorStop(0, `rgba(${color},${alpha * 0.5})`);
      gr.addColorStop(1, `rgba(${color},0)`);
      ctx!.fillStyle = gr;
      ctx!.beginPath();
      ctx!.arc(sxp, syp, radius * 5, 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.fillStyle = `rgba(${color},${alpha})`;
    ctx!.beginPath();
    ctx!.arc(sxp, syp, radius, 0, Math.PI * 2);
    ctx!.fill();
  }

  function drawFlat(): void {
    ctx!.clearRect(0, 0, w, h);
    // soft gas image, smoothed up to fill the canvas
    ctx!.imageSmoothingEnabled = true;
    const gw = box * scale;
    ctx!.globalAlpha = 0.9;
    ctx!.drawImage(gasImg, cx - gw / 2, cy - gw / 2, gw, gw);
    ctx!.globalAlpha = 1;
    // stars projected in x,y (brightest last)
    ctx!.globalCompositeOperation = "lighter";
    const n = data.meta.n_stars;
    for (let i = 0; i < n; i++) {
      drawStar(cx + prep.sx[i] * scale, cy + prep.sy[i] * scale, prep.ssize[i], prep.sr[i], 0.9);
    }
    ctx!.globalCompositeOperation = "source-over";
  }

  function drawRotate(timeSec: number): void {
    ctx!.clearRect(0, 0, w, h);
    const theta = reduceMotion ? 0.5 : (2 * Math.PI * timeSec) / rotationPeriod;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // gas motes first (additive, faint, teal)
    ctx!.globalCompositeOperation = "lighter";
    const m = data.meta.n_gas_points;
    for (let i = 0; i < m; i++) {
      const xr = prep.gx[i] * cosT + prep.gz[i] * sinT;
      const sxp = cx + xr * scale;
      const syp = cy + prep.gy[i] * scale;
      const a = prep.gb[i] * 0.22;
      ctx!.fillStyle = `rgba(90,180,175,${a})`;
      ctx!.fillRect(sxp, syp, 1.4, 1.4);
    }
    // stars on top, depth-shaded
    const n = data.meta.n_stars;
    for (let i = 0; i < n; i++) {
      const xr = prep.sx[i] * cosT + prep.sz[i] * sinT;
      const zr = -prep.sx[i] * sinT + prep.sz[i] * cosT;
      const sxp = cx + xr * scale;
      const syp = cy + prep.sy[i] * scale;
      const depth = 1 + (zr / box) * 0.6; // nearer = brighter/bigger
      drawStar(sxp, syp, Math.max(0.4, prep.ssize[i] * depth), prep.sr[i], Math.min(1, 0.55 + 0.45 * depth));
    }
    ctx!.globalCompositeOperation = "source-over";
  }

  /* ── lifecycle ─────────────────────────────────────────────────── */
  let raf = 0;
  let running = false;
  let onScreen = true;
  let start: number | null = null;

  function frame(now: number): void {
    if (start === null) start = now;
    drawRotate((now - start) / 1000);
    if (reduceMotion) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function play(): void {
    if (opts.mode === "flat") {
      drawFlat();
      return;
    }
    if (running || document.hidden || !onScreen) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const io = new IntersectionObserver(
    (e) => {
      onScreen = e[0]?.isIntersecting ?? true;
      if (onScreen) play();
      else stop();
    },
    { threshold: 0 },
  );

  function onVisibility(): void {
    if (document.hidden) stop();
    else play();
  }
  function onResize(): void {
    resize();
    if (opts.mode === "flat" || !running) {
      if (opts.mode === "flat") drawFlat();
      else drawRotate(start === null ? 0 : (performance.now() - start) / 1000);
    }
  }

  resize();
  // Always paint one frame immediately so the canvas is never blank — even if
  // the page is hidden, offscreen, or reduced-motion. The loop (below) then only
  // animates when it's allowed to.
  if (opts.mode === "flat") drawFlat();
  else drawRotate(0.12 * rotationPeriod);
  io.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  play();

  return function cleanup(): void {
    stop();
    io.disconnect();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
