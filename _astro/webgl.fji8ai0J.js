import{p as e}from"./constants.Cma6CoSJ.js";import{t}from"./spectral.B0A_OwXs.js";import"./dynamics.BCJ1C3GJ.js";var n={eyeZ:1.7,focal:1.6,fovScale:1.15};function r(e){if(!Number.isFinite(e))throw Error(`glslFloat: ${e} is not a finite number`);let t=String(e);return t.includes(`.`)||t.includes(`e`)?t:`${t}.0`}var i=r(n.eyeZ),a=r(n.focal),o=r(n.fovScale),s=`#version 300 es
precision highp float;
const vec2 v[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID], 0., 1.); }`,c=`#version 300 es
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
  vec3 ro = vec3(0.,0.,${i});
  vec3 rd = normalize(vec3(uv*${o}*uZoom, -${a}));   // uZoom>1 => cube smaller, more frame
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
}`,l=`#version 300 es
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
  float denom = ${i} - P.z;
  float clipx = (P.x*${a}/(${o}*uZoom))/denom;   // match the volume's zoom
  float clipy = (P.y*${a}/(${o}*uZoom))/denom;
  // + uPan to match the volume FS (which subtracts uPan from uv); *2 => clip space.
  // x is divided by uAspect because uv spans +-aspect/2 horizontally but clip spans +-1.
  gl_Position = vec4((clipx + uPan.x)*2.0/uAspect, (clipy + uPan.y)*2.0, 0.0, 1.0);
  // The glow halo lives inside the point quad, so it scales with the star and
  // needs no size boost. Floor lifted to 2.5 px so the low-mass haze stays
  // visible now that sizes come from the compressed magnitude law.
  gl_PointSize = clamp(aSize * uPix / (denom*uZoom), 2.5, 44.0);
  vColor = aColor;
}`,u=`#version 300 es
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
}`,d=.35,f=1.5,p=.6;function m(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(console.error(`shader:`,e.getShaderInfoLog(r)),null)}function h(e,t,n){let r=m(e,e.VERTEX_SHADER,t),i=m(e,e.FRAGMENT_SHADER,n);if(!r||!i)return null;let a=e.createProgram();return e.attachShader(a,r),e.attachShader(a,i),e.linkProgram(a),e.getProgramParameter(a,e.LINK_STATUS)?a:(console.error(`link:`,e.getProgramInfoLog(a)),null)}var g=e,_=-3.5,v=6.5;function y(e,n=!1){let r=e.length/6,i=new Float32Array(r*7);for(let a=0;a<r;a++){let r=a*6,o=a*7,s=e[r+4],[c,l,u]=t(s);i[o]=e[r],i[o+1]=e[r+1],i[o+2]=e[r+2],i[o+3]=c/255,i[o+4]=l/255,i[o+5]=u/255;let d=Math.min(30,Math.max(.05,e[r+5])),f=2*Math.log10(d)+4*Math.log10(s/g),p=1+3*Math.min(1,Math.max(0,(f-_)/(v-_)));n&&(p*=s>3e4?1.15:1),i[o+6]=p}return i}function b(e){return{setEmit(){},setAbsorb(){},setFloor(){},setGamma(){},setExpel(){},setStarAlpha(){},setStars(){},setStarPositions(){},setGasFraction(){},setView(){},getView:()=>({yaw:p,pitch:0,zoom:1,panX:0,panY:0,spin:!1}),resetView(){},redraw(){},cleanup(){},reducedMotion:!1,meta:{floors:{median:e.floorMedian,mean:e.floorMean},box:e.box,ngrid:e.ngrid}}}function x(e,t,n={}){let r=e.getContext(`webgl2`,{alpha:!0,premultipliedAlpha:!0});if(!r)return console.warn(`WebGL2 unavailable`),b(t);let i=h(r,s,c),a=h(r,l,u);if(!i||!a)return b(t);let o=r.createTexture();r.bindTexture(r.TEXTURE_3D,o),r.pixelStorei(r.UNPACK_ALIGNMENT,1);let m=t.ngrid;r.texImage3D(r.TEXTURE_3D,0,r.R8,m,m,m,0,r.RED,r.UNSIGNED_BYTE,t.volume),r.texParameteri(r.TEXTURE_3D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_3D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_3D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_3D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_3D,r.TEXTURE_WRAP_R,r.CLAMP_TO_EDGE);let g=n.emphasizeHot??!1,_=t.stars.length/6,v=r.createVertexArray();r.bindVertexArray(v);let x=r.createBuffer();r.bindBuffer(r.ARRAY_BUFFER,x);let S=y(t.stars,g);r.bufferData(r.ARRAY_BUFFER,S,r.DYNAMIC_DRAW);let C=r.getAttribLocation(a,`aPos`),w=r.getAttribLocation(a,`aColor`),T=r.getAttribLocation(a,`aSize`);r.enableVertexAttribArray(C),r.vertexAttribPointer(C,3,r.FLOAT,!1,28,0),r.enableVertexAttribArray(w),r.vertexAttribPointer(w,3,r.FLOAT,!1,28,12),r.enableVertexAttribArray(T),r.vertexAttribPointer(T,1,r.FLOAT,!1,28,24),r.bindVertexArray(null);let ee=r.getUniformLocation(i,`uRes`),te=r.getUniformLocation(i,`uYaw`),ne=r.getUniformLocation(i,`uPitch`),re=r.getUniformLocation(i,`uExpel`),E=r.getUniformLocation(i,`uEmit`),D=r.getUniformLocation(i,`uFloor`),O=r.getUniformLocation(i,`uGamma`),k=r.getUniformLocation(i,`uAbsorb`),A=r.getUniformLocation(i,`uGasFrac`),ie=r.getUniformLocation(i,`uZoom`),ae=r.getUniformLocation(i,`uPan`);r.useProgram(i),r.uniform1i(r.getUniformLocation(i,`uVol`),0),r.uniform1f(E,9.5),r.uniform1f(k,9),r.uniform1f(D,t.densityFloor),r.uniform1f(O,1.1),r.uniform1f(A,1),r.uniform1f(r.getUniformLocation(i,`uLogRange`),t.logRange);let j=r.getUniformLocation(a,`uYaw`),oe=r.getUniformLocation(a,`uPitch`),se=r.getUniformLocation(a,`uPix`),ce=r.getUniformLocation(a,`uZoom`),le=r.getUniformLocation(a,`uPan`),M=r.getUniformLocation(a,`uStarAlpha`),ue=r.getUniformLocation(a,`uAspect`);r.useProgram(a),r.uniform1f(r.getUniformLocation(a,`uBox`),t.box),r.uniform1f(M,1),r.uniform1f(r.getUniformLocation(a,`uStarGlow`),n.starGlow??0);let de=window.matchMedia(`(prefers-reduced-motion: reduce)`),N=n.reducedMotion??de.matches,P={yaw:p,pitch:0,zoom:1,panX:0,panY:0,spin:!N};function fe(){let t=e.height>0?e.width/e.height:1;return t<1?Math.min(1.7,1/t):1}function F(){r.useProgram(i),r.uniform2f(ae,P.panX,P.panY),r.useProgram(a),r.uniform2f(le,P.panX,P.panY)}F();let pe=n.rotationPeriodSec??110,me=n.expelPeriodSec??34;function he(e){let t=e/me%1;if(t<.45)return 0;if(t<.7){let e=(t-.45)/.25;return e*e*(3-2*e)}if(t<.8)return 1;let n=(t-.8)/.2;return 1-n*n*(3-2*n)}let I=n.autoExpel??!1,L=null;function ge(e){return L===null?I&&!N?he(e):0:L}let R=1;function z(){let t=e.getBoundingClientRect();R=Math.min(window.devicePixelRatio||1,f),e.width=Math.round(t.width*R),e.height=Math.round(t.height*R),r.viewport(0,0,e.width,e.height)}function B(t){r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT),r.enable(r.BLEND),r.useProgram(i),r.blendFunc(r.ONE,r.ONE_MINUS_SRC_ALPHA);let n=P.zoom*fe();r.uniform2f(ee,e.width,e.height),r.uniform1f(ie,n),r.uniform1f(te,P.yaw),r.uniform1f(ne,P.pitch),r.uniform1f(re,t),r.bindTexture(r.TEXTURE_3D,o),r.drawArrays(r.TRIANGLES,0,3),r.useProgram(a),r.blendFunc(r.ONE,r.ONE),r.uniform1f(j,P.yaw),r.uniform1f(oe,P.pitch),r.uniform1f(ce,n),r.uniform1f(ue,e.height>0?e.width/e.height:1),r.uniform1f(se,e.height*.018),r.bindVertexArray(v),r.drawArrays(r.POINTS,0,_),r.bindVertexArray(null)}let V=0,H=!1,U=!0,W=null,G=null;function K(e){W===null&&(W=e);let t=(e-W)/1e3;if(G!==null&&P.spin&&(P.yaw+=2*Math.PI/pe*((e-G)/1e3)),G=e,B(ge(t)),N){H=!1;return}V=requestAnimationFrame(K)}function q(){B(L??0)}function J(){H||document.hidden||!U||(H=!0,V=requestAnimationFrame(K))}function Y(){H=!1,V&&cancelAnimationFrame(V),V=0}let X=new IntersectionObserver(e=>{U=e[0]?.isIntersecting??!0,U?J():Y()},{threshold:0});function Z(){document.hidden?Y():J()}function Q(){z(),H||q()}z(),q(),X.observe(e),window.addEventListener(`resize`,Q,{passive:!0}),document.addEventListener(`visibilitychange`,Z),J();function $(e,t){r.useProgram(i),r.uniform1f(e,t),H||q()}return{setEmit:e=>$(E,e),setAbsorb:e=>$(k,e),setFloor:e=>$(D,e),setGamma:e=>$(O,e),setExpel:e=>{L=e,H||q()},setStarAlpha:e=>{r.useProgram(a),r.uniform1f(M,Math.min(1,Math.max(0,e))),H||q()},setStars:e=>{_=e.length/6,S=y(e,g),r.bindBuffer(r.ARRAY_BUFFER,x),r.bufferData(r.ARRAY_BUFFER,S,r.DYNAMIC_DRAW),H||q()},setStarPositions:e=>{let t=Math.min(_,e.length/3);for(let n=0;n<t;n++){let t=n*7,r=n*3;S[t]=e[r],S[t+1]=e[r+1],S[t+2]=e[r+2]}r.bindBuffer(r.ARRAY_BUFFER,x),r.bufferSubData(r.ARRAY_BUFFER,0,S),H||q()},setGasFraction:e=>$(A,Math.min(1,Math.max(0,e))),setView:e=>{Object.assign(P,e),P.zoom=Math.min(4,Math.max(d,P.zoom)),P.pitch=Math.max(-1.45,Math.min(1.45,P.pitch)),F(),H||q()},getView:()=>({...P}),resetView:()=>{Object.assign(P,{yaw:p,pitch:0,zoom:1,panX:0,panY:0,spin:!N}),G=null,F(),H||q()},redraw:q,reducedMotion:N,cleanup(){Y(),X.disconnect(),window.removeEventListener(`resize`,Q),document.removeEventListener(`visibilitychange`,Z),r.deleteTexture(o),r.deleteProgram(i),r.deleteProgram(a)},meta:{floors:{median:t.floorMedian,mean:t.floorMean},box:t.box,ngrid:t.ngrid}}}var S=3,C=e=>Math.min(4,Math.max(d,e));function w(e,t,n){let r=new AbortController,i={signal:r.signal};e.style.cursor=`grab`,e.style.touchAction=`none`;let a=!1,o=e=>{e!==a&&(a=e,n?.(e))};e.addEventListener(`wheel`,e=>{a&&(e.preventDefault(),t.setView({zoom:C(t.getView().zoom*Math.exp(e.deltaY*.001))}))},{signal:r.signal,passive:!1});let s=new Map,c=0,l=`rotate`,u=()=>{let e=[...s.values()];return Math.hypot(e[0].x-e[1].x,e[0].y-e[1].y)};e.addEventListener(`contextmenu`,e=>e.preventDefault(),i),e.addEventListener(`pointerdown`,t=>{s.set(t.pointerId,{x:t.clientX,y:t.clientY}),e.setPointerCapture(t.pointerId),e.style.cursor=`grabbing`,o(!0),s.size===1&&(l=t.shiftKey||t.button===2?`pan`:`rotate`),s.size===2&&(l=`pan`,c=u())},i),e.addEventListener(`pointerleave`,()=>o(!1),i),e.addEventListener(`pointermove`,n=>{let r=s.get(n.pointerId);if(!r)return;let i=e.getBoundingClientRect().height,a=(n.clientX-r.x)/i,o=(n.clientY-r.y)/i,d=t.getView();if(s.size===1&&(l===`pan`?t.setView({panX:d.panX+a,panY:d.panY-o}):t.setView({spin:!1,yaw:d.yaw+a*S,pitch:d.pitch+o*S})),s.set(n.pointerId,{x:n.clientX,y:n.clientY}),s.size===2&&c>0){let e=u();t.setView({zoom:C(d.zoom*c/e)}),c=e}},i);let d=t=>{s.delete(t.pointerId),c=0,s.size===0&&(e.style.cursor=`grab`)};return e.addEventListener(`pointerup`,d,i),e.addEventListener(`pointercancel`,d,i),e.addEventListener(`dblclick`,()=>t.resetView(),i),()=>r.abort()}export{x as n,w as t};