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
  for(int i=0;i<STEPS;i++){
    vec3 sp = rom + rdm*t + 0.5;                        // view-space texcoord
    // Feedback expels the gas homologously: sample the ORIGINAL cube at a
    // contracted coord so the cloud balloons outward, and dilute density by 1/S^3
    // (a -3*log10(S) shift in log space). Stars don't move -> bare cluster emerges.
    vec3 src = 0.5 + (sp - 0.5)/S;
    float d = texture(uVol, src).r - dilute;            // normalized log10(rho), diluted
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
  gl_Position = vec4((clipx + uPan.x)*2.0, (clipy + uPan.y)*2.0, 0.0, 1.0);
  gl_PointSize = clamp(aSize * uPix / (denom*uZoom), 1.8, 44.0);
  vColor = aColor;
}`;

export const STAR_FS = `#version 300 es
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
