/*
 * volumeRenderer.ts — WebGL2 raymarch of Anna's real gravoturb density cube.
 *
 * Uploads the 128^3 uint8 density volume (from export_cluster.py) as a 3D
 * texture and ray-marches it in a fragment shader: a genuine rotating 3D
 * turbulent nebula, trilinearly smoothed, with the density gradient visible
 * from every angle. Emission is a restrained teal; absorption gives depth.
 *
 * Lifecycle mirrors the canvas renderers: DPR cap, resize, reduced-motion,
 * pause when hidden/offscreen, cleanup(). Fails gracefully without WebGL2.
 */

export interface VolumeData {
  data: Uint8Array; // ngrid^3, C-order (i,j,k)
  ngrid: number;
}

export async function loadVolume(base = "/data/gravoturb"): Promise<VolumeData> {
  const [meta, buf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/volume.u8`).then((r) => r.arrayBuffer()),
  ]);
  return { data: new Uint8Array(buf), ngrid: meta.volume_ngrid };
}

const VERT = `#version 300 es
precision highp float;
const vec2 verts[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 outColor;

uniform sampler3D uVol;
uniform vec2 uRes;
uniform float uAngle;   // rotation about Y
uniform float uEmit;    // emission strength
uniform float uAbsorb;  // absorption strength

// ray-box intersection for the unit cube centered at origin, half-size 0.5
bool hitBox(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (vec3(-0.5) - ro) * inv;
  vec3 b = (vec3( 0.5) - ro) * inv;
  vec3 tmin = min(a, b), tmax = max(a, b);
  t0 = max(max(tmin.x, tmin.y), tmin.z);
  t1 = min(min(tmax.x, tmax.y), tmax.z);
  return t1 > max(t0, 0.0);
}

mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; // aspect-correct, y up
  // simple perspective camera looking down -z at the cube
  vec3 ro = vec3(0.0, 0.0, 1.7);
  vec3 rd = normalize(vec3(uv * 1.15, -1.6));
  mat3 R = rotY(uAngle);

  float t0, t1;
  if (!hitBox(ro, rd, t0, t1)) { outColor = vec4(0.0); return; }

  const int STEPS = 96;
  float dt = (t1 - t0) / float(STEPS);
  // dither the start to kill slice banding
  float seed = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
  float t = t0 + dt * seed;

  vec3 teal = vec3(0.32, 0.86, 0.80);
  vec3 accum = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;              // world point in the cube
    vec3 sp = R * p + 0.5;            // rotate, then to [0,1] texcoords
    float d = texture(uVol, sp).r;    // density 0..1
    float dd = pow(d, 2.4);           // contrast: reveal filaments
    float a = 1.0 - exp(-dd * uAbsorb * dt);   // per-step opacity (Beer-Lambert)
    vec3 c = teal * dd * uEmit;                 // teal emission ∝ density
    accum += (1.0 - alpha) * a * c;             // front-to-back compositing
    alpha += (1.0 - alpha) * a;
    if (alpha > 0.99) break;
    t += dt;
  }
  outColor = vec4(accum, alpha);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("shader compile:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export interface VolumeOptions {
  rotationPeriodSec?: number;
  reducedMotion?: boolean;
}

const MAX_DPR = 1.5;

export function initVolume(
  canvas: HTMLCanvasElement,
  vol: VolumeData,
  opts: VolumeOptions = {},
): () => void {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
  if (!gl) {
    console.warn("WebGL2 unavailable — volume not rendered");
    return () => {};
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return () => {};
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("link:", gl.getProgramInfoLog(prog));
    return () => {};
  }
  gl.useProgram(prog);

  // upload the density cube as a 3D texture (R8, trilinear)
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const N = vol.ngrid;
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, vol.data);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uAngle = gl.getUniformLocation(prog, "uAngle");
  const uEmit = gl.getUniformLocation(prog, "uEmit");
  const uAbsorb = gl.getUniformLocation(prog, "uAbsorb");
  gl.uniform1i(gl.getUniformLocation(prog, "uVol"), 0);
  gl.uniform1f(uEmit, 1.6);
  gl.uniform1f(uAbsorb, 14.0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied over the page

  const rotationPeriod = opts.rotationPeriodSec ?? 150;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = opts.reducedMotion ?? motionQuery.matches;

  let dpr = 1;
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(uRes, canvas.width, canvas.height);
  }

  function draw(angle: number): void {
    gl!.uniform1f(uAngle, angle);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  /* ── lifecycle ─────────────────────────────────────────────────── */
  let raf = 0;
  let running = false;
  let onScreen = true;
  let startT: number | null = null;

  function frame(now: number): void {
    if (startT === null) startT = now;
    draw((2 * Math.PI * (now - startT)) / 1000 / rotationPeriod);
    if (reduceMotion) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }
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
    if (!running) draw(reduceMotion ? 0.6 : startT === null ? 0.6 : (performance.now() - startT) / 1000 / rotationPeriod * 2 * Math.PI);
  }

  resize();
  draw(0.6); // initial static frame (never blank)
  io.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  play();

  return function cleanup(): void {
    stop();
    io.disconnect();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    gl!.deleteTexture(tex);
    gl!.deleteProgram(prog);
  };
}
