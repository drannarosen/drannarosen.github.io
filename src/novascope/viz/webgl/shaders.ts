/*
 * shaders.ts — GLSL source for the cluster engine.
 *
 * VOLUME: fullscreen-triangle raymarch of the 3D density texture, emission/
 * absorption with a yt-style log colorbar + homologous gas-expulsion.
 * STARS: 3D points sharing the SAME analytic camera (yaw/pitch/zoom/pan) as the
 * volume so gas and stars stay registered at any view.
 */

export const FULLSCREEN_VS = `#version 300 es
precision highp float;
const vec2 v[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID], 0., 1.); }`;

export const VOLUME_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 outColor;
uniform sampler3D uVol;
uniform vec2 uRes;
uniform float uYaw, uPitch, uEmit, uAbsorb, uZoom, uFloor, uGamma;
uniform float uExpel, uLogRange; // expulsion phase; log10 dynamic range of the cube
uniform float uGasFrac;          // gas mass remaining, as a fraction of the initial
uniform vec2 uPan;               // view pan, in uv (screen-height) units

bool hitBox(vec3 ro, vec3 rd, out float t0, out float t1){
  vec3 inv = 1.0/rd;
  vec3 a=(vec3(-0.5)-ro)*inv, b=(vec3(0.5)-ro)*inv;
  vec3 lo=min(a,b), hi=max(a,b);
  t0=max(max(lo.x,lo.y),lo.z); t1=min(min(hi.x,hi.y),hi.z);
  return t1>max(t0,0.0);
}
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y - uPan;   // pan shifts the view
  vec3 ro = vec3(0.,0.,1.7);
  vec3 rd = normalize(vec3(uv*1.15*uZoom, -1.6));   // uZoom>1 => cube smaller, more frame
  // rotate ray into the (static) volume's model space (yaw about Y, pitch about X)
  mat3 Rinv = rotX(-uPitch)*rotY(-uYaw);
  vec3 rom = Rinv*ro, rdm = Rinv*rd;
  float t0,t1;
  if(!hitBox(rom, rdm, t0, t1)){ outColor=vec4(0.); return; }
  const int STEPS=112;
  float dt=(t1-t0)/float(STEPS);
  float seed=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  float t=t0+dt*seed;
  vec3 acc=vec3(0.); float alpha=0.;
  vec3 deep=vec3(0.09,0.40,0.44), pale=vec3(0.60,0.96,0.92), warm=vec3(0.92,0.66,0.55);
  float S = 1.0 + uExpel*3.5;                           // homologous expansion factor
  float dilute = 3.0*(log(S)/2.302585)/uLogRange;       // 1/S^3 mass loss, in log10 units
  /* Mass-loss at FIXED SHAPE: rho -> uGasFrac*rho everywhere, which in the
     normalized-log encoding is a constant offset of log10(uGasFrac)/uLogRange.
     This is the mode the survival explorable uses, and it is not a stylistic
     choice: its integrator assumes the cloud's radial profile f(<r) is fixed
     while M_gas(t) decays, so the render must show exactly that and not the
     homologous expansion above, which the dynamics does not model. */
  float massDilute = -(log(max(uGasFrac, 1e-4))/2.302585)/uLogRange;
  for(int i=0;i<STEPS;i++){
    vec3 sp = rom + rdm*t + 0.5;                        // view-space texcoord
    // Feedback expels the gas homologously: sample the ORIGINAL cube at a
    // contracted coord so the cloud balloons outward, and dilute density by 1/S^3
    // (a -3*log10(S) shift in log space). Stars don't move -> bare cluster emerges.
    vec3 src = 0.5 + (sp - 0.5)/S;
    float d = texture(uVol, src).r - dilute - massDilute; // normalized log10(rho), diluted
    // yt-style LOG COLORBAR: window to [rho_0, rho_max]. s = (d-uFloor)/(1-uFloor)
    // = log10(rho/rho_0) rescaled 0..1; gas below rho_0 (mean) is transparent.
    // No geometric mask: the EFF profile truncates the density at r_t, so the cloud
    // is physically round and zero out to the box walls — the roundness is real.
    float s = clamp((d - uFloor)/(1.0 - uFloor), 0.0, 1.0);
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

export const STAR_VS = `#version 300 es
precision highp float;
in vec3 aPos;    // pc
in vec3 aColor;  // 0..1
in float aSize;  // sqrt(radius) scale
uniform float uYaw, uPitch, uBox, uPix, uZoom;
uniform float uAspect;   // canvas width/height — the volume normalizes uv by height
uniform float uStarGlow; // shared with the FS (one program uniform); size no longer uses it
uniform vec2 uPan;
out vec3 vColor;
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
void main(){
  vec3 P = rotX(-uPitch)*rotY(-uYaw) * (aPos / uBox);   // same rotation as the volume
  float denom = 1.7 - P.z;
  float clipx = (P.x*1.6/(1.15*uZoom))/denom;   // match the volume's zoom
  float clipy = (P.y*1.6/(1.15*uZoom))/denom;
  // + uPan to match the volume FS (which subtracts uPan from uv); *2 => clip space.
  // x is divided by uAspect because uv spans +-aspect/2 horizontally but clip spans +-1.
  gl_Position = vec4((clipx + uPan.x)*2.0/uAspect, (clipy + uPan.y)*2.0, 0.0, 1.0);
  // The glow halo lives inside the point quad, so it scales with the star and
  // needs no size boost. Floor lifted to 2.5 px so the low-mass haze stays
  // visible now that sizes come from the compressed magnitude law.
  gl_PointSize = clamp(aSize * uPix / (denom*uZoom), 2.5, 44.0);
  vColor = aColor;
}`;

export const STAR_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uStarAlpha;   // 0..1 global star fade (scrollytelling ignition)
uniform float uStarGlow;    // 0 = legacy soft disk, 1 = tight core + luminous halo
out vec4 outColor;
void main(){
  float r = length(gl_PointCoord - 0.5);

  // Legacy look (uStarGlow = 0): a soft disk filling the quad + a hued core.
  float disk = smoothstep(0.5, 0.0, r);
  float coreLegacy = smoothstep(0.30, 0.0, r);
  vec3 base = vColor * (disk + coreLegacy * 0.9) + vec3(coreLegacy*coreLegacy*0.5);

  // Glow look (uStarGlow = 1), matching the canvas cluster art: a TIGHT bright
  // core, a broad Gaussian halo in the star's own hue (additive, so it reads as
  // luminosity), and a white-hot pip at the very centre.
  float halo = exp(-r*r*13.0);
  float core = smoothstep(0.16, 0.0, r);
  float pip  = smoothstep(0.06, 0.0, r);
  // Let the HUED HALO carry the colour (a blue star = a blue glow around a
  // bright core, like the blue stars in a Hubble cluster image). Additive blend
  // clips a bright core to white no matter its hue, so keep the core modest and
  // the halo strong-and-hued; only a tiny white speck at the very centre.
  vec3 glow = vColor * (core*0.55 + halo*0.9 + pip*0.5) + vec3(pip*pip*0.3);

  vec3 c = mix(base, glow, uStarGlow);
  float a = mix(disk, halo, uStarGlow);
  outColor = vec4(c, a) * uStarAlpha;      // additive blend => multiply to fade
}`;
