/*
 * volumeRenderer.ts — WebGL2 raymarch of Anna's real gravoturb density cube,
 * with the cluster stars rendered as 3D points inside it.
 *
 * The volume is uploaded as a 3D texture (uint8, visually lossless for a
 * color-mapped field) and ray-marched with emission/absorption. Stars share the
 * SAME analytic camera + rotation so they sit correctly inside the gas.
 *
 * Lifecycle: DPR cap, resize, reduced-motion, pause when hidden/offscreen,
 * initial static frame, cleanup(). Fails gracefully without WebGL2.
 */

export interface Scene {
  volume: Uint8Array; // ngrid^3, C-order
  ngrid: number;
  stars: Float32Array; // n*6: x,y,z,mass,teff,radius (pc, Msun, K, Rsun)
  box: number; // pc
  // Normalized position (0..1) of the reference density rho_0 in the texture's
  // log range: floor01 = (log10(rho_0) - logMin) / (logMax - logMin). rho_0 is
  // the volume-weighted mean, so the shader's log colorbar spans [mean, max].
  densityFloor: number;
}

export async function loadScene(base = "/data/gravoturb"): Promise<Scene> {
  const [meta, volBuf, starBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/volume.u8`).then((r) => r.arrayBuffer()),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
  ]);
  const lo = meta.volume_log_min, hi = meta.volume_log_max;
  const mean = meta.volume_log_mean ?? lo; // rho_0 = volume-weighted mean density
  const densityFloor = hi > lo ? (mean - lo) / (hi - lo) : 0;
  return {
    volume: new Uint8Array(volBuf),
    ngrid: meta.volume_ngrid,
    stars: new Float32Array(starBuf),
    box: meta.box_pc,
    densityFloor,
  };
}

/* Anna's spectral palette, interpolated in log-Teff (matches clusterArt). */
const SPEC_LOGT = [2980, 4386, 5586, 6708, 8660, 17320, 40620].map(Math.log10);
const SPEC_RGB: [number, number, number][] = [
  [194, 74, 40], [232, 121, 31], [243, 201, 90], [247, 243, 226],
  [205, 217, 255], [154, 184, 255], [129, 114, 255],
];
function spectralRGB(teff: number): [number, number, number] {
  const t = Math.log10(Math.min(55000, Math.max(2400, teff)));
  if (t <= SPEC_LOGT[0]) return SPEC_RGB[0];
  const last = SPEC_LOGT.length - 1;
  if (t >= SPEC_LOGT[last]) return SPEC_RGB[last];
  let i = 0;
  while (i < last && t > SPEC_LOGT[i + 1]) i++;
  const f = (t - SPEC_LOGT[i]) / (SPEC_LOGT[i + 1] - SPEC_LOGT[i]);
  const a = SPEC_RGB[i], b = SPEC_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/* ── shaders ─────────────────────────────────────────────────────── */
const FULLSCREEN_VS = `#version 300 es
precision highp float;
const vec2 v[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID], 0., 1.); }`;

const VOLUME_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 outColor;
uniform sampler3D uVol;
uniform vec2 uRes;
uniform float uAngle, uEmit, uAbsorb, uZoom, uFloor, uGamma;

bool hitBox(vec3 ro, vec3 rd, out float t0, out float t1){
  vec3 inv = 1.0/rd;
  vec3 a=(vec3(-0.5)-ro)*inv, b=(vec3(0.5)-ro)*inv;
  vec3 lo=min(a,b), hi=max(a,b);
  t0=max(max(lo.x,lo.y),lo.z); t1=min(min(hi.x,hi.y),hi.z);
  return t1>max(t0,0.0);
}
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y;
  vec3 ro = vec3(0.,0.,1.7);
  vec3 rd = normalize(vec3(uv*1.15*uZoom, -1.6));   // uZoom>1 => cube smaller, more frame
  // rotate ray into the (static) volume's model space
  mat3 Rinv = rotY(-uAngle);
  vec3 rom = Rinv*ro, rdm = Rinv*rd;
  float t0,t1;
  if(!hitBox(rom, rdm, t0, t1)){ outColor=vec4(0.); return; }
  const int STEPS=112;
  float dt=(t1-t0)/float(STEPS);
  float seed=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  float t=t0+dt*seed;
  vec3 acc=vec3(0.); float alpha=0.;
  vec3 deep=vec3(0.09,0.40,0.44), pale=vec3(0.60,0.96,0.92), warm=vec3(0.92,0.66,0.55);
  for(int i=0;i<STEPS;i++){
    vec3 sp = rom + rdm*t + 0.5;
    float d = texture(uVol, sp).r;                      // normalized log10(rho)
    // yt-style LOG COLORBAR: window to [rho_0, rho_max]. d is already normalized
    // log10(rho), so s = (d-uFloor)/(1-uFloor) = log10(rho/rho_0) rescaled 0..1;
    // gas below rho_0 (the mean density) is transparent -> the diffuse envelope
    // clears, the cube rounds off, and the full ramp maps the overdense gas.
    float s = clamp((d - uFloor)/(1.0 - uFloor), 0.0, 1.0);
    // Spherical mask: the turbulent field fills the CUBIC computational box and its
    // dense filaments get truncated flat at the walls (reads as a cube). Fade to
    // zero beyond the inscribed sphere so we show the cloud's spherical extent.
    float rr = length(sp - 0.5) * 2.0;                  // 1.0 at a face center
    s *= 1.0 - smoothstep(0.80, 1.02, rr);
    float sg = pow(s, uGamma);                          // uGamma=1 => faithful log
    float a = 1.0 - exp(-sg*uAbsorb*dt);
    vec3 base = mix(deep, pale, pow(s, 0.7));           // colormap follows log density
    base = mix(base, warm, smoothstep(0.72, 1.0, s)*0.5); // warm star-forming heart
    vec3 col = base * sg * uEmit;
    acc += (1.0-alpha)*a*col;
    alpha += (1.0-alpha)*a;
    if(alpha>0.99) break;
    t += dt;
  }
  outColor = vec4(acc, alpha);
}`;

const STAR_VS = `#version 300 es
precision highp float;
in vec3 aPos;    // pc
in vec3 aColor;  // 0..1
in float aSize;  // sqrt(radius) scale
uniform float uAngle, uBox, uPix, uZoom;
out vec3 vColor;
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
void main(){
  vec3 P = rotY(-uAngle) * (aPos / uBox);   // normalized, rotated to world
  float denom = 1.7 - P.z;
  float clipx = (P.x*1.6/(1.15*uZoom))/denom;   // match the volume's zoom
  float clipy = (P.y*1.6/(1.15*uZoom))/denom;
  gl_Position = vec4(clipx*2.0, clipy*2.0, 0.0, 1.0);
  gl_PointSize = clamp(aSize * uPix / (denom*uZoom), 1.8, 44.0);
  vColor = aColor;
}`;

const STAR_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main(){
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);       // soft round point
  float core = smoothstep(0.30, 0.0, r);   // bright center
  vec3 c = vColor * (a + core * 0.9);      // brighten center IN the star's hue
  c += vec3(core*core*0.5);                // small white-hot pip only at the very center
  outColor = vec4(c, a);
}`;

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

export interface VolumeOptions {
  rotationPeriodSec?: number;
  reducedMotion?: boolean;
}
const MAX_DPR = 1.5;

export function initScene(canvas: HTMLCanvasElement, scene: Scene, opts: VolumeOptions = {}): () => void {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
  if (!gl) {
    console.warn("WebGL2 unavailable");
    return () => {};
  }

  const volProg = program(gl, FULLSCREEN_VS, VOLUME_FS);
  const starProg = program(gl, STAR_VS, STAR_FS);
  if (!volProg || !starProg) return () => {};

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

  // star buffer: interleaved [x,y,z, r,g,b, size]
  const n = scene.stars.length / 6;
  const sbuf = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const teff = scene.stars[o + 4];
    const radius = scene.stars[o + 5];
    const [r, g, b] = spectralRGB(teff);
    const q = i * 7;
    sbuf[q] = scene.stars[o];
    sbuf[q + 1] = scene.stars[o + 1];
    sbuf[q + 2] = scene.stars[o + 2];
    sbuf[q + 3] = r / 255;
    sbuf[q + 4] = g / 255;
    sbuf[q + 5] = b / 255;
    // Two-regime size law, continuous at 1 Rsun: giants ∝ sqrt(r); dwarfs
    // (< 1 Rsun) ∝ r^0.18 so they shrink gently and stay visible.
    const rc = Math.min(30, Math.max(0.05, radius));
    sbuf[q + 6] = rc >= 1 ? Math.sqrt(rc) : Math.pow(rc, 0.18);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, sbuf, gl.STATIC_DRAW);
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

  // uniforms
  const uRes = gl.getUniformLocation(volProg, "uRes");
  const uVAngle = gl.getUniformLocation(volProg, "uAngle");
  gl.useProgram(volProg);
  gl.uniform1i(gl.getUniformLocation(volProg, "uVol"), 0);
  gl.uniform1f(gl.getUniformLocation(volProg, "uEmit"), 9.5);
  gl.uniform1f(gl.getUniformLocation(volProg, "uAbsorb"), 9.0);
  gl.uniform1f(gl.getUniformLocation(volProg, "uZoom"), 1.55);
  // Log colorbar: rho_0 = mean density (from meta), gamma=1 => faithful log stretch.
  gl.uniform1f(gl.getUniformLocation(volProg, "uFloor"), scene.densityFloor);
  gl.uniform1f(gl.getUniformLocation(volProg, "uGamma"), 1.1);
  const uSAngle = gl.getUniformLocation(starProg, "uAngle");
  const uSBox = gl.getUniformLocation(starProg, "uBox");
  const uSPix = gl.getUniformLocation(starProg, "uPix");
  gl.useProgram(starProg);
  gl.uniform1f(uSBox, scene.box);
  gl.uniform1f(gl.getUniformLocation(starProg, "uZoom"), 1.55);

  const rotationPeriod = opts.rotationPeriodSec ?? 110;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = opts.reducedMotion ?? motionQuery.matches;

  let dpr = 1;
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(angle: number): void {
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.enable(gl!.BLEND);
    // volume: premultiplied "over"
    gl!.useProgram(volProg);
    gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.uniform2f(uRes, canvas.width, canvas.height);
    gl!.uniform1f(uVAngle, angle);
    gl!.bindTexture(gl!.TEXTURE_3D, tex);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    // stars: additive, on top
    gl!.useProgram(starProg);
    gl!.blendFunc(gl!.ONE, gl!.ONE);
    gl!.uniform1f(uSAngle, angle);
    gl!.uniform1f(uSPix, canvas.height * 0.018);
    gl!.bindVertexArray(vao);
    gl!.drawArrays(gl!.POINTS, 0, n);
    gl!.bindVertexArray(null);
  }

  /* ── lifecycle ─────────────────────────────────────────────────── */
  let raf = 0, running = false, onScreen = true, startT: number | null = null;
  function frame(now: number): void {
    if (startT === null) startT = now;
    draw((2 * Math.PI * (now - startT)) / 1000 / rotationPeriod);
    if (reduceMotion) { running = false; return; }
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
  const io = new IntersectionObserver((e) => {
    onScreen = e[0]?.isIntersecting ?? true;
    if (onScreen) play(); else stop();
  }, { threshold: 0 });
  function onVisibility(): void { if (document.hidden) stop(); else play(); }
  function onResize(): void { resize(); if (!running) draw(0.6); }

  resize();
  draw(0.6);
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
    gl!.deleteProgram(volProg);
    gl!.deleteProgram(starProg);
  };
}
