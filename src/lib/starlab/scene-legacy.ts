/*
 * scene.ts — the star-render comparison lab (internal, Three.js + WebGL2).
 *
 * A testbed for the SOTA-star-rendering ideas: instanced analytic billboards
 * (core + halo + aureole + diffraction), physical blackbody colour through a
 * LUT with a live saturation stretch, magnitude-based sizing, and a selective
 * HDR bloom pass. Every feature is a live uniform/flag so the page can toggle
 * it and compare against our production GL-point look. Loads the REAL gravoturb
 * stars so the comparison is on our own data.
 *
 * Not shipped anywhere public: this is where we decide what earns its way into
 * the production renderer before touching it.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const T_SUN = 5772;
const LOGL_LO = -3.5, LOGL_HI = 6.5;

export interface StarLabFlags {
  aureole: boolean;
  diffraction: boolean;
  bloom: boolean;
  saturation: number;   // 1 = physical blackbody, ~2.4 = Hubble stretch
  bloomThreshold: number;
  bloomStrength: number;
  exposure: number;
  pxMin: number;        // smallest star half-size [px]
  pxMax: number;        // largest star half-size [px]
  sizeGamma: number;    // mode A exponent on magnitude
  sizeMode: number;     // 0 = A (magnitude), 1 = C (photographic)
  photoK: number;       // mode C compression strength
}

export interface StarLab {
  setFlags(f: Partial<StarLabFlags>): void;
  dispose(): void;
  starCount: number;
}

/* ── blackbody colour LUT (raw, unsaturated) — Kim et al. 2002 Planckian locus ── */
function blackbodyLUT(n = 256): THREE.DataTexture {
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const T = 2000 + (48000 * i) / (n - 1); // 2000–50000 K
    const Tc = Math.min(25000, Math.max(1667, T));
    const t = 1 / Tc;
    const x =
      Tc < 4000
        ? -0.2661239e9 * t ** 3 - 0.2343589e6 * t ** 2 + 0.8776956e3 * t + 0.17991
        : -3.0258469e9 * t ** 3 + 2.1070379e6 * t ** 2 + 0.2226347e3 * t + 0.24039;
    const y =
      Tc < 2222
        ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
        : Tc < 4000
          ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
          : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
    const X = x / y, Z = (1 - x - y) / y;
    let r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z);
    let g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z);
    let b = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z);
    const m = Math.max(r, g, b) || 1;
    // store LINEAR colour (the shader works in linear HDR; tone-map at the end)
    data[i * 4] = Math.round((r / m) * 255);
    data[i * 4 + 1] = Math.round((g / m) * 255);
    data[i * 4 + 2] = Math.round((b / m) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const STAR_VERT = /* glsl */ `
precision highp float;
attribute vec2 aCorner;      // quad corner in [-1,1]
attribute vec3 iPos;         // star position [pc]
attribute float iTempT;      // 0..1 LUT coordinate (temperature)
attribute float iBright;     // 0..1 magnitude
uniform vec2 uViewport;      // drawing-buffer size [px]
uniform float uPxMin;        // firm minimum half-size [px] — smallest star stays readable
uniform float uPxMax;        // firm maximum half-size [px] — largest star never dwarfs the field
uniform float uSizeGamma;    // mode A exponent on magnitude
uniform float uSizeMode;     // 0 = A (magnitude), 1 = C (photographic)
uniform float uPhotoK;       // mode C compression strength
varying vec2 vUv;
varying float vTempT;
varying float vBright;        // the star's own normalized magnitude (for the bloom kick)
varying float vDrive;         // the mode-mapped size/brightness driver [0,1]
void main() {
  vUv = aCorner;
  vTempT = iTempT;
  vBright = iBright;
  // Two per-star size laws to compare (NO population rank):
  //   A (magnitude):    driver = magnitude^gamma      — literal, bottom-heavy
  //   C (photographic): driver = log(1+k m)/log(1+k)  — log-compresses each star's
  //                     OWN magnitude, lifting the faint majority into a visible
  //                     band while staying a function of that star alone.
  float driveA = pow(iBright, uSizeGamma);
  float driveC = log(1.0 + uPhotoK * iBright) / log(1.0 + uPhotoK);
  float drive = mix(driveA, driveC, uSizeMode);
  vDrive = drive;
  float halfPx = clamp(uPxMin + (uPxMax - uPxMin) * drive, uPxMin, uPxMax);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(iPos, 1.0);
  clip.xy += aCorner * (halfPx / uViewport) * 2.0 * clip.w; // px -> clip (perspective-safe)
  gl_Position = clip;
}`;

const STAR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLUT;
uniform float uSaturation;
uniform float uAureole;      // 0/1
uniform float uDiffraction;  // 0/1
varying vec2 vUv;
varying float vTempT;
varying float vBright;   // physical magnitude (bloom kick)
varying float vDrive;    // mode-mapped driver (carpet brightness)
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 col = texture2D(uLUT, vec2(vTempT, 0.5)).rgb;
  // live saturation stretch (hue preserved)
  float lum = dot(col, vec3(0.30, 0.59, 0.11));
  col = clamp(mix(vec3(lum), col, uSaturation), 0.0, 1.0);

  // CRISP star: a tight super-Gaussian core is most of the light (like the sharp
  // coloured pinpoints in a real cluster image), with only a small hued halo.
  float core = exp(-pow(r / 0.13, 4.0));
  float halo = exp(-(r*r) / (2.0 * 0.22 * 0.22));
  float aureole = uAureole * pow(1.0 + (r*r) / (0.12*0.12), -2.0) * 0.35;
  // restrained 4-fold diffraction, only on the physically brightest handful
  float ang = atan(vUv.y, vUv.x);
  float spikes = uDiffraction * smoothstep(0.45, 0.75, vBright)
               * pow(max(0.0, abs(cos(2.0*ang))), 8.0) * exp(-r*3.5) * 0.5;

  // Carpet brightness follows the (mode-mapped) driver so the field reads
  // consistently with the size law; the bloom kick keys on the star's PHYSICAL
  // magnitude, so only genuinely luminous stars punch past 1 into bloom
  // regardless of size mode.
  float energy = 0.45 + 0.55 * vDrive + 1.4 * smoothstep(0.5, 0.85, vBright);
  vec3 outc = col * (core*0.95 + halo*0.22 + aureole + spikes)
            + vec3(core*core*core * 0.3); // tiny white-hot pip only at the very centre
  outc *= energy;
  gl_FragColor = vec4(outc, 1.0);
}`;

export async function initStarLabLegacy(canvas: HTMLCanvasElement): Promise<StarLab> {
  const base = "/data/gravoturb";
  const [meta, starBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json() as Promise<Record<string, number>>),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
  ]);
  const stars = new Float32Array(starBuf);
  const n = meta.n_stars;
  const box = (meta.box_pc as number) ?? 6;

  // ── renderer + HDR pipeline ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const resize = () => {
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setSize(w, h);
    const buf = new THREE.Vector2();
    renderer.getDrawingBufferSize(buf);
    uniforms.uViewport.value.set(buf.x, buf.y);
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(0, 0, box * 1.6);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // ── instanced star billboards ──
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
  geo.setAttribute("aCorner", new THREE.BufferAttribute(quad, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const iPos = new Float32Array(n * 3);
  const iTempT = new Float32Array(n);
  // iBright = each star's OWN normalized bolometric magnitude in [0,1] (fixed
  // anchors spanning the IMF). Purely per-star, no population rank: the same
  // physical star is the same size in any cluster. The shader chooses how to map
  // it to a size — mode A (magnitude) or mode C (photographic) — for comparison.
  const iBright = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    iPos[i * 3] = stars[o]!; iPos[i * 3 + 1] = stars[o + 1]!; iPos[i * 3 + 2] = stars[o + 2]!;
    const teff = stars[o + 4]!, R = Math.min(30, Math.max(0.05, stars[o + 5]!));
    const logL = 2 * Math.log10(R) + 4 * Math.log10(teff / T_SUN);
    iBright[i] = Math.min(1, Math.max(0, (logL - LOGL_LO) / (LOGL_HI - LOGL_LO)));
    iTempT[i] = Math.min(1, Math.max(0, (teff - 2000) / 48000));
  }
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute("iTempT", new THREE.InstancedBufferAttribute(iTempT, 1));
  geo.setAttribute("iBright", new THREE.InstancedBufferAttribute(iBright, 1));
  geo.instanceCount = n;

  const uniforms = {
    uLUT: { value: blackbodyLUT() },
    uSaturation: { value: 2.4 },
    uAureole: { value: 1 },
    uDiffraction: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPxMin: { value: 2.0 },
    uPxMax: { value: 10 },
    uSizeGamma: { value: 0.6 }, // mode A exponent
    uSizeMode: { value: 1 },    // start on C (photographic)
    uPhotoK: { value: 60 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // ── composer: render + selective bloom ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.6, 1.5);
  composer.addPass(bloom);
  let bloomOn = true;

  resize();
  window.addEventListener("resize", resize, { passive: true });

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    controls.update();
    if (bloomOn) composer.render();
    else renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    starCount: n,
    setFlags(f) {
      if (f.aureole !== undefined) uniforms.uAureole.value = f.aureole ? 1 : 0;
      if (f.diffraction !== undefined) uniforms.uDiffraction.value = f.diffraction ? 1 : 0;
      if (f.saturation !== undefined) uniforms.uSaturation.value = f.saturation;
      if (f.bloom !== undefined) bloomOn = f.bloom;
      if (f.bloomThreshold !== undefined) bloom.threshold = f.bloomThreshold;
      if (f.bloomStrength !== undefined) bloom.strength = f.bloomStrength;
      if (f.exposure !== undefined) renderer.toneMappingExposure = f.exposure;
      if (f.pxMin !== undefined) uniforms.uPxMin.value = f.pxMin;
      if (f.pxMax !== undefined) uniforms.uPxMax.value = f.pxMax;
      if (f.sizeGamma !== undefined) uniforms.uSizeGamma.value = f.sizeGamma;
      if (f.sizeMode !== undefined) uniforms.uSizeMode.value = f.sizeMode;
      if (f.photoK !== undefined) uniforms.uPhotoK.value = f.photoK;
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      geo.dispose();
      mat.dispose();
      uniforms.uLUT.value.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
