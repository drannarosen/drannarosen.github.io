/*
 * clusterArt.ts — render Anna's real gravoturb cluster (exported by
 * scripts/gravoturb/export_cluster.py) as web art.
 *
 * Two modes share one lifecycle (DPR cap, resize, reduced-motion, pause when
 * hidden/offscreen, cleanup):
 *   'flat'   — the 2D projected gas field (smooth image) + stars projected in x,y
 *   'rotate' — stars + a 3D gas-mote cloud, tumbling about the vertical axis
 *
 * Stars use Anna's own validated spectral palette (Teff -> color), with GLOW
 * driven by luminosity (L ∝ R^2 Teff^4) so a blue giant reads as a brilliant
 * blue point, not a white blob. Gas is a restrained teal, brightness ∝ density.
 */

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

export async function loadClusterData(base = "/data/gravoturb"): Promise<ClusterData> {
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

/* ── Anna's validated spectral palette (feasibility_figure) ───────────
 * Colors anchored at spectral-class centers; interpolated in log-Teff. */
const SPEC_LOGT = [2980, 4386, 5586, 6708, 8660, 17320, 40620].map(Math.log10);
const SPEC_RGB: [number, number, number][] = [
  [194, 74, 40], // M
  [232, 121, 31], // K
  [243, 201, 90], // G
  [247, 243, 226], // F
  [205, 217, 255], // A
  [154, 184, 255], // B
  [129, 114, 255], // O
];

function spectralRGB(teff: number): [number, number, number] {
  const t = Math.log10(Math.min(55000, Math.max(2400, teff)));
  if (t <= SPEC_LOGT[0]) return SPEC_RGB[0];
  const last = SPEC_LOGT.length - 1;
  if (t >= SPEC_LOGT[last]) return SPEC_RGB[last];
  let i = 0;
  while (i < last && t > SPEC_LOGT[i + 1]) i++;
  const f = (t - SPEC_LOGT[i]) / (SPEC_LOGT[i + 1] - SPEC_LOGT[i]);
  const a = SPEC_RGB[i];
  const b = SPEC_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

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
  order: Int32Array; // star draw order, faint -> bright
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  color: string[]; // "r,g,b" per star
  core: Float32Array; // crisp core radius (px)
  glow: Float32Array; // glow radius (px)
  glowA: Float32Array; // glow alpha
  hot: Float32Array; // white-hot core factor 0..1 (hottest stars sparkle)
  gx: Float32Array;
  gy: Float32Array;
  gz: Float32Array;
  gsize: Float32Array; // mote size (px), ∝ density
}

function prepare(data: ClusterData): Prepared {
  const { meta, stars, gasPoints } = data;
  const n = meta.n_stars;
  const box = meta.box_pc;

  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const color: string[] = new Array(n);
  const core = new Float32Array(n);
  const glow = new Float32Array(n);
  const glowA = new Float32Array(n);
  const hot = new Float32Array(n);
  const logL = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 6;
    sx[i] = stars[o];
    sy[i] = stars[o + 1];
    sz[i] = stars[o + 2];
    const teff = stars[o + 4];
    const radius = stars[o + 5];
    // Luminosity (Lsun): L = R^2 (Teff/Tsun)^4
    const L = radius * radius * Math.pow(teff / 5772, 4);
    logL[i] = Math.log10(Math.max(1e-4, L));
    const [r, g, b] = spectralRGB(teff);
    color[i] = `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
    hot[i] = teff > 10000 ? Math.min(1, (teff - 10000) / 25000) : 0;
  }

  // Normalize luminosity to [0,1] for size/glow scaling.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (logL[i] < lo) lo = logL[i];
    if (logL[i] > hi) hi = logL[i];
  }
  for (let i = 0; i < n; i++) {
    const b = (logL[i] - lo) / (hi - lo); // 0..1
    core[i] = 0.55 + 1.7 * Math.pow(b, 0.8); // small crisp core
    glow[i] = b > 0.42 ? 2 + 15 * Math.pow(b, 1.7) : 0; // luminous stars get a halo
    glowA[i] = 0.12 + 0.32 * b;
  }

  // draw order: faint first, bright last (on top)
  const order = Int32Array.from(Array.from({ length: n }, (_, i) => i)).sort(
    (a, b) => logL[a] - logL[b],
  );

  // gas motes -> jittered box-centered pc + size ∝ density
  const m = meta.n_gas_points;
  const ng = meta.ngrid;
  const rng = mulberry32(1234);
  const gx = new Float32Array(m);
  const gy = new Float32Array(m);
  const gz = new Float32Array(m);
  const gsize = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const o = i * 4;
    gx[i] = ((gasPoints[o] + rng()) / ng) * box - box / 2;
    gy[i] = ((gasPoints[o + 1] + rng()) / ng) * box - box / 2;
    gz[i] = ((gasPoints[o + 2] + rng()) / ng) * box - box / 2;
    gsize[i] = 0.7 + 1.8 * (gasPoints[o + 3] / 255);
  }

  return { order, sx, sy, sz, color, core, glow, glowA, hot, gx, gy, gz, gsize };
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

  // Flat gas field -> offscreen NGRID image (once).
  const ng = data.meta.ngrid;
  const gasImg = document.createElement("canvas");
  gasImg.width = ng;
  gasImg.height = ng;
  {
    const gctx = gasImg.getContext("2d")!;
    const img = gctx.createImageData(ng, ng);
    const glo = data.meta.gas_log_min;
    const ghi = data.meta.gas_log_max;
    for (let j = 0; j < ng; j++) {
      for (let i = 0; i < ng; i++) {
        const v = (data.gas[j * ng + i] - glo) / (ghi - glo);
        const a = Math.pow(Math.max(0, v), 1.2);
        const p = (j * ng + i) * 4;
        img.data[p] = 55 + 100 * a;
        img.data[p + 1] = 150 + 85 * a;
        img.data[p + 2] = 150 + 75 * a;
        img.data[p + 3] = 255 * a;
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
    scale = (Math.min(w, h) / box) * 0.86;
    cx = w / 2;
    cy = h / 2;
  }

  function star(i: number, px: number, py: number, depth: number): void {
    const col = prep.color[i];
    const g = prep.glow[i] * depth;
    if (g > 1) {
      const gr = ctx!.createRadialGradient(px, py, 0, px, py, g);
      gr.addColorStop(0, `rgba(${col},${prep.glowA[i]})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      ctx!.fillStyle = gr;
      ctx!.beginPath();
      ctx!.arc(px, py, g, 0, Math.PI * 2);
      ctx!.fill();
    }
    // colored core
    ctx!.fillStyle = `rgba(${col},0.95)`;
    ctx!.beginPath();
    ctx!.arc(px, py, prep.core[i] * depth, 0, Math.PI * 2);
    ctx!.fill();
    // hot stars get a tiny white sparkle in the very center
    if (prep.hot[i] > 0.15) {
      ctx!.fillStyle = `rgba(255,255,255,${0.5 * prep.hot[i]})`;
      ctx!.beginPath();
      ctx!.arc(px, py, prep.core[i] * depth * 0.5, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  function drawFlat(): void {
    ctx!.clearRect(0, 0, w, h);
    ctx!.imageSmoothingEnabled = true;
    const gw = box * scale;
    ctx!.globalAlpha = 0.95;
    ctx!.drawImage(gasImg, cx - gw / 2, cy - gw / 2, gw, gw);
    ctx!.globalAlpha = 1;
    ctx!.globalCompositeOperation = "lighter";
    for (let k = 0; k < prep.order.length; k++) {
      const i = prep.order[k];
      star(i, cx + prep.sx[i] * scale, cy + prep.sy[i] * scale, 1);
    }
    ctx!.globalCompositeOperation = "source-over";
  }

  function drawRotate(timeSec: number): void {
    ctx!.clearRect(0, 0, w, h);
    const theta = reduceMotion ? 0.5 : (2 * Math.PI * timeSec) / rotationPeriod;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // gas motes (additive teal, size ∝ density) — a supporting haze, kept low
    // so it never blows out the center or drowns the stars.
    ctx!.globalCompositeOperation = "lighter";
    ctx!.fillStyle = "rgba(80,170,165,0.13)";
    const m = data.meta.n_gas_points;
    for (let i = 0; i < m; i++) {
      const xr = prep.gx[i] * cosT + prep.gz[i] * sinT;
      const s = prep.gsize[i];
      ctx!.fillRect(cx + xr * scale - s / 2, cy + prep.gy[i] * scale - s / 2, s, s);
    }

    // stars, faint -> bright, depth-shaded
    for (let k = 0; k < prep.order.length; k++) {
      const i = prep.order[k];
      const xr = prep.sx[i] * cosT + prep.sz[i] * sinT;
      const zr = -prep.sx[i] * sinT + prep.sz[i] * cosT;
      const depth = 1 + (zr / box) * 0.5; // nearer -> a touch bigger/brighter
      star(i, cx + xr * scale, cy + prep.sy[i] * scale, Math.max(0.55, depth));
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
    if (opts.mode === "flat") drawFlat();
    else drawRotate(start === null ? 0.12 * rotationPeriod : (performance.now() - start) / 1000);
  }

  resize();
  // Always paint one frame immediately so the canvas is never blank.
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
