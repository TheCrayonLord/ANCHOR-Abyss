export const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`;

// Pass 1: geometry. Output pixel -> source pixel (crop, transform, lens distortion, CA, orientation),
// decode to linear light, warp the source-space masks along with the image.
export const GEOM = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_maskA;
uniform sampler2D u_maskB;
uniform vec4 u_win;
uniform vec2 u_cropC, u_axisU, u_axisV;
uniform mat3 u_Hinv;
uniform float u_k, u_rnorm, u_caR, u_caB, u_A;
uniform vec3 u_or0, u_or1;
uniform vec2 u_lensVig;
uniform int u_flipY;
layout(location=0) out vec4 o_color;
layout(location=1) out vec4 o_ma;
layout(location=2) out vec4 o_mb;
vec3 dec(vec3 c){ c=max(c,0.0); return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec2 orient(vec2 p){ vec3 o = vec3(p.x/u_A+0.5, p.y+0.5, 1.0); return vec2(dot(u_or0,o), dot(u_or1,o)); }
void main(){
  vec2 t = v_uv; if(u_flipY==1) t.y = 1.0-t.y;
  vec2 uv = u_win.xy + t*u_win.zw;
  vec2 fp = u_cropC + (uv.x-0.5)*u_axisU + (uv.y-0.5)*u_axisV;
  vec3 h = u_Hinv*vec3(fp,1.0);
  vec2 p = h.xy/h.z;
  float rn2 = dot(p,p)/(u_rnorm*u_rnorm);
  float f = 1.0 + u_k*rn2;
  vec2 sG = orient(p*f);
  bool inside = sG.x>=0.0 && sG.x<=1.0 && sG.y>=0.0 && sG.y<=1.0 && h.z>0.0;
  vec3 c;
  if(u_caR!=0.0 || u_caB!=0.0){
    vec2 sR = orient(p*(f+u_caR)); vec2 sB = orient(p*(f+u_caB));
    c = vec3(dec(texture(u_src,sR).rgb).r, dec(texture(u_src,sG).rgb).g, dec(texture(u_src,sB).rgb).b);
  } else c = dec(texture(u_src,sG).rgb);
  if(u_lensVig.x!=0.0){ float e = 1.0 + u_lensVig.y; c *= 1.0 + u_lensVig.x*pow(clamp(rn2,0.0,1.5), e); }
  o_color = inside ? vec4(c,1.0) : vec4(0.0);
  o_ma = inside ? texture(u_maskA, sG) : vec4(0.0);
  o_mb = inside ? texture(u_maskB, sG) : vec4(0.0);
}`;

export const DOWN = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_texel; out vec4 o;
void main(){
  vec2 d = u_texel*0.5;
  o = 0.25*(texture(u_tex,v_uv+vec2(-d.x,-d.y))+texture(u_tex,v_uv+vec2(d.x,-d.y))+texture(u_tex,v_uv+vec2(-d.x,d.y))+texture(u_tex,v_uv+vec2(d.x,d.y)));
}`;

export const GAUSS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_dir; uniform float u_sigma; out vec4 o;
void main(){
  float s = max(u_sigma, 0.3);
  int R = int(min(ceil(s*2.6), 14.0));
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for(int i=-14;i<=14;i++){
    if(i<-R || i>R) continue;
    float w = exp(-float(i*i)/(2.0*s*s));
    acc += w*texture(u_tex, v_uv + u_dir*float(i)); wsum += w;
  }
  o = acc/wsum;
}`;

// Edge-preserving smoothing for luminance noise reduction.
export const BILATERAL = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_range; uniform float u_step; out vec4 o;
float lum(vec3 c){ return dot(pow(max(c,0.0),vec3(0.4545)), vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec4 c0 = texture(u_tex, v_uv); float l0 = lum(c0.rgb);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec4 c = texture(u_tex, v_uv + vec2(x,y)*u_texel*u_step);
    float d = lum(c.rgb)-l0;
    float w = exp(-float(x*x+y*y)/8.0 - d*d/(2.0*u_range*u_range));
    acc += w*c; ws += w;
  }
  o = acc/ws;
}`;

export const MAIN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_img, u_ma, u_mb, u_bSmall, u_bTex, u_bClar, u_bBase, u_bHaze, u_den, u_lut;
uniform vec4 u_win; uniform int u_flipY;
uniform vec4 u_g0; // temp tint exposure contrast
uniform vec4 u_g1; // highlights shadows whites blacks
uniform vec4 u_g2; // texture clarity dehaze vibrance
uniform vec4 u_g3; // saturation sharpenAmount sharpenDetail sharpenMasking
uniform vec4 u_g4; // nrLum nrLumDetail nrColor nrLumContrast
uniform vec3 u_wbBase;
uniform float u_hue[8]; uniform float u_sat[8]; uniform float u_lum[8]; uniform float u_bw[8];
uniform int u_bwMode; uniform int u_hasCurve;
uniform vec4 u_gSh, u_gMid, u_gHi, u_gGl; // rgb tint offset + luminance
uniform vec2 u_gBal; // centre, width
uniform mat3 u_calib; uniform float u_shadowTint;
uniform vec4 u_vig; uniform vec2 u_vig2; uniform float u_fullAspect;
uniform vec4 u_grain; uniform vec2 u_fullSize;
uniform vec4 u_fringe; uniform vec2 u_fringe2;
uniform vec3 u_air;
uniform int u_maskCount;
uniform vec4 u_loc[40];
uniform vec4 u_rng[24];
uniform int u_clip; uniform int u_overlay; uniform vec3 u_overlayColor; uniform vec3 u_bg;
uniform int u_neutral;
out vec4 o;

float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 enc(vec3 c){ c=max(c,0.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
float encf(float c){ c=max(c,0.0); return c<0.0031308? c*12.92 : 1.055*pow(c,1.0/2.4)-0.055; }
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
  vec4 p = mix(vec4(c.bg,K.wz), vec4(c.gb,K.xy), step(c.b,c.g));
  vec4 q = mix(vec4(p.xyw,c.r), vec4(c.r,p.yzx), step(p.x,c.r));
  float d = q.x-min(q.w,q.y); float e=1.0e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)), d/(q.x+e), q.x);
}
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx+vec3(1.0,2.0/3.0,1.0/3.0))*6.0-3.0); return c.z*mix(vec3(1.0), clamp(p-1.0,0.0,1.0), c.y); }
float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
vec3 wbMul(float t, float n){ vec3 m = u_wbBase*vec3(exp(0.42*t), exp(-0.28*n), exp(-0.42*t)); return m/luma(m); }
float con(float x, float c){
  float p = 0.46; float k = c>=0.0 ? 1.0+c*0.85 : 1.0/(1.0-c*0.75);
  if(x<=0.0) return x;
  if(x<p) return p*pow(x/p, k);
  if(x<1.0) return 1.0-(1.0-p)*pow((1.0-x)/(1.0-p), k);
  return 1.0+(x-1.0)*k;
}
void bandW(float h, out float w[8]){
  float cs[9] = float[9](0.0,30.0,60.0,120.0,180.0,240.0,270.0,300.0,360.0);
  for(int i=0;i<8;i++) w[i]=0.0;
  float d = mod(h*360.0, 360.0);
  for(int i=0;i<8;i++){
    if(d>=cs[i] && d<cs[i+1]){ float t=(d-cs[i])/(cs[i+1]-cs[i]); t=t*t*(3.0-2.0*t); w[i]+=1.0-t; w[(i+1)%8]+=t; }
  }
}
void main(){
  vec2 t = v_uv; if(u_flipY==1) t.y = 1.0-t.y;
  vec2 ouv = u_win.xy + t*u_win.zw;
  vec4 src = texture(u_img, t);
  if(src.a < 0.5){ o = vec4(u_bg,1.0); return; }
  vec3 lin = src.rgb;
  if(u_neutral==1){ o = vec4(clamp(enc(lin),0.0,1.0),1.0); return; }

  // ---- per-pixel parameters: global + masks ----
  float temp=u_g0.x, tint=u_g0.y, expo=u_g0.z, contrast=u_g0.w;
  float hil=u_g1.x, sha=u_g1.y, whi=u_g1.z, bla=u_g1.w;
  float tex=u_g2.x, clar=u_g2.y, haze=u_g2.z;
  float hueL=0.0, satL=0.0, sharpL=0.0, noiseL=0.0; vec3 tintC=vec3(0.0);
  vec4 ma = texture(u_ma, t), mb = texture(u_mb, t);
  float mw[8] = float[8](ma.r,ma.g,ma.b,ma.a,mb.r,mb.g,mb.b,mb.a);
  vec3 gsrc = enc(lin);
  float lsrc = luma(gsrc);
  float overlayW = 0.0;
  for(int i=0;i<8;i++){
    if(i>=u_maskCount) break;
    float w = mw[i];
    vec4 r0 = u_rng[i*3], r1 = u_rng[i*3+1], r2 = u_rng[i*3+2];
    if(r0.x>0.5){ float f=max(r0.w,0.001); w *= smoothstep(r0.y-f, r0.y, lsrc)*(1.0-smoothstep(r0.z, r0.z+f, lsrc)); }
    if(r1.x>0.5){ float d = distance(gsrc, r1.yzw); float tol=r2.x; w *= 1.0-smoothstep(tol*0.6, tol, d); }
    vec4 a0=u_loc[i*5], a1=u_loc[i*5+1], a2=u_loc[i*5+2], a3=u_loc[i*5+3], a4=u_loc[i*5+4];
    w *= a3.w;
    if(i==u_overlay) overlayW = w;
    temp+=w*a0.x; tint+=w*a0.y; expo+=w*a0.z; contrast+=w*a0.w;
    hil+=w*a1.x; sha+=w*a1.y; whi+=w*a1.z; bla+=w*a1.w;
    tex+=w*a2.x; clar+=w*a2.y; haze+=w*a2.z; hueL+=w*a2.w;
    satL+=w*a3.x; sharpL+=w*a3.y; noiseL+=w*a3.z; tintC+=w*a4.rgb;
  }

  vec3 mul = wbMul(temp,tint)*exp2(expo);
  lin *= mul;
  vec3 bSmall = texture(u_bSmall,t).rgb*mul, bTex = texture(u_bTex,t).rgb*mul;
  vec3 bClar = texture(u_bClar,t).rgb*mul, bBase = texture(u_bBase,t).rgb*mul;
  vec3 den = texture(u_den,t).rgb*mul;

  // ---- dehaze (dark-channel style using a wide blur as the haze estimate) ----
  if(haze!=0.0){
    vec3 hb = texture(u_bHaze,t).rgb*mul;
    vec3 A = u_air*mul;
    float darkB = min(min(hb.r/A.r,hb.g/A.g),hb.b/A.b);
    float darkP = min(min(lin.r/A.r,lin.g/A.g),lin.b/A.b);
    float dark = clamp(min(darkB, mix(darkP, darkB, 0.35)),0.0,1.0); // edge-aware: avoids halos at sky/land borders
    if(haze>0.0){
      float tt = max(1.0-0.92*haze*dark, 0.12);
      lin = max((lin-A)/tt + A, 0.0);
      bSmall=max((bSmall-A)/tt+A,0.0); bTex=max((bTex-A)/tt+A,0.0); bClar=max((bClar-A)/tt+A,0.0); bBase=max((bBase-A)/tt+A,0.0); den=max((den-A)/tt+A,0.0);
    } else {
      float k = -haze*0.55*(0.4+0.6*dark);
      lin = mix(lin, A, k); bSmall=mix(bSmall,A,k); bTex=mix(bTex,A,k); bClar=mix(bClar,A,k); bBase=mix(bBase,A,k); den=mix(den,A,k);
    }
  }

  lin = max(u_calib*lin, 0.0);
  vec3 g = enc(lin);
  float L = max(luma(g), 1e-5);

  // ---- noise reduction ----
  float nrL = clamp(u_g4.x + noiseL, 0.0, 1.0);
  if(nrL>0.0){
    vec3 gd = enc(den); float Ld = luma(gd);
    float keep = mix(1.0, 0.55, u_g4.y);
    float edge = smoothstep(0.02, 0.12, abs(L-luma(enc(bTex))));
    float k = nrL*mix(1.0, keep, edge);
    float Ln = mix(L, Ld, k);
    if(u_g4.w>0.0) Ln = mix(Ln, L, u_g4.w*0.5*edge);
    g *= Ln/L; L = max(Ln,1e-5);
  }
  if(u_g4.z>0.0){
    vec3 gc = enc(bTex); float Lc = luma(gc);
    g = L + mix(g-L, (gc-Lc), u_g4.z);
  }

  // ---- tone: highlights / shadows use a local base so texture is kept ----
  float Lb0 = luma(enc(bBase));
  float Lb = mix(Lb0, L, smoothstep(0.05, 0.22, abs(L - Lb0))); // fall back to the pixel itself across strong edges (halo control)
  float ws = pow(1.0-smoothstep(0.0, 0.62, Lb), 1.6);
  float wh = smoothstep(0.38, 1.0, Lb); wh*=wh;
  float L1 = L;
  L1 *= exp2(sha*1.7*ws);
  L1 *= exp2(hil*1.5*wh*(0.5+0.5*smoothstep(0.4,1.2,L)));
  L1 *= exp2(whi*0.9*smoothstep(0.45,1.05,L1));
  L1 = L1*exp2(bla*1.3*(1.0-smoothstep(0.0,0.32,L1))) + bla*0.035*(1.0-smoothstep(0.0,0.25,L1));
  L1 = max(L1, 0.0);
  g *= L1/L; L = max(L1,1e-5);

  // ---- clarity / texture / sharpening (local contrast at three scales) ----
  float Lt = luma(enc(bTex)), Lc2 = luma(enc(bClar));
  if(clar!=0.0){ float mid = 1.0-pow(clamp(abs(2.0*L-1.0),0.0,1.0),2.0); float dc = L-Lc2; dc = dc/(1.0+abs(dc)*6.0); float dL = clar*1.1*dc*mid; g *= max(L+dL,0.0)/L; L=max(L+dL,1e-5); }
  if(tex!=0.0){ float dt = L-Lt; dt = dt/(1.0+abs(dt)*8.0); float dL = tex*1.3*dt; g *= max(L+dL,0.0)/L; L=max(L+dL,1e-5); }
  float shA = u_g3.y + sharpL;
  if(shA!=0.0){
    vec3 d = g - enc(bSmall);
    float lim = mix(0.03, 0.35, u_g3.z);
    d = clamp(d, -lim, lim);
    float edgeMask = smoothstep(u_g3.w*0.06, u_g3.w*0.06+0.02, abs(L-Lt)*2.0);
    g += shA*1.6*d*(u_g3.w>0.0?edgeMask:1.0);
  }

  // ---- contrast ----
  if(contrast!=0.0){ g = vec3(con(g.r,contrast), con(g.g,contrast), con(g.b,contrast)); }

  // ---- defringe ----
  if(u_fringe.x>0.0 || u_fringe.w>0.0){
    vec3 hs = rgb2hsv(clamp(g,0.0,1.0)); float hd = hs.x*360.0;
    float edge = smoothstep(0.03, 0.15, length(g-enc(bSmall))*3.0);
    float pm = u_fringe.x*step(u_fringe.y,hd)*step(hd,u_fringe.z)*edge;
    float gm = u_fringe.w*step(u_fringe2.x,hd)*step(hd,u_fringe2.y)*edge;
    float k = clamp(pm+gm,0.0,1.0); float Lk = luma(g);
    g = mix(g, vec3(Lk), k);
  }

  // ---- tone curve ----
  if(u_hasCurve==1){
    vec3 c = clamp(g,0.0,1.0);
    c = vec3(texture(u_lut,vec2(c.r,0.5)).a, texture(u_lut,vec2(c.g,0.5)).a, texture(u_lut,vec2(c.b,0.5)).a);
    c = vec3(texture(u_lut,vec2(c.r,0.5)).r, texture(u_lut,vec2(c.g,0.5)).g, texture(u_lut,vec2(c.b,0.5)).b);
    g = c + max(g-1.0, 0.0)*0.0;
  }

  // ---- colour mixer (HSL) ----
  vec3 hsv = rgb2hsv(clamp(g,0.0,1.0));
  float bw[8]; bandW(hsv.x, bw);
  float dh=0.0, sm=0.0, lm=0.0, bwl=0.0;
  for(int i=0;i<8;i++){ dh+=bw[i]*u_hue[i]; sm+=bw[i]*u_sat[i]; lm+=bw[i]*u_lum[i]; bwl+=bw[i]*u_bw[i]; }
  dh += hueL;
  if(dh!=0.0 || sm!=0.0){
    float Lp = luma(g);
    hsv.x = fract(hsv.x + dh*(30.0/360.0));
    hsv.y = clamp(hsv.y*(1.0+sm), 0.0, 1.0);
    vec3 g2 = hsv2rgb(hsv);
    g = g2 + (g - clamp(g,0.0,1.0));
  }
  if(lm!=0.0){ g *= 1.0 + lm*0.55*hsv.y; }

  // ---- vibrance / saturation ----
  L = luma(g);
  float s0 = rgb2hsv(clamp(g,0.0,1.0)).y;
  float skin = bw[1]*0.6+bw[0]*0.3;
  float vib = u_g2.w*(1.0-s0)*(1.0-skin);
  float sat = u_g3.x + satL;
  g = L + (g-L)*max(0.0, (1.0+vib*1.1)*(1.0+sat));

  // ---- black & white ----
  if(u_bwMode==1){ float gray = L*(1.0 + bwl*0.9*s0); g = vec3(gray); }

  // ---- colour grading ----
  {
    float tg = (L - u_gBal.x)/u_gBal.y;
    float gs = 1.0-smoothstep(-1.0, 0.6, tg), gh = smoothstep(-0.6, 1.0, tg), gm = max(0.0, 1.0-gs-gh);
    g += u_gSh.rgb*gs + u_gMid.rgb*gm + u_gHi.rgb*gh + u_gGl.rgb;
    g *= 1.0 + u_gSh.a*gs + u_gMid.a*gm + u_gHi.a*gh + u_gGl.a;
  }
  if(u_shadowTint!=0.0){ float w=pow(1.0-clamp(L,0.0,1.0),3.0); g.g -= u_shadowTint*0.06*w; g.rb += u_shadowTint*0.03*w; }
  g += tintC;

  // ---- post-crop vignette ----
  if(u_vig.x!=0.0){
    vec2 d = (ouv-0.5)*2.0;
    float rnd = u_vig.z;
    if(rnd>0.0) d.x = mix(d.x, d.x*u_fullAspect, rnd) ;
    float p = rnd<0.0 ? 2.0 + (-rnd)*6.0 : 2.0;
    float r = pow(pow(abs(d.x),p)+pow(abs(d.y),p), 1.0/p);
    if(rnd>0.0) r /= mix(1.0, max(u_fullAspect,1.0), rnd);
    float inner = 0.15 + u_vig.y*1.1;
    float w = smoothstep(inner, inner + 0.03 + u_vig.w*1.3, r);
    float Lv = luma(g);
    if(u_vig2.y==2.0){ g = mix(g, vec3(u_vig.x<0.0?0.0:1.0), abs(u_vig.x)*w); }
    else if(u_vig.x<0.0){
      float prot = 1.0 - u_vig2.x*smoothstep(0.65,1.0,Lv);
      vec3 gd = g*(1.0 + u_vig.x*w*prot);
      if(u_vig2.y==1.0){ float Ld=luma(gd); gd = Ld + (g-Lv)*(Ld/max(Lv,1e-4))*1.15; }
      g = gd;
    } else g = mix(g, vec3(1.0), u_vig.x*w*0.9);
  }

  // ---- grain ----
  if(u_grain.x>0.0){
    vec2 px = ouv*u_fullSize/(0.6+u_grain.y*3.0);
    float n1 = vnoise(px+u_grain.w) - 0.5;
    float n2 = vnoise(px*2.7+31.7+u_grain.w) - 0.5;
    float n = mix(n1, n1*0.6+n2*0.8, u_grain.z);
    float Lg = luma(g);
    g += n*u_grain.x*0.22*(0.35+0.65*(1.0-abs(2.0*Lg-1.0)));
  }

  g = clamp(g, 0.0, 1.0);
  if(u_clip==1){
    if(max(g.r,max(g.g,g.b))>=0.998) g = vec3(1.0,0.15,0.15);
    else if(max(g.r,max(g.g,g.b))<=0.004) g = vec3(0.15,0.35,1.0);
  }
  if(u_overlay>=0) g = mix(g, u_overlayColor, overlayW*0.6);
  o = vec4(g,1.0);
}`;
