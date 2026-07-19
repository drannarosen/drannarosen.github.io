/*
 * engine.ts — WebGL2 cluster renderer: raymarched density volume + 3D stars.
 *
 * createEngine() owns the GL programs, the render loop, and all display + view
 * state. It exposes a small imperative API (ClusterEngine): set display uniforms,
 * drive the view, swap the star set, redraw, clean up. Pointer interaction lives
 * separately in interaction.ts and drives the engine through setView().
 *
 * Lifecycle: DPR cap, resize, prefers-reduced-motion, pause when hidden/offscreen,
 * initial static frame, cleanup(). Fails gracefully (no-op engine) without WebGL2.
 */

import { FULLSCREEN_VS, VOLUME_FS, STAR_VS, STAR_FS } from "./shaders";
import { spectralRGB } from "./spectral";
import type { Scene, View } from "./scene";

export const DEFAULT_ZOOM = 1.0; // <1 fills more of the frame; user can zoom in/out
export const ZOOM_MIN = 0.35, ZOOM_MAX = 4.0;
const MAX_DPR = 1.5;
const DEFAULT_YAW = 0.6;

export interface EngineOptions {
  rotationPeriodSec?: number;
  reducedMotion?: boolean;
  /** Run the auto gas-expulsion breathing loop (default false = stable embedded cloud). */
  autoExpel?: boolean;
  /** Enlarge hot O/B stars so massive-star structure (e.g. segregation) reads clearly. */
  emphasizeHot?: boolean;
  /** Seconds for one full expulsion loop (embedded → expel → bare → re-form). */
  expelPeriodSec?: number;
}

export interface ClusterEngine {
  setEmit(v: number): void;
  setAbsorb(v: number): void;
  setFloor(v: number): void;
  setGamma(v: number): void;
  /** [0,1] scrubs the gas expulsion; null resumes the auto timeline. */
  setExpel(v: number | null): void;
  /** [0,1] global star opacity (scrollytelling ignition). */
  setStarAlpha(a: number): void;
  /** Replace the star set (n*6: x,y,z,mass,teff,radius) — e.g. mass re-pairing. */
  setStars(stars: Float32Array): void;
  setView(v: Partial<View>): void;
  getView(): View;
  resetView(): void;
  redraw(): void;
  cleanup(): void;
  meta: { floors: { median: number; mean: number }; box: number; ngrid: number };
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("shader:", gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

/** Interleave stars (n*6) into the GPU buffer layout [x,y,z, r,g,b, size] (n*7). */
function buildStarBuffer(stars: Float32Array, emphasizeHot = false): Float32Array {
  const n = stars.length / 6;
  const sbuf = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const o = i * 6, q = i * 7;
    const teff = stars[o + 4];
    const [r, g, b] = spectralRGB(teff);
    sbuf[q] = stars[o];
    sbuf[q + 1] = stars[o + 1];
    sbuf[q + 2] = stars[o + 2];
    sbuf[q + 3] = r / 255;
    sbuf[q + 4] = g / 255;
    sbuf[q + 5] = b / 255;
    // Two-regime size law, continuous at 1 Rsun: giants ∝ sqrt(r); dwarfs
    // (< 1 Rsun) ∝ r^0.18 so they shrink gently and stay visible.
    const rc = Math.min(30, Math.max(0.05, stars[o + 5]));
    let sz = rc >= 1 ? Math.sqrt(rc) : Math.pow(rc, 0.18);
    // Emphasize hot massive stars so O/B structure (segregation) pops.
    if (emphasizeHot) sz *= teff > 30000 ? 2.4 : teff > 10000 ? 1.7 : 1;
    sbuf[q + 6] = sz;
  }
  return sbuf;
}

function noopEngine(scene: Scene): ClusterEngine {
  return {
    setEmit() {}, setAbsorb() {}, setFloor() {}, setGamma() {}, setExpel() {}, setStarAlpha() {},
    setStars() {}, setView() {}, getView: () => ({ yaw: DEFAULT_YAW, pitch: 0, zoom: DEFAULT_ZOOM, panX: 0, panY: 0, spin: false }),
    resetView() {}, redraw() {}, cleanup() {},
    meta: { floors: { median: scene.floorMedian, mean: scene.floorMean }, box: scene.box, ngrid: scene.ngrid },
  };
}

export function createEngine(canvas: HTMLCanvasElement, scene: Scene, opts: EngineOptions = {}): ClusterEngine {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
  if (!gl) {
    console.warn("WebGL2 unavailable");
    return noopEngine(scene);
  }
  const volProg = program(gl, FULLSCREEN_VS, VOLUME_FS);
  const starProg = program(gl, STAR_VS, STAR_FS);
  if (!volProg || !starProg) return noopEngine(scene);

  // 3D density texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const N = scene.ngrid;
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, scene.volume);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  // star buffer
  const emphasizeHot = opts.emphasizeHot ?? false;
  let n = scene.stars.length / 6;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buildStarBuffer(scene.stars, emphasizeHot), gl.DYNAMIC_DRAW);
  const stride = 7 * 4;
  const aPos = gl.getAttribLocation(starProg, "aPos");
  const aColor = gl.getAttribLocation(starProg, "aColor");
  const aSize = gl.getAttribLocation(starProg, "aSize");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aColor);
  gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(aSize);
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 24);
  gl.bindVertexArray(null);

  // uniform locations
  const uRes = gl.getUniformLocation(volProg, "uRes");
  const uVYaw = gl.getUniformLocation(volProg, "uYaw");
  const uVPitch = gl.getUniformLocation(volProg, "uPitch");
  const uVExpel = gl.getUniformLocation(volProg, "uExpel");
  const uEmitL = gl.getUniformLocation(volProg, "uEmit");
  const uFloorL = gl.getUniformLocation(volProg, "uFloor");
  const uGammaL = gl.getUniformLocation(volProg, "uGamma");
  const uAbsorbL = gl.getUniformLocation(volProg, "uAbsorb");
  const uZoomVol = gl.getUniformLocation(volProg, "uZoom");
  const uPanVol = gl.getUniformLocation(volProg, "uPan");
  gl.useProgram(volProg);
  gl.uniform1i(gl.getUniformLocation(volProg, "uVol"), 0);
  gl.uniform1f(uEmitL, 9.5);
  gl.uniform1f(uAbsorbL, 9.0);
  gl.uniform1f(uFloorL, scene.densityFloor);
  gl.uniform1f(uGammaL, 1.1);
  gl.uniform1f(gl.getUniformLocation(volProg, "uLogRange"), scene.logRange);

  const uSYaw = gl.getUniformLocation(starProg, "uYaw");
  const uSPitch = gl.getUniformLocation(starProg, "uPitch");
  const uSPix = gl.getUniformLocation(starProg, "uPix");
  const uZoomStar = gl.getUniformLocation(starProg, "uZoom");
  const uPanStar = gl.getUniformLocation(starProg, "uPan");
  const uStarAlpha = gl.getUniformLocation(starProg, "uStarAlpha");
  const uSAspect = gl.getUniformLocation(starProg, "uAspect");
  gl.useProgram(starProg);
  gl.uniform1f(gl.getUniformLocation(starProg, "uBox"), scene.box);
  gl.uniform1f(uStarAlpha, 1.0);

  // ── view state (camera), shared with interaction.ts via setView/getView ──
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduceMotion = opts.reducedMotion ?? motionQuery.matches;
  const view: View = {
    yaw: DEFAULT_YAW, pitch: 0, zoom: DEFAULT_ZOOM, panX: 0, panY: 0, spin: !reduceMotion,
  };
  /* uv is normalized by HEIGHT, so a portrait viewport has a narrow horizontal
     field of view and crops the cluster. Widen the view by 1/aspect on portrait
     so the whole cluster fits. Applied per-draw since it depends on canvas size. */
  function fitScale(): number {
    const a = canvas.height > 0 ? canvas.width / canvas.height : 1;
    // Capped: full 1/aspect compensation on a phone (~2.2x) fits the width exactly
    // but leaves the cluster tiny in a tall frame. 1.7 keeps it large and mostly
    // uncropped — a deliberate compromise, not an exact fit.
    return a < 1 ? Math.min(1.7, 1 / a) : 1;
  }
  /* Pan only — zoom is aspect-dependent and set per-draw. */
  function applyView(): void {
    gl!.useProgram(volProg);
    gl!.uniform2f(uPanVol, view.panX, view.panY);
    gl!.useProgram(starProg);
    gl!.uniform2f(uPanStar, view.panX, view.panY);
  }
  applyView();

  // ── gas-expulsion timeline ──
  const rotationPeriod = opts.rotationPeriodSec ?? 110;
  const expelPeriod = opts.expelPeriodSec ?? 34;
  function expelAt(tSec: number): number {
    const p = (tSec / expelPeriod) % 1;
    if (p < 0.45) return 0;
    if (p < 0.70) { const u = (p - 0.45) / 0.25; return u * u * (3 - 2 * u); }
    if (p < 0.80) return 1;
    const u = (p - 0.80) / 0.20; return 1 - u * u * (3 - 2 * u);
  }
  const autoExpel = opts.autoExpel ?? false;
  let expelOverride: number | null = null;
  function currentExpel(elapsed: number): number {
    if (expelOverride !== null) return expelOverride;
    return autoExpel && !reduceMotion ? expelAt(elapsed) : 0;
  }

  let dpr = 1;
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(expel: number): void {
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.enable(gl!.BLEND);
    gl!.useProgram(volProg);
    gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    const zf = view.zoom * fitScale();
    gl!.uniform2f(uRes, canvas.width, canvas.height);
    gl!.uniform1f(uZoomVol, zf);
    gl!.uniform1f(uVYaw, view.yaw);
    gl!.uniform1f(uVPitch, view.pitch);
    gl!.uniform1f(uVExpel, expel);
    gl!.bindTexture(gl!.TEXTURE_3D, tex);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.useProgram(starProg);
    gl!.blendFunc(gl!.ONE, gl!.ONE);
    gl!.uniform1f(uSYaw, view.yaw);
    gl!.uniform1f(uSPitch, view.pitch);
    gl!.uniform1f(uZoomStar, zf); // same aspect-fitted zoom as the volume
    gl!.uniform1f(uSAspect, canvas.height > 0 ? canvas.width / canvas.height : 1);
    gl!.uniform1f(uSPix, canvas.height * 0.018);
    gl!.bindVertexArray(vao);
    gl!.drawArrays(gl!.POINTS, 0, n);
    gl!.bindVertexArray(null);
  }

  // ── render loop / lifecycle ──
  let raf = 0, running = false, onScreen = true, startT: number | null = null, lastNow: number | null = null;
  function frame(now: number): void {
    if (startT === null) startT = now;
    const elapsed = (now - startT) / 1000;
    if (lastNow !== null && view.spin) {
      view.yaw += ((2 * Math.PI) / rotationPeriod) * ((now - lastNow) / 1000);
    }
    lastNow = now;
    draw(currentExpel(elapsed));
    if (reduceMotion) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  function redraw(): void { draw(expelOverride ?? 0); }
  function play(): void {
    if (running || document.hidden || !onScreen) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  const io = new IntersectionObserver((e) => {
    onScreen = e[0]?.isIntersecting ?? true;
    if (onScreen) play(); else stop();
  }, { threshold: 0 });
  function onVisibility(): void { if (document.hidden) stop(); else play(); }
  function onResize(): void { resize(); if (!running) redraw(); }

  resize();
  redraw();
  io.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  play();

  function setUniform(loc: WebGLUniformLocation | null, v: number): void {
    gl!.useProgram(volProg);
    gl!.uniform1f(loc, v);
    if (!running) redraw();
  }

  return {
    setEmit: (v) => setUniform(uEmitL, v),
    setAbsorb: (v) => setUniform(uAbsorbL, v),
    setFloor: (v) => setUniform(uFloorL, v),
    setGamma: (v) => setUniform(uGammaL, v),
    setExpel: (v) => { expelOverride = v; if (!running) redraw(); },
    setStarAlpha: (a) => {
      gl!.useProgram(starProg);
      gl!.uniform1f(uStarAlpha, Math.min(1, Math.max(0, a)));
      if (!running) redraw();
    },
    setStars: (stars) => {
      n = stars.length / 6;
      gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo);
      gl!.bufferData(gl!.ARRAY_BUFFER, buildStarBuffer(stars, emphasizeHot), gl!.DYNAMIC_DRAW);
      if (!running) redraw();
    },
    setView: (v) => {
      Object.assign(view, v);
      view.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom));
      view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch));
      applyView();
      if (!running) redraw();
    },
    getView: () => ({ ...view }),
    resetView: () => {
      Object.assign(view, { yaw: DEFAULT_YAW, pitch: 0, zoom: DEFAULT_ZOOM, panX: 0, panY: 0, spin: !reduceMotion });
      lastNow = null;
      applyView();
      if (!running) redraw();
    },
    redraw,
    cleanup(): void {
      stop();
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      gl!.deleteTexture(tex);
      gl!.deleteProgram(volProg);
      gl!.deleteProgram(starProg);
    },
    meta: { floors: { median: scene.floorMedian, mean: scene.floorMean }, box: scene.box, ngrid: scene.ngrid },
  };
}
