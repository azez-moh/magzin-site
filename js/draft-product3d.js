/*
 * MAGZIN — draft-product3d.js (UX DRAFT — used only by draft-enhanced.html)
 * Based on product3d.js. Draft changes:
 *  - COLLECTION: full 8-stick set (was 2), live color tint via 'magzin:color'
 *    CustomEvent (detail {hex}), colors sampled from the real magzin.store.
 *  - BEATS: full 8-piece bar (7 fixed + 1 swinging end piece) on one canvas,
 *    animated through the five beats; the beat labels light up in sync.
 *  - ANATOMY: DOM labels get a paper pill background (legibility fix).
 * Three.js r164, vendored. No other dependencies.
 *
 * Material truth (Motion/"MAGZIN product (matches CAD).png", user-confirmed):
 * molded polypropylene body — molded finish with coarse orange-peel grain,
 * NOT paint, NOT machined metal; recessed neodymium magnets (nickel-plated,
 * silver); black-on-black debossed stadium MAGZIN plate on the middle band.
 * Chains use a seamless ONE-PIECE lathe per rod; only the anatomy section
 * keeps the seven axial slices (it needs separate parts to explode).
 */
import * as THREE from '../vendor/three.module.js';

const TAG = '[product3d]';

/* ---------------------------------------------------------------- utils */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInCubic = (t) => t * t * t;
const easeOutQuad = (t) => t * (2 - t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const gauss = (x, c, s) => Math.exp(-((x - c) * (x - c)) / (2 * s * s));
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
const DEG = Math.PI / 180;

/* seeded PRNG so grain, undulation and dimples are identical on every reload —
 * renders stay pixel-comparable between sessions and screenshots */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1618033);

/* Contract scroll formula for pinned sections. */
function pinProgress(section) {
  const rect = section.getBoundingClientRect();
  const denom = rect.height - window.innerHeight;
  if (denom <= 0) return 0;
  return clamp(-rect.top / denom, 0, 1);
}

/* --------------------------------------------------- procedural studio env
 * A tiny equirectangular "studio" painted into a DataTexture (CPU data, so it
 * can be shared across the page's WebGL contexts). The renderer PMREMs it
 * internally. Dark variant: near-black room, one WIDE softbox key upper-left
 * (matte PP wants one broad soft highlight, not a hard streak), a thin rim
 * column, a dim fill band between them. Light variant: warm bright room with
 * dark vertical bands so the piece keeps contrast on the paper background. */
function buildEnvTexture(mode) {
  const W = 256, H = 128;
  const data = new Uint16Array(W * H * 4);
  const f = THREE.DataUtils.toHalfFloat;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = down, 1 = up
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      let e;
      if (mode === 'dark') {
        e = 0.008 + 0.02 * smoothstep(0.15, 0.95, v);
        // key softbox — widened so molded plastic gets one broad soft highlight
        e += 4.6 * gauss(u, 0.115, 0.05) * smoothstep(0.22, 0.48, v) * smoothstep(0.99, 0.84, v);
        // soft overhead sheen
        e += 0.5 * smoothstep(0.8, 0.96, v);
        // thin rim column on the opposite side
        e += 2.4 * gauss(u, 0.615, 0.014) * smoothstep(0.2, 0.42, v) * smoothstep(0.97, 0.8, v);
        // broad dim fill between them so matte black doesn't fall to a void
        e += 0.16 * gauss(u, 0.38, 0.12) * smoothstep(0.2, 0.5, v) * smoothstep(0.98, 0.7, v);
        // faint floor bounce
        e += 0.05 * smoothstep(0.25, 0.02, v);
      } else {
        e = 0.3 + 0.38 * smoothstep(0.05, 0.95, v);
        e += 2.0 * gauss(u, 0.115, 0.05) * smoothstep(0.3, 0.55, v) * smoothstep(0.99, 0.85, v);
        e += 1.1 * gauss(u, 0.62, 0.018) * smoothstep(0.25, 0.45, v) * smoothstep(0.95, 0.8, v);
        // dark bands: definition for the piece on paper
        e *= 1 - 0.75 * gauss(u, 0.38, 0.045) * smoothstep(0.12, 0.32, v) * smoothstep(0.92, 0.7, v);
        e *= 1 - 0.6 * gauss(u, 0.86, 0.05) * smoothstep(0.12, 0.36, v) * smoothstep(0.92, 0.7, v);
        e *= 1 - 0.35 * smoothstep(0.22, 0.0, v);
      }
      const i = (y * W + x) * 4;
      data[i] = f(e);            // faintly warm white
      data[i + 1] = f(e * 0.995);
      data[i + 2] = f(e * 0.985);
      data[i + 3] = f(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------- stick dimensions (CAD)
 * One stick = 3.5 units long (36.7 mm per factory CAD, Sheet1.dxf side view
 * BlockOfViews_33 — measured, not eyeballed). The real MAGZIN piece is a
 * NEAR-UNIFORM cylinder: Ø8.1 end blocks, a barely narrower Ø7.85 collar,
 * and a Ø6.8 middle — a subtle molded step, NOT a dog-bone. Magnet wells
 * recess into the SIDE wall in two circumferential rows near each end; the
 * tip is a ~1 mm rounded edge to a flat Ø7.1 face with a Ø3.0 center bore
 * (tip faces are clean — no wells). mm → units at 3.5/36.7 ≈ 0.0954 */
const STICK_LEN = 3.5;
const STICK_STEP = 3.504;      // tip-to-tip spacing: thin dark seam only
const RADIAL = 160;            // high enough that well dimples stay circular
const H = STICK_LEN / 2;                       // 1.75
const R_CAP = 0.386;           // Ø8.1 end block
const R_FACE = 0.339;          // Ø7.1 flat tip face
const R_BORE = 0.143;          // Ø3.0 center bore
const R_COLLAR = 0.375;        // Ø7.85 collar
const R_MID = 0.324;           // Ø6.8 middle body
const A_CAP = 1.192;           // cap block spans 12.5 … 18.35 mm
const A_CHAMFER = 1.655;       // ~1 mm rounded tip edge
const A_NECK = 0.811;          // collar spans 8.5 … 12.5 mm
const A_BLEND = 0.668;         // collar → middle blend ends at 7.0 mm
const A_PLATE = 0.44;          // badge band half-length (anatomy slice)
const R_TIP = R_FACE;          // beats hinge contact tangent

/* magnet wells: two circumferential rows at ±28° off the meridian, front and
 * back, at ~15.5 mm (cap) and ~10.5 mm (collar) from the piece center */
const HOLE_ROWS = [1.474, 0.997, -0.997, -1.474];
// REEL MATCH (2026-10-31): wells sit on the FRONT and BACK faces in pairs,
// ±26° either side of the badge meridian (phi measured from +Z, the front)
const HOLE_PHI = [26, 154, 206, 334];

/* REEL MATCH: the molded piece is a rounded SQUARE in section (flat faces),
 * not a round tube. Superellipse |x/r|^n + |z/r|^n = 1, faces on ±X / ±Z.
 * sef(phi) scales the round radius r out to the superellipse at angle phi. */
const SE_N = 3.4;
function sef(phi) {
  const c = Math.abs(Math.cos(phi)), s = Math.abs(Math.sin(phi));
  return 1 / Math.pow(Math.pow(c, SE_N) + Math.pow(s, SE_N), 1 / SE_N);
}
/* front-face height of the section at lateral offset x (semi-axis r) */
function seFrontZ(x, r) {
  return r * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / r, SE_N)), 1 / SE_N);
}
/* surface point + outward normal at angle phi (x = sin, z = cos) */
function seSurface(phi, r) {
  const k = r * sef(phi);
  const x = k * Math.sin(phi), z = k * Math.cos(phi);
  const nx = Math.sign(x) * Math.pow(Math.abs(x) / r, SE_N - 1);
  const nz = Math.sign(z) * Math.pow(Math.abs(z) / r, SE_N - 1);
  const l = Math.hypot(nx, nz) || 1;
  return { x, z, nx: nx / l, nz: nz / l };
}

/* Continuous silhouette radius at |y| along the stick axis. */
function stickRadius(a) {
  if (a >= A_CHAMFER) {
    // rounded molded tip edge (photo shows a soft fillet, not a crisp chamfer)
    const t = (a - A_CHAMFER) / (H - A_CHAMFER);
    return R_CAP - (R_CAP - R_FACE) * t * t * (3 - 2 * t);
  }
  if (a >= A_CAP) return R_CAP;                 // Ø8.1 end block wall
  if (a >= A_NECK) {                            // small step down to collar
    const t = clamp((A_CAP - a) / 0.03, 0, 1);
    return R_CAP + (R_COLLAR - R_CAP) * t;
  }
  if (a >= A_BLEND) {                           // gentle blend collar → middle
    const t = (a - A_BLEND) / (A_NECK - A_BLEND);
    return R_MID + (R_COLLAR - R_MID) * t * t * (3 - 2 * t);
  }
  return R_MID;                                 // Ø6.8 middle body
}

/* ---------- body height field → normal map + roughness map ----------
 * The photo's grain is coarse, leather-like orange peel. A Sobel-derived
 * normal map holds up at grazing angles where bumpMap goes soft. The height
 * field also carries the raised parting-line seams and the shallow sink-mark
 * dips around each magnet well, so they shade correctly from every angle.
 * v mapping matches the one-piece lathe (see latheV / onePieceGeo); sliced
 * anatomy geometry gets its UVs remapped into the same stick space. */
const TEXW = 1024, TEXH = 2048;
// one-piece lathe v for a rod y: 3 bore points, then 250 profile samples
const latheV = (y) => (3 + ((y + H) / STICK_LEN) * 250) / 256;
const canvasY = (y) => (1 - latheV(y)) * TEXH; // CanvasTexture flipY

/* wrap-aware value noise: seeded random grid, smooth bilinear interpolation,
 * periodic in u so it wraps seamlessly around the rod */
function makeNoise(cellsU, cellsV) {
  const g = [];
  for (let j = 0; j <= cellsV; j++) {
    const row = [];
    for (let i = 0; i < cellsU; i++) row.push(rand());
    g.push(row);
  }
  const sm = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cellsU, y = Math.min(v, 0.9999) * cellsV;
    const i0 = Math.floor(x) % cellsU, j0 = Math.floor(y);
    const i1 = (i0 + 1) % cellsU, j1 = j0 + 1;
    const fx = sm(x - Math.floor(x)), fy = sm(y - Math.floor(y));
    const a = g[j0][i0], b = g[j0][i1], c = g[j1][i0], d = g[j1][i1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

let BODY_MAPS = null;
function bodyMaps() {
  if (BODY_MAPS) return BODY_MAPS;
  const n1 = makeNoise(10, 20);   // molded blotches / low undulation
  const n2 = makeNoise(30, 60);   // coarse leather cells (dominant, per photo)
  const n3 = makeNoise(88, 176);  // fine pore grain
  const h = new Float32Array(TEXW * TEXH);
  for (let y = 0; y < TEXH; y++) {
    const v = y / TEXH;
    for (let x = 0; x < TEXW; x++) {
      const u = x / TEXW;
      h[y * TEXW + x] = 0.5
        + (n1(u, v) - 0.5) * 0.16
        + (n2(u, v) - 0.5) * 0.12
        + (n3(u, v) - 0.5) * 0.40
        + (rand() - 0.5) * 0.16;
    }
  }
  // hair-thin raised parting-line seams where the mold halves meet (u=0 wraps)
  for (const cx of [TEXW / 4, (3 * TEXW) / 4]) {
    for (let dx = -7; dx <= 7; dx++) {
      const x = (cx + dx + TEXW) % TEXW;
      const ridge = 0.30 * Math.exp(-(dx * dx) / (2 * 2.4 * 2.4));
      for (let y = 0; y < TEXH; y++) h[y * TEXW + x] += ridge;
    }
  }
  // shallow sink-mark dips around each magnet well
  for (const gy of HOLE_ROWS) {
    for (const phi of HOLE_PHI) {
      const cx = (phi / 360) * TEXW, cy = canvasY(gy), rad = 66;
      for (let dy = -rad; dy <= rad; dy++) {
        const y = Math.round(cy) + dy;
        if (y < 0 || y >= TEXH) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const x = (Math.round(cx) + dx + TEXW) % TEXW;
          const d2 = dx * dx + dy * dy;
          h[y * TEXW + x] -= 0.16 * Math.exp(-d2 / (2 * 34 * 34));
        }
      }
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = clamp(h[i], 0, 1);

  // roughness: satin molded PP (reel shader: 0.42, swinging 0.36 … 0.50)
  const rcv = document.createElement('canvas');
  rcv.width = TEXW; rcv.height = TEXH;
  const rc = rcv.getContext('2d');
  const rimg = rc.createImageData(TEXW, TEXH);
  for (let i = 0; i < h.length; i++) {
    const g = clamp(0.43 + (h[i] - 0.5) * 0.28, 0.33, 0.55) * 255;
    const i4 = i * 4;
    rimg.data[i4] = rimg.data[i4 + 1] = rimg.data[i4 + 2] = g;
    rimg.data[i4 + 3] = 255;
  }
  rc.putImageData(rimg, 0, 0);

  // normal map (central differences; u wraps, v clamps)
  const S = 2.6;
  const ncv = document.createElement('canvas');
  ncv.width = TEXW; ncv.height = TEXH;
  const nc = ncv.getContext('2d');
  const nimg = nc.createImageData(TEXW, TEXH);
  for (let y = 0; y < TEXH; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(TEXH - 1, y + 1);
    for (let x = 0; x < TEXW; x++) {
      const xl = h[y * TEXW + ((x - 1 + TEXW) % TEXW)];
      const xr = h[y * TEXW + ((x + 1) % TEXW)];
      // tangent +Y is +v = −canvasY, and flipY re-flips: green = +dh/dcanvasY
      const nx = -(xr - xl) * S, ny = (h[yd * TEXW + x] - h[yu * TEXW + x]) * S;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i4 = (y * TEXW + x) * 4;
      nimg.data[i4] = (nx * inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 2] = (inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 3] = 255;
    }
  }
  nc.putImageData(nimg, 0, 0);

  // REEL MATCH: fine speckles molded into the resin (multiplies the body
  // color, so the collection tint keeps working). Mostly 1–2 px flecks,
  // a few lighter, a few darker, averaging ~0.96 so the color holds.
  const scv = document.createElement('canvas');
  scv.width = TEXW; scv.height = TEXH;
  const sc = scv.getContext('2d');
  sc.fillStyle = 'rgb(246,246,246)';
  sc.fillRect(0, 0, TEXW, TEXH);
  const nSpk = Math.round(TEXW * TEXH * 0.0045);
  for (let k = 0; k < nSpk; k++) {
    const x = rand() * TEXW, y = rand() * TEXH;
    const light = rand() < 0.62;
    const g = light ? 255 : 196 + Math.round(rand() * 24);
    const a = light ? 0.55 + rand() * 0.45 : 0.6 + rand() * 0.4;
    sc.fillStyle = light ? `rgba(255,255,255,${a.toFixed(2)})` : `rgba(${g},${g},${g},${a.toFixed(2)})`;
    const d = rand() < 0.8 ? 1.3 : 2.2;
    sc.beginPath(); sc.arc(x, y, d / 2 + 0.2, 0, Math.PI * 2); sc.fill();
  }
  const speckTex = new THREE.CanvasTexture(scv);
  speckTex.colorSpace = THREE.SRGBColorSpace;

  const normalTex = new THREE.CanvasTexture(ncv);
  const roughTex = new THREE.CanvasTexture(rcv);
  for (const t of [normalTex, roughTex, speckTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  BODY_MAPS = { normalTex, roughTex, speckTex };
  return BODY_MAPS;
}

/* ---------- badge: black-on-black debossed plate ----------
 * Photo truth: a flat stadium plate barely proud of the grain, outline groove
 * and MAGZIN text debossed INTO it — same material, no printed color. All the
 * read comes from relief (normal map) + slightly waxier recesses. */
function stadiumPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(x + r, y + h);
  c.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  c.closePath();
}
function badgeDraw(fnPerLayer) { // shared geometry: plate, groove, text
  const W = 512, Hc = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hc;
  const c = cv.getContext('2d');
  c.translate(W / 2, Hc / 2);
  c.rotate(-Math.PI / 2); // text reads along the axis, toward the upper tip
  const L = 900, B = 380, STROKE = 20, INSET = 55;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if ('letterSpacing' in c) c.letterSpacing = '14px';
  let size = 158;
  const setFont = () => {
    c.font = `700 ${size}px 'Hanken Grotesk','Helvetica Neue',Arial,sans-serif`;
  };
  setFont();
  while (size > 60 && c.measureText('MAGZIN').width > L - 190) { size -= 4; setFont(); }
  fnPerLayer(c, { W, Hc, L, B, STROKE, INSET });
  return cv;
}
function blurred(cv, px) {
  const out = document.createElement('canvas');
  out.width = cv.width; out.height = cv.height;
  const c = out.getContext('2d');
  c.filter = `blur(${px}px)`;
  c.drawImage(cv, 0, 0);
  return out;
}
const BODY_CSS = '#26272B'; // hero finish per contract / swing-params

function buildBadgeCanvases(plateCss = BODY_CSS) {
  const W = 512, Hc = 1024;
  // height: 0.5 ground → 0.60 plate → 0.30 groove + text (blur = molded slopes)
  const hCv = blurred(badgeDraw((c, g) => {
    c.fillStyle = '#808080';
    c.fillRect(-g.Hc / 2, -g.W / 2, g.Hc, g.W); // rotated frame
    c.fillStyle = '#999999';
    stadiumPath(c, -g.L / 2, -g.B / 2, g.L, g.B, g.B / 2); c.fill();
    c.strokeStyle = '#4d4d4d'; c.lineWidth = g.STROKE;
    stadiumPath(c, -g.L / 2 + g.INSET, -g.B / 2 + g.INSET,
      g.L - 2 * g.INSET, g.B - 2 * g.INSET, (g.B - 2 * g.INSET) / 2);
    c.stroke();
    c.fillStyle = '#4d4d4d'; c.fillText('MAGZIN', 0, 8);
  }), 2.5);
  const hd = hCv.getContext('2d').getImageData(0, 0, W, Hc).data;
  const hb = new Float32Array(W * Hc);
  for (let i = 0; i < hb.length; i++) hb[i] = hd[i * 4] / 255;

  // normal from badge height (clamped both axes; features sit far from edges)
  const S = 5.0;
  const ncv = document.createElement('canvas');
  ncv.width = W; ncv.height = Hc;
  const nc = ncv.getContext('2d');
  const nimg = nc.createImageData(W, Hc);
  for (let y = 0; y < Hc; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(Hc - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xl = hb[y * W + Math.max(0, x - 1)], xr = hb[y * W + Math.min(W - 1, x + 1)];
      const nx = -(xr - xl) * S, ny = (hb[yd * W + x] - hb[yu * W + x]) * S;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i4 = (y * W + x) * 4;
      nimg.data[i4] = (nx * inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 2] = (inv * 0.5 + 0.5) * 255;
      nimg.data[i4 + 3] = 255;
    }
  }
  nc.putImageData(nimg, 0, 0);

  // color: transparent outside the plate; plate = body color; recesses get a
  // faint occlusion darkening only (no ink — the deboss is the same plastic)
  const mapCv = blurred(badgeDraw((c, g) => {
    c.fillStyle = plateCss;
    stadiumPath(c, -g.L / 2, -g.B / 2, g.L, g.B, g.B / 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.30)'; c.lineWidth = g.STROKE + 6;
    stadiumPath(c, -g.L / 2 + g.INSET, -g.B / 2 + g.INSET,
      g.L - 2 * g.INSET, g.B - 2 * g.INSET, (g.B - 2 * g.INSET) / 2);
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillText('MAGZIN', 0, 8);
  }), 1);

  // roughness: plate slightly smoother than the grained body, recesses waxier
  const roughCv = blurred(badgeDraw((c, g) => {
    c.fillStyle = '#b3b3b3';
    c.fillRect(-g.Hc / 2, -g.W / 2, g.Hc, g.W);
    c.fillStyle = '#a3a3a3';
    stadiumPath(c, -g.L / 2, -g.B / 2, g.L, g.B, g.B / 2); c.fill();
    c.strokeStyle = '#8f8f8f'; c.lineWidth = g.STROKE + 6;
    stadiumPath(c, -g.L / 2 + g.INSET, -g.B / 2 + g.INSET,
      g.L - 2 * g.INSET, g.B - 2 * g.INSET, (g.B - 2 * g.INSET) / 2);
    c.stroke();
    c.fillStyle = '#8f8f8f'; c.fillText('MAGZIN', 0, 8);
  }), 2);

  return { mapCv, ncv, roughCv };
}

let BADGE_MAPS = null;
function badgeMaps() {
  if (!BADGE_MAPS) {
    const cvs = buildBadgeCanvases();
    const map = new THREE.CanvasTexture(cvs.mapCv);
    map.colorSpace = THREE.SRGBColorSpace;
    const normal = new THREE.CanvasTexture(cvs.ncv);
    const rough = new THREE.CanvasTexture(cvs.roughCv);
    for (const t of [map, normal, rough]) t.anisotropy = 8;
    BADGE_MAPS = { map, normal, rough };
    // re-bake once Hanken Grotesk arrives (first bake may use the fallback);
    // the normal map needs a fresh Sobel pass, so rebuild all three canvases
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        const fresh = buildBadgeCanvases();
        map.image = fresh.mapCv;
        normal.image = fresh.ncv;
        rough.image = fresh.roughCv;
        map.needsUpdate = normal.needsUpdate = rough.needsUpdate = true;
        for (const a of apps) a.dirty = true;
      });
    }
  }
  return BADGE_MAPS;
}

/* tintable badge: same relief, but the plate is baked WHITE so material.color
 * can multiply it to any body color (deboss shading is 0.3-alpha black, which
 * multiplies correctly). Used only by the collection color-picker scene. */
let TINT_BADGE_MAPS = null;
function tintBadgeMaps() {
  if (!TINT_BADGE_MAPS) {
    const cvs = buildBadgeCanvases('#ffffff');
    const map = new THREE.CanvasTexture(cvs.mapCv);
    map.colorSpace = THREE.SRGBColorSpace;
    const normal = new THREE.CanvasTexture(cvs.ncv);
    const rough = new THREE.CanvasTexture(cvs.roughCv);
    for (const t of [map, normal, rough]) t.anisotropy = 8;
    TINT_BADGE_MAPS = { map, normal, rough };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        const fresh = buildBadgeCanvases('#ffffff');
        map.image = fresh.mapCv;
        normal.image = fresh.ncv;
        rough.image = fresh.roughCv;
        map.needsUpdate = normal.needsUpdate = rough.needsUpdate = true;
        for (const a of apps) a.dirty = true;
      });
    }
  }
  return TINT_BADGE_MAPS;
}

/* -------------------------------------------------------------- materials */
function buildMaterials(light) {
  // Molded polypropylene, molded finish — not paint: zero metalness, waxy
  // low-gloss sheen broken up by the grain (normal + roughness maps).
  const bm = bodyMaps();
  // REEL MATCH: same physical values as the reel's Blender shader —
  // polypropylene IOR 1.49, no clear coat, faint waxy sheen, satin
  // roughness, fine grain + speckle (not the old coarse leather peel)
  const body = new THREE.MeshPhysicalMaterial({
    color: 0x26272B, metalness: 0.0, roughness: 1.0,
    map: bm.speckTex,
    normalMap: bm.normalTex, normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: bm.roughTex,
    ior: 1.49, specularIntensity: 0.9,
    sheen: 0.12, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 1.0,
  });
  // unlit near-black interior = the depth shadow inside a real recessed well
  const holeWall = new THREE.MeshBasicMaterial({ color: 0x0b0a09, side: THREE.BackSide });
  const holeRim = new THREE.MeshBasicMaterial({ color: 0x0b0a09, side: THREE.DoubleSide });
  // REEL MATCH: neodymium magnet sunk deep in the well — dark, with a warm
  // gold glint only when the well lines up with the light (#B8995E, 0.34)
  const dot = new THREE.MeshStandardMaterial({
    color: 0xB8995E, metalness: 1.0, roughness: 0.34,
    envMapIntensity: light ? 0.55 : 0.5,
  });
  const bg = badgeMaps();
  const badge = new THREE.MeshStandardMaterial({
    map: bg.map, normalMap: bg.normal, normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: bg.rough,
    metalness: 0.0, roughness: 1.0,
    envMapIntensity: 1.0, transparent: true,
  });
  return { body, magnet: body, dot, badge, holeWall, holeRim };
}

/* collection-only materials: body + badge share one tintable color; every
 * other scene keeps the hero finish (#26272B) untouched. */
function buildTintMaterials(base) {
  const body = base.body.clone(); // shares normal/rough maps, own color
  const bg = tintBadgeMaps();
  const badge = new THREE.MeshStandardMaterial({
    map: bg.map, normalMap: bg.normal, normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: bg.rough,
    metalness: 0.0, roughness: 1.0,
    envMapIntensity: 1.0, transparent: true,
  });
  body.color.set(0x101820);
  badge.color.set(0x101820);
  return {
    body, magnet: body, badge,
    dot: base.dot, holeWall: base.holeWall, holeRim: base.holeRim,
  };
}

/* --------------------------------------- molded displacement (shared field)
 * Gentle periodic radial undulation (integer harmonics around θ → seamless),
 * tapered flat at the tip faces (magnet contact) and calmed under the badge
 * band, PLUS a dimple sunk under each magnet well — the continuous lathe skin
 * would otherwise pass through the well and occlude the shadowed wall+brass.
 * One global field in stick space keeps the sliced anatomy pieces continuous
 * with each other and with the one-piece chain rod. */
let HARM = null;
function harmonics() {
  if (!HARM) {
    HARM = [];
    for (let i = 0; i < 4; i++) {
      HARM.push({
        m: 1 + Math.floor(rand() * 3),
        n: 1.5 + rand() * 3.5,
        ph: rand() * Math.PI * 2, ps: rand() * Math.PI * 2,
        a: 0.002 + rand() * 0.0022,
      });
    }
  }
  return HARM;
}
const WELLS = [];
for (const gy of HOLE_ROWS) for (const phi of HOLE_PHI) WELLS.push({ th: (90 - phi) * DEG, gy });

function displaceLathe(geo, yOff) {
  const harm = harmonics();
  const pos = geo.attributes.position;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const r = Math.hypot(v3.x, v3.z);
    if (r < 0.25) continue;                          // keep bore + face centers exact
    const ys = v3.y + yOff;                          // stick-space y
    const th = Math.atan2(v3.z, v3.x);
    const taperTip = smoothstep(H, 1.55, Math.abs(ys));
    const taperBadge = 0.3 + 0.7 * smoothstep(0.34, 0.55, Math.abs(ys));
    let d = 0;
    for (const h of harm) {
      d += h.a * Math.sin(h.m * th + h.ph) *
        Math.sin(Math.PI * 2 * h.n * (ys / STICK_LEN) + h.ps);
    }
    // well dimple — fade must end INSIDE the rim ring (0.058–0.082) or the
    // coarse dimple edge peeks past it and wells render as jagged clovers
    let dip = 0;
    for (const w of WELLS) {
      const dy = ys - w.gy;
      if (Math.abs(dy) > 0.068) continue;
      let dth = th - w.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      const da = Math.hypot(dth * r, dy);
      if (da > 0.068) continue;
      dip = Math.max(dip, 0.12 * (1 - smoothstep(0.038, 0.068, da)));
    }
    const phi = Math.atan2(v3.x, v3.z);              // lathe angle, 0 = front
    const s = Math.max(0.05, (r + d * taperTip * taperBadge - dip) * sef(phi)) / r;
    pos.setX(i, v3.x * s);
    pos.setZ(i, v3.z * s);
  }
  geo.computeVertexNormals();
}

/* remap a slice lathe's v into stick space so the shared body texture (with
 * its baked seams and sink marks) lands at the same spot as on the one-piece */
function remapLatheUVs(geo, yOff) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, clamp(latheV(pos.getY(i) + yOff), 0, 1));
  }
}

/* ------------------------------------------------- geometry: slices + piece */

/* Lathe one axial slice [y0..y1] of the global silhouette in stick space,
 * capped at both ends (inset 0.001 so adjacent slices never z-fight), local
 * origin at the slice center so the named anatomy groups explode cleanly.
 * bore: 'hi' | 'lo' | null carves the recessed center bore into that face. */
function sliceGeo(y0, y1, bore) {
  const c = (y0 + y1) / 2;
  const lo = y0 + 0.001, hi = y1 - 0.001;
  const pts = [];
  if (bore === 'lo') {
    pts.push(new THREE.Vector2(0, lo - c + 0.035));
    pts.push(new THREE.Vector2(R_BORE, lo - c + 0.035));
    pts.push(new THREE.Vector2(R_BORE, lo - c));
  } else {
    pts.push(new THREE.Vector2(0, lo - c));
  }
  const N = Math.max(8, Math.round((hi - lo) / 0.014));
  for (let i = 0; i <= N; i++) {
    const y = lo + (hi - lo) * (i / N);
    pts.push(new THREE.Vector2(stickRadius(Math.abs(y)), y - c));
  }
  if (bore === 'hi') {
    pts.push(new THREE.Vector2(R_BORE, hi - c));
    pts.push(new THREE.Vector2(R_BORE, hi - c - 0.035));
    pts.push(new THREE.Vector2(0, hi - c - 0.035));
  } else {
    pts.push(new THREE.Vector2(0, hi - c));
  }
  const geo = new THREE.LatheGeometry(pts, RADIAL);
  remapLatheUVs(geo, c);
  displaceLathe(geo, c);
  return geo;
}

/* the whole rod as ONE lathe, bores at both tip faces — the seamless chain
 * piece (the real product is one molded part; only anatomy needs slices) */
function onePieceGeo() {
  const pts = [];
  pts.push(new THREE.Vector2(0, -H + 0.035));
  pts.push(new THREE.Vector2(R_BORE, -H + 0.035));
  pts.push(new THREE.Vector2(R_BORE, -H));
  const N = Math.round(STICK_LEN / 0.014); // 250 — latheV() depends on this
  for (let i = 0; i <= N; i++) {
    const y = -H + STICK_LEN * (i / N);
    pts.push(new THREE.Vector2(stickRadius(Math.abs(y)), y));
  }
  pts.push(new THREE.Vector2(R_BORE, H));
  pts.push(new THREE.Vector2(R_BORE, H - 0.035));
  pts.push(new THREE.Vector2(0, H - 0.035));
  const geo = new THREE.LatheGeometry(pts, RADIAL);
  displaceLathe(geo, 0);
  return geo;
}

/* merge one template geometry repeated under a list of transforms into a
 * single draw call (r164 core has no BufferGeometryUtils; this is enough) */
function mergeTransformed(geo, mats4) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
  const n = pos.count, m = mats4.length;
  const P = new Float32Array(n * m * 3);
  const Nn = new Float32Array(n * m * 3);
  const U = uv ? new Float32Array(n * m * 2) : null;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  mats4.forEach((mat, k) => {
    nm.getNormalMatrix(mat);
    for (let i = 0; i < n; i++) {
      const o = (k * n + i);
      v.fromBufferAttribute(pos, i).applyMatrix4(mat);
      P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      Nn[o * 3] = v.x; Nn[o * 3 + 1] = v.y; Nn[o * 3 + 2] = v.z;
      if (U) { U[o * 2] = uv.getX(i); U[o * 2 + 1] = uv.getY(i); }
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}

/* recessed magnet well, built as a real stack so parallax works like the
 * photo: dark chamfer ring at the mouth + unlit tapered wall + nickel disc
 * sunk 0.055 deep. At grazing angles the wall hides the nickel — dark hole,
 * exactly like most holes in the photo; face-on it glints. */
function wellMatrices(gyList, yOff) {
  const FWD = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const rims = [], walls = [], brass = [];
  for (const gy of gyList) {
    for (const phi of HOLE_PHI) {
      // REEL MATCH: wells sit on the flat front/back faces, drilled along the
      // face normal (not radially), and the magnet sits deeper in the well
      const sp = seSurface(phi * DEG, stickRadius(Math.abs(gy)));
      const dir = new THREE.Vector3(sp.nx, 0, sp.nz);
      const qF = new THREE.Quaternion().setFromUnitVectors(FWD, dir);
      const qU = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      const at = (q, depth) => new THREE.Matrix4().compose(
        new THREE.Vector3(sp.x + dir.x * depth, gy - yOff, sp.z + dir.z * depth), q, one);
      rims.push(at(qF, 0.012));
      walls.push(at(qU, 0.012 - 0.048)); // wall spans surf+0.014 … surf−0.086
      brass.push(at(qF, 0.012 - 0.082));
    }
  }
  return { rims, walls, brass };
}

const GEO = {};
function getGeo() {
  if (!GEO.onePiece) {
    // well stack templates
    GEO.wellRim = new THREE.RingGeometry(0.058, 0.082, 32);
    GEO.wellWall = new THREE.CylinderGeometry(0.064, 0.058, 0.10, 24, 1, true);
    GEO.wellBrass = new THREE.CircleGeometry(0.046, 24);
    const wellSet = (gyList, yOff) => {
      const m = wellMatrices(gyList, yOff);
      return {
        rims: mergeTransformed(GEO.wellRim, m.rims),
        walls: mergeTransformed(GEO.wellWall, m.walls),
        brass: mergeTransformed(GEO.wellBrass, m.brass),
      };
    };

    // seamless chain rod: 5 draw calls per stick (body, badge, rims, walls, brass)
    GEO.onePiece = onePieceGeo();
    GEO.chainWells = wellSet(HOLE_ROWS, 0);

    // anatomy slices, lathed directly in stick space (no mirror-flip trick —
    // that would break the stick-space UV remap and well placement)
    const cTipU = (A_CAP + H) / 2, cColU = (A_NECK + A_CAP) / 2;
    GEO.slices = {
      UpperMagnet: sliceGeo(A_CAP, H, 'hi'),
      Joint01: sliceGeo(A_NECK, A_CAP, null),
      UpperBody: sliceGeo(A_PLATE, A_NECK, null),
      MiddleBody: sliceGeo(-A_PLATE, A_PLATE, null),
      LowerBody: sliceGeo(-A_NECK, -A_PLATE, null),
      Joint02: sliceGeo(-A_CAP, -A_NECK, null),
      LowerMagnet: sliceGeo(-H, -A_CAP, 'lo'),
    };
    GEO.sliceWells = {
      UpperMagnet: wellSet([1.474], cTipU),
      Joint01: wellSet([0.997], cColU),
      Joint02: wellSet([-0.997], -cColU),
      LowerMagnet: wellSet([-1.474], -cTipU),
    };

    // debossed stadium MAGZIN plate: slim curved strip riding the middle band
    // REEL MATCH: the MAGZIN oval rides the FLAT front panel of the waist —
    // a strip bent to the superellipse front face, a hair proud of it
    GEO.badge = new THREE.PlaneGeometry(0.32, 0.62, 48, 1);
    {
      const bp = GEO.badge.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        bp.setZ(i, seFrontZ(bp.getX(i), R_MID) + 0.008);
      }
      GEO.badge.computeVertexNormals();
    }
    GEO.flash = new THREE.RingGeometry(0.4, 0.5, 48);
  }
  return GEO;
}

function addWellSet(parent, set, mats) {
  parent.add(
    new THREE.Mesh(set.rims, mats.holeRim),
    new THREE.Mesh(set.walls, mats.holeWall),
    new THREE.Mesh(set.brass, mats.dot),
  );
}

/* seamless one-piece rod — what every chain scene shows */
function createSeamlessStick(mats, withBadge = true) {
  const g = getGeo();
  const stick = new THREE.Group();
  stick.name = 'MagzinStick';
  stick.add(new THREE.Mesh(g.onePiece, mats.body));
  addWellSet(stick, g.chainWells, mats);
  if (withBadge) stick.add(new THREE.Mesh(g.badge, mats.badge));
  return stick;
}

/* sliced rod — same silhouette/texture, but seven named groups so the
 * anatomy section can explode it. centerY semantics unchanged. */
const SEG_LAYOUT = [
  ['UpperMagnet', (A_CAP + H) / 2],
  ['Joint01', (A_NECK + A_CAP) / 2],
  ['UpperBody', (A_PLATE + A_NECK) / 2],
  ['MiddleBody', 0],
  ['LowerBody', -(A_PLATE + A_NECK) / 2],
  ['Joint02', -(A_NECK + A_CAP) / 2],
  ['LowerMagnet', -(A_CAP + H) / 2],
];

export function createMagzinStick(mats, withBadge = true) {
  const g = getGeo();
  const stick = new THREE.Group();
  stick.name = 'MagzinStick';
  const segments = {};
  for (const [name, y] of SEG_LAYOUT) {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.y = y;
    grp.userData.baseY = y;
    grp.add(new THREE.Mesh(g.slices[name], mats.body));
    if (g.sliceWells[name]) addWellSet(grp, g.sliceWells[name], mats);
    if (name === 'MiddleBody' && withBadge) {
      grp.add(new THREE.Mesh(g.badge, mats.badge));
    }
    stick.add(grp);
    segments[name] = grp;
  }
  stick.userData.segments = segments;
  return stick;
}

/* Chain of n seamless sticks connected tip-to-tip along local +Y, centered. */
function createChain(n, mats) {
  const chain = new THREE.Group();
  chain.name = 'MagzinChain';
  for (let i = 0; i < n; i++) {
    // every piece carries its own debossed MAGZIN plate (per the CAD photo:
    // each single 36.7 mm cylinder is marked)
    const s = createSeamlessStick(mats);
    s.position.y = (i - (n - 1) / 2) * STICK_STEP;
    chain.add(s);
  }
  return chain;
}

const chainHalf = (n) => ((n - 1) * STICK_STEP) / 2 + STICK_LEN / 2;

/* ------------------------------------------------------------ app plumbing */
const apps = [];
let reduced = false;
let lang = 'en';

function makeRenderer(canvas, exposure) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  // REEL MATCH: the reel was graded through Blender AgX; ACES crushed the
  // black PP and hid the molded form
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function makeApp(id, sectionId, exposure, fallbackH) {
  const canvas = document.getElementById(id);
  const section = document.getElementById(sectionId);
  if (!canvas || !section) {
    console.warn(`${TAG} missing #${id} or #${sectionId} — scene skipped.`);
    return null;
  }
  let renderer;
  try {
    renderer = makeRenderer(canvas, exposure);
  } catch (err) {
    console.warn(`${TAG} WebGL unavailable for #${id}:`, err);
    return null;
  }
  const app = {
    id, canvas, section, renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(34, 1, 0.1, 300),
    visible: false, dirty: true, w: 2, h: 2, aspect: 1,
    fallbackH,
    onFit: null, update: null,
    fit() {
      const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || window.innerWidth;
      const h = canvas.clientHeight || Math.max(2, Math.round(window.innerHeight * this.fallbackH));
      this.w = Math.max(2, w);
      this.h = Math.max(2, h);
      this.aspect = this.w / this.h;
      renderer.setPixelRatio(DPR());
      renderer.setSize(this.w, this.h, false);
      this.camera.aspect = this.aspect;
      if (this.onFit) this.onFit();
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    },
  };
  apps.push(app);
  return app;
}

/* ================================================================== HERO
 * Two 4-stick chains on black forming a tall inverted-V / open compass,
 * long soft key highlight, idle drift + eased mouse parallax + scroll pull. */
function buildHero(darkEnv, mats) {
  const app = makeApp('hero-canvas', 'hero', 1.1, 1);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0x1b1a18);
  scene.environment = darkEnv;

  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-5, 7, 4);
  const rim = new THREE.DirectionalLight(0xffebd1, 1.1);
  rim.position.set(4, 1.5, -5);
  // soft fill so matte PP reveals its form instead of falling flat
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0x35322c, 0.35);
  scene.add(key, rim, hemi);

  const rig = new THREE.Group();
  scene.add(rig);

  const placeTip = (chain, rotZ, tip) => {
    chain.rotation.z = rotZ;
    const v = new THREE.Vector3(0, chainHalf(4), 0)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), rotZ);
    chain.position.set(tip.x - v.x, tip.y - v.y, tip.z);
  };

  const chainA = createChain(4, mats); // leaning leg
  const chainB = createChain(4, mats); // near-vertical leg
  placeTip(chainA, 0.34, new THREE.Vector3(0.35, 3.7, 0));
  placeTip(chainB, -0.035, new THREE.Vector3(0.78, 3.55, -0.5));
  rig.add(chainA, chainB);

  camera.position.set(0, -0.6, 15);
  camera.lookAt(0, 0.8, 0);

  let baseZ = 15;
  app.onFit = () => {
    baseZ = 15 * clamp(1.4 / app.aspect, 1, 2);
  };

  // eased mouse parallax
  let tx = 0, ty = 0, mx = 0, my = 0;
  window.addEventListener('pointermove', (e) => {
    tx = (e.clientX / window.innerWidth - 0.5) * 2;
    ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  app.update = (t) => {
    const rect = app.section.getBoundingClientRect();
    const p = clamp(-rect.top / Math.max(rect.height, 1), 0, 1);
    if (reduced) {
      rig.rotation.set(0, 0, 0);
      rig.position.y = 0;
      camera.position.z = baseZ;
    } else {
      mx += (tx - mx) * 0.04;
      my += (ty - my) * 0.04;
      // slow elegant sway (~20s period, a few degrees) keeps the long soft
      // highlights traveling along the bodies, plus eased mouse parallax
      const sway = Math.sin(t * 0.314); // 2π / 20s
      rig.rotation.y = sway * 0.055 + mx * 0.09;
      rig.rotation.x = my * 0.035 + Math.sin(t * 0.09) * 0.008;
      rig.rotation.z = Math.sin(t * 0.07) * 0.006; // slow breathe/drift
      rig.position.y = Math.sin(t * 0.1) * 0.06;
      camera.position.z = baseZ + p * 1.8;     // slight pull on scroll
    }
    camera.lookAt(0, 0.8, 0);
    app.renderer.render(app.scene, camera);
  };
}

/* ============================================================== THE PULL
 * Scroll-scrubbed (300vh pin): two 4-stick chains enter horizontally from
 * the edges, accelerate, hesitate/align near contact, SNAP with overshoot,
 * flash ring + camera push, then the joined bar eases to horizontal rest. */
function buildPull(darkEnv, mats) {
  const app = makeApp('pull-canvas', 'pull', 1.1, 1);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0x1b1a18);
  scene.environment = darkEnv;

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-6, 8, 6);
  const rim = new THREE.DirectionalLight(0xffebd1, 0.9);
  rim.position.set(5, -2, -6);
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0x35322c, 0.3);
  scene.add(key, rim, hemi);

  const HALF = chainHalf(4); // 7
  const bar = new THREE.Group();
  scene.add(bar);

  const wrap = (side) => {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.z = side < 0 ? -Math.PI / 2 : Math.PI / 2; // facing tip inward
    inner.add(createChain(4, mats));
    outer.add(inner);
    bar.add(outer);
    return outer;
  };
  const cl = wrap(-1);
  const cr = wrap(1);

  // snap flash: thin additive white ring + brief point light
  const ring = new THREE.Mesh(
    getGeo().flash,
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  ring.visible = false;
  const snapLight = new THREE.PointLight(0xffffff, 0, 10);
  snapLight.position.set(0, 0, 0.7);
  bar.add(ring, snapLight);

  camera.fov = 30;
  let z0 = 34, visHalf = 17;
  app.onFit = () => {
    const tanH = Math.tan((camera.fov / 2) * DEG);
    z0 = clamp((2 * HALF * 1.24) / (2 * tanH * app.aspect), 20, 110);
    visHalf = z0 * tanH * app.aspect;
  };
  camera.position.set(0, 0, 34);

  const A_END = 0.68, B_END = 0.8, C_END = 0.84, TOUCH = 0.002;

  const tipX = (p) => { // left tip; right is mirrored
    // weighted approach: slow start, confident acceleration
    if (p < A_END) return lerp(-(visHalf + 1.5), -0.42, easeInCubic(p / A_END));
    if (p < B_END) {
      // anticipation beat: ease toward contact with a slight mid-window
      // pull-back before committing
      const q = (p - A_END) / (B_END - A_END);
      return lerp(-0.42, -0.12, easeOutQuad(q)) - 0.05 * Math.sin(Math.PI * q);
    }
    if (p < C_END) { const q = (p - B_END) / (C_END - B_END); return lerp(-0.12, -TOUCH, q * q * q); }
    return -TOUCH;
  };

  const pose = (p, t) => {
    const lt = tipX(p);
    cl.position.x = lt - HALF;
    cr.position.x = -lt + HALF;

    const align = smoothstep(0.5, 0.8, p);
    const hes = gauss(p, 0.74, 0.055); // hesitation window around p≈0.74
    const jy = (Math.sin(p * 233.0) + 0.6 * Math.sin(p * 471.0)) * 0.01 * hes;
    const jr = Math.sin(p * 317.0) * 0.006 * hes;
    const yOff = 0.1 * (1 - align);
    const tilt = 0.05 * (1 - align);
    cl.position.y = yOff + jy;
    cr.position.y = -yOff - jy * 0.8;
    cl.rotation.z = tilt + jr;
    cr.rotation.z = -tilt + jr * 0.7;

    // post-snap: tiny overshoot along the approach axis, settle, then the
    // joined 8-stick bar rotates slowly to horizontal rest — and once
    // settled it keeps drifting very slowly so p=1 stays alive
    const q = clamp((p - C_END) / (1 - C_END), 0, 1);
    const alive = reduced ? 0 : smoothstep(0.9, 1, p);
    bar.position.x = p > C_END ? 0.32 * Math.exp(-5 * q) * Math.sin(12.5 * q) : 0;
    bar.position.y = alive * Math.sin(t * 0.21) * 0.05;
    bar.rotation.z = 0.035 * (1 - easeOutCubic(clamp(q * 1.4, 0, 1))) +
      alive * Math.sin(t * 0.11) * 0.008;
    bar.rotation.y = alive * Math.sin(t * 0.16) * 0.05;

    // flash + camera push at the snap
    const flash = gauss(p, C_END + 0.004, 0.011);
    ring.visible = flash > 0.01;
    ring.material.opacity = clamp(flash, 0, 1);
    ring.scale.setScalar(1 + clamp((p - C_END) / 0.08, 0, 1) * 2.6);
    snapLight.intensity = flash * 26;
    camera.position.z = z0 - 1.1 * gauss(p, 0.85, 0.05);
    camera.lookAt(0, 0, 0);
  };

  app.update = (t) => {
    pose(reduced ? 1 : pinProgress(app.section), t);
    app.renderer.render(app.scene, camera);
  };
}

/* =============================================================== ANATOMY
 * Light background (#f8f4ed, brand off-white). One large stick, scroll-scrubbed exploded
 * view; DOM labels (thin line + mono text) track 3D anchors via project(). */
const LABEL_DEFS = [
  { seg: 'UpperBody', side: 'left', en: 'MOLDED BODY — 36.7 × 8.1 MM', ar: 'جسم مصبوب — 36.7 × 8.1 مم' },
  { seg: 'UpperMagnet', side: 'right', en: 'RECESSED NEODYMIUM MAGNETS', ar: 'مغناطيسات نيوديميوم غائرة' },
  { seg: 'Joint01', side: 'right', en: 'MOLDED COLLAR', ar: 'طوق مصبوب' },
  { seg: 'MiddleBody', side: 'left', en: 'DEBOSSED MARK', ar: 'علامة غائرة' },
];
const anatomyLabels = [];

function labelFont() {
  return lang === 'ar'
    ? "11px/1.5 'GE SS Two', 'IBM Plex Sans Arabic', sans-serif"
    : "10px/1.4 'Grantha Sangam MN', 'Hanken Grotesk', sans-serif";
}

function refreshLabelText() {
  for (const l of anatomyLabels) {
    l.txt.textContent = lang === 'ar' ? l.txt.dataset.ar : l.txt.dataset.en;
    l.txt.style.font = labelFont();
    l.txt.style.letterSpacing = lang === 'ar' ? '0' : '.08em';
  }
}

function buildAnatomy(lightEnv, matsLight) {
  const app = makeApp('anatomy-canvas', 'anatomy', 1.0, 1);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0xf8f4ed);
  scene.environment = lightEnv;

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-4, 6, 5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(4, 1, -3);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 0.5);
  scene.add(key, fill, hemi);

  const rig = new THREE.Group();
  const stick = createMagzinStick(matsLight);
  rig.add(stick);
  rig.rotation.z = 0.28;
  scene.add(rig);
  const segs = stick.userData.segments;

  // explosion multipliers along the stick axis (tip band → collar → sleeve)
  const SPREAD = {
    UpperMagnet: 1.0, Joint01: 0.64, UpperBody: 0.32, MiddleBody: 0,
    LowerBody: -0.32, Joint02: -0.64, LowerMagnet: -1.0,
  };

  camera.fov = 32;
  camera.position.set(0, 0, 6.4);

  // labels
  const holder = document.getElementById('anatomy-labels');
  if (holder) {
    const cs = getComputedStyle(holder);
    if (cs.position === 'static') {
      holder.style.position = 'absolute';
      holder.style.inset = '0';
    }
    holder.style.pointerEvents = 'none';
    holder.style.overflow = 'hidden';
    for (const d of LABEL_DEFS) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:0;top:0;display:flex;align-items:center;gap:9px;' +
        'pointer-events:none;opacity:0;will-change:transform,opacity;';
      if (d.side === 'left') el.style.flexDirection = 'row-reverse';
      const line = document.createElement('span');
      line.style.cssText =
        'display:block;width:54px;height:1px;background:rgba(27,26,24,.5);flex:none;';
      const txt = document.createElement('span');
      txt.dataset.en = d.en;
      txt.dataset.ar = d.ar;
      // DRAFT: paper pill behind the text so labels stay legible when they
      // cross the exploded parts (known overlap issue)
      txt.style.cssText =
        'color:#1b1a18;white-space:nowrap;text-transform:uppercase;' +
        'background:rgba(248,244,237,.85);padding:3px 9px;border-radius:999px;' +
        'border:1px solid rgba(27,26,24,.12);';
      el.append(line, txt);
      holder.appendChild(el);
      anatomyLabels.push({ el, txt, seg: segs[d.seg], side: d.side });
    }
    refreshLabelText();
  } else {
    console.warn(`${TAG} #anatomy-labels missing — anatomy labels skipped.`);
  }

  const V = new THREE.Vector3();
  const pose = (p) => {
    for (const name in SPREAD) {
      const g = segs[name];
      g.position.y = g.userData.baseY + p * 1.05 * SPREAD[name];
    }
    // slight rotation on the small parts as they separate
    segs.Joint01.rotation.z = p * 0.1;
    segs.Joint02.rotation.z = -p * 0.1;
    segs.UpperMagnet.rotation.z = p * 0.14;
    segs.LowerMagnet.rotation.z = -p * 0.14;
    rig.rotation.x = -0.12 - p * 0.16;
    rig.rotation.z = 0.28 - p * 0.1;
    camera.position.z = (6.4 + p * 3.9) * (app.aspect < 0.8 ? 1.35 : 1);
    camera.lookAt(0, 0, 0);
  };

  app.update = () => {
    const p = reduced ? 0.6 : pinProgress(app.section);
    pose(p);
    app.renderer.render(app.scene, camera);
    const fade = reduced ? 1 : clamp((p - 0.12) * 4, 0, 1);
    for (const l of anatomyLabels) {
      l.seg.getWorldPosition(V).project(camera);
      const x = (V.x * 0.5 + 0.5) * app.w;
      const y = (-V.y * 0.5 + 0.5) * app.h;
      const shift = l.side === 'left' ? '-100%' : '0';
      l.el.style.transform =
        `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${shift},-50%)`;
      l.el.style.opacity = fade.toFixed(3);
    }
  };
}

/* ============================================================= FIVE BEATS
 * THE ROUTINE (draft-moves-v4.html variant A, 2026-08-23). The straight
 * 8-piece bar folds at its middle joint (4 + 4), the doubled stack folds
 * again at ITS middle joint into a 2-long 4-high block, the block hops a
 * full somersault — one hard click — then slams back open to straight.
 * Quarters (2-pc chains) are posed with explicit hinge matrices, because
 * fold 2 splits the fold-1 pair at its own middle joint (nested hinge
 * groups can't express that):
 *   Q1 fixed · Q2 θ2@P2 · Q3 θ2@P2·θ1@P1 · Q4 θ1@P1
 *   P1 = (0, R_CAP) · P2 = (−C, 3·R_CAP) · C = 2·STICK_STEP
 * Labels track FOLD / FOLD AGAIN / FLIP / SETTLE / RETURN. Reduced motion:
 * the static block, no label cycling. */
function buildBeats(darkEnv, mats) {
  const app = makeApp('beats-canvas', 'beats', 1.1, 0.56);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0x1b1a18);
  scene.environment = darkEnv;

  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-5, 7, 5);
  const rim = new THREE.DirectionalLight(0xffebd1, 0.9);
  rim.position.set(4, 0, -5);
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0x35322c, 0.3);
  scene.add(key, rim, hemi);

  const C = 2 * STICK_STEP;        // quarter pitch: every seam = STICK_STEP
  const R = R_CAP;                 // row spacing = one diameter = 2R
  const P1 = { x: 0, y: R };       // fold 1: middle joint's top tangent
  const P2 = { x: -C, y: 3 * R };  // fold 2: the stack's top tangent
  const BLOCK = { cx: -1.5 * C, cy: 3 * R };

  const M_A = new THREE.Matrix4(), M_B = new THREE.Matrix4(), M_R = new THREE.Matrix4();
  const hingeMat = (out, px, py, th) => {
    out.makeTranslation(px, py, 0);
    M_R.makeRotationZ(th);
    out.multiply(M_R);
    M_R.makeTranslation(-px, -py, 0);
    out.multiply(M_R);
    return out;
  };
  const makeQuarter = (cx) => {
    const g = new THREE.Group();
    const c = createChain(2, mats);
    c.rotation.z = -Math.PI / 2;   // chain local +Y → +X
    c.position.x = cx;
    g.add(c);
    g.matrixAutoUpdate = false;
    return g;
  };
  const assembly = new THREE.Group();
  assembly.matrixAutoUpdate = false;
  const quarters = [-1.5, -0.5, 0.5, 1.5].map((k) => makeQuarter(k * C));
  for (const q of quarters) assembly.add(q);
  scene.add(assembly);

  const snapLight = new THREE.PointLight(0xffffff, 0, 12);
  scene.add(snapLight);
  const SNAP_POS = [
    [P1.x, P1.y + 0.5], [P2.x, P2.y + 0.5], [BLOCK.cx, BLOCK.cy + 1.2],
  ];

  camera.fov = 32;
  let dWide = 40;
  let apex = 5.2; // toss height — shrinks on short-wide canvases so the
                  // airborne block stays inside the frame
  app.onFit = () => {
    const tanHalfW = Math.tan((camera.fov / 2) * DEG) * app.aspect;
    dWide = clamp((2 * C + 2.6) / tanHalfW, 16, 90);
    apex = clamp(6.8 / Math.max(app.aspect, 1.31), 2.2, 5.2);
  };

  // timeline: fold → fold again → toss flip → settle → slam-open return
  const A_BAL = 85 * DEG;
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const F1T = { r0: 0.25, r1: 0.95, h1: 1.10, f1: 1.34, s1: 1.85 };
  const F2T = { r0: 1.95, r1: 2.60, h1: 2.74, f1: 2.98, s1: 3.50 };
  const FLIP0 = 3.70, FLIP1 = 5.25;
  const U2T = { r0: 5.60, r1: 5.97, h1: 6.05, f1: 6.23, s1: 6.67 };
  const U1T = { r0: 6.75, r1: 7.12, h1: 7.20, f1: 7.38, s1: 7.82 };
  const P = 8.27;

  // one hinge move 0→π (dir=+1) or π→0 (dir=−1): press-lift to the balance
  // point, breath, gravity fall with the magnets grabbing, damped click
  const hingeTheta = (tt, tm, dir) => {
    const from = dir > 0 ? 0 : Math.PI;
    const to = Math.PI - from;
    const bal = dir > 0 ? A_BAL : Math.PI - A_BAL;
    if (tt < tm.r0) return { th: from, snap: 0 };
    if (tt < tm.r1) {
      const u = smoothstep(tm.r0, tm.r1, tt);
      const over = 3 * DEG * Math.sin(Math.PI * clamp((u - 0.75) / 0.25, 0, 1));
      return { th: lerp(from, bal, easeIO(u)) + dir * over, snap: 0 };
    }
    if (tt < tm.h1) {
      const w = tt - tm.r1;
      const sway = 2.2 * DEG * Math.sin(w * 2.1) + 0.5 * DEG * Math.sin(w * 9.7);
      return { th: bal + dir * sway, snap: 0 };
    }
    if (tt < tm.f1) {
      let u = clamp((tt - tm.h1) / (tm.f1 - tm.h1), 0, 1);
      u = u * u * (0.6 + 0.4 * u);
      return { th: lerp(bal, to, u), snap: 0 };
    }
    if (tt < tm.s1) {
      const w = tt - tm.f1;
      const b = Math.abs(0.10 * Math.exp(-7 * w) * Math.sin(24 * w));
      return { th: to === Math.PI ? Math.PI - b : b, snap: Math.exp(-9 * w) };
    }
    return { th: to, snap: 0 };
  };

  // the toss: wind-up tilt, ballistic hop, one full somersault, landing
  // click with a positional bounce (rigid piece — no squash)
  const flipToss = (w) => {
    const wind = 0.25, air = 0.55; // wind, flight, then settle
    if (w < wind) {
      return { phi: -7 * DEG * smoothstep(0, wind, w), lift: 0, snap: 0 };
    }
    if (w < wind + air) {
      const u = (w - wind) / air;
      return {
        phi: -7 * DEG * (1 - u) + 2 * Math.PI * (u * u * (3 - 2 * u)),
        lift: apex * 4 * u * (1 - u),
        snap: 0,
      };
    }
    const v = w - wind - air;
    return {
      phi: 0.05 * Math.exp(-6 * v) * Math.sin(17 * v),
      lift: Math.abs(0.55 * Math.exp(-7 * v) * Math.sin(22 * v)),
      snap: Math.exp(-9 * v),
    };
  };

  // full pose at loop-time tt: hinge angles, root toss, beat index
  const routine = (tt) => {
    let th1, th2 = 0, phi = 0, lift = 0, snap = 0, snapAt = 0, beat;
    if (tt < F2T.r0) {
      const a = hingeTheta(tt, F1T, 1);
      th1 = a.th; snap = a.snap; snapAt = 0; beat = 0;
    } else if (tt < U1T.r0) {
      th1 = Math.PI;
    } else {
      const a = hingeTheta(tt, U1T, -1);
      th1 = a.th; if (a.snap > snap) { snap = a.snap; snapAt = 0; }
    }
    if (tt >= F2T.r0 && tt < U2T.r0) {
      if (tt < FLIP0) {
        const a = hingeTheta(tt, F2T, 1);
        th2 = a.th; if (a.snap > snap) { snap = a.snap; snapAt = 1; }
        beat = 1;
      } else th2 = Math.PI;
    } else if (tt >= U2T.r0 && tt < U1T.r0) {
      const a = hingeTheta(tt, U2T, -1);
      th2 = a.th; if (a.snap > snap) { snap = a.snap; snapAt = 1; }
    }
    if (tt >= U2T.r0) beat = 4;
    if (tt >= FLIP0 && tt < U2T.r0) {
      beat = tt < FLIP1 ? 2 : 3;
      const f = flipToss(Math.min(tt - FLIP0, FLIP1 - FLIP0));
      phi = f.phi; lift = f.lift;
      if (f.snap > snap) { snap = f.snap; snapAt = 2; }
    }
    if (beat === undefined) beat = 0;
    return { th1, th2, phi, lift, snap, snapAt, beat };
  };

  const labels = document.querySelectorAll('.beats-labels .mono-label');
  let lastBeat = -1;
  const setBeat = (b) => {
    if (b === lastBeat || labels.length < 5) return;
    labels.forEach((el, i) => el.classList.toggle('beat-active', i === b));
    lastBeat = b;
  };

  let camF1 = 0, camF2 = 0, camAir = 0, cyAir = 0; // staged push-in + toss air boost
  app.update = (t) => {
    let th1, th2, phi = 0, lift = 0;
    if (reduced) {
      th1 = Math.PI; th2 = Math.PI; // static block
      snapLight.intensity = 0;
      if (lastBeat !== -1 && labels.length >= 5) {
        labels.forEach((el) => el.classList.remove('beat-active'));
        lastBeat = -1;
      }
      camF1 = 1; camF2 = 1; camAir = 0; cyAir = 0;
    } else {
      const tt = t - Math.floor(t / P) * P;
      const r = routine(tt);
      th1 = r.th1; th2 = r.th2; phi = r.phi; lift = r.lift;
      setBeat(r.beat);
      snapLight.intensity = 30 * r.snap;
      const sp = SNAP_POS[r.snapAt];
      snapLight.position.set(sp[0], sp[1], 0.5);
      // slow cinematic push-in on each fold; fast pull-out on the slam-open
      // so the straight bar never overflows the frame
      const f1 = clamp(th1 / Math.PI, 0, 1), f2 = clamp(th2 / Math.PI, 0, 1);
      camF1 += (f1 - camF1) * (f1 < camF1 ? 0.28 : 0.06);
      camF2 += (f2 - camF2) * (f2 < camF2 ? 0.28 : 0.06);
      // camera steps back during the wind-up so the whole jump stays framed;
      // the look-at only rises with the block itself, so the grounded block
      // never slides off the bottom of the frame
      const airT = (tt >= FLIP0 - 0.15 && tt < FLIP1 - 0.35) ? 1 : 0;
      camAir += (airT - camAir) * (airT > camAir ? 0.10 : 0.08);
      const cyT = (1.42 + 0.28 * apex) * camAir * clamp(lift / apex * 2, 0, 1);
      cyAir += (cyT - cyAir) * 0.25;
    }
    quarters[0].matrix.identity();
    hingeMat(quarters[1].matrix, P2.x, P2.y, th2);
    hingeMat(quarters[3].matrix, P1.x, P1.y, th1);
    hingeMat(M_A, P2.x, P2.y, th2);
    hingeMat(M_B, P1.x, P1.y, th1);
    quarters[2].matrix.multiplyMatrices(M_A, M_B);
    hingeMat(assembly.matrix, BLOCK.cx, BLOCK.cy, phi);
    M_A.makeTranslation(0, lift, 0);
    assembly.matrix.premultiply(M_A);

    const d = dWide * (1 - 0.34 * camF1 - 0.19 * camF2) * (1 + 0.85 * camAir);
    const cx = -C * camF1 - 0.5 * C * camF2;
    const cy = 0.5 + 2 * R * camF2 + cyAir;
    camera.position.set(cx + 2, d * 0.42, d * 0.86);
    camera.lookAt(cx, cy, 0);
    app.renderer.render(app.scene, camera);
  };
}

/* ============================================================= COLLECTION
 * DRAFT: the FULL SET — eight sticks in a staggered row (was a 2-stick
 * piece), gentle sway, ~30fps cap, paused offscreen (IO). Live color tint:
 * listens for 'magzin:color' CustomEvents (detail {hex}) dispatched by the
 * swatch buttons and cross-fades body + badge to the chosen store color. */
function buildCollection(lightEnv, matsBase) {
  const app = makeApp('collection-canvas', 'collection', 1.0, 0.5);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0xe6d8c3);
  scene.environment = lightEnv;

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-4, 6, 5);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 0.45);
  scene.add(key, hemi);

  const mats = buildTintMaterials(matsBase); // collection-only tintable copy

  // the set: 8 sticks side by side, alternating stagger, each rolled a
  // different amount so grain/wells/badges don't repeat
  const rig = new THREE.Group();
  const row = new THREE.Group();
  const GAP = 0.95;
  for (let i = 0; i < 8; i++) {
    const s = createSeamlessStick(mats);
    s.position.x = (i - 3.5) * GAP;
    s.position.y = (i % 2 ? 0.17 : -0.17);
    s.rotation.y = i * 0.77;
    row.add(s);
  }
  row.rotation.z = -0.16;   // slight diagonal energy, like the tilted cards
  rig.rotation.x = 0.38;    // tip the tops toward the camera
  rig.add(row);
  scene.add(rig);

  camera.fov = 32;
  app.onFit = () => {
    const tanHalfW = Math.tan((camera.fov / 2) * DEG) * Math.min(app.aspect, 1);
    camera.position.set(0, 0, clamp(5.2 / tanHalfW, 12, 30));
    camera.lookAt(0, 0, 0);
  };
  camera.position.set(0, 0, 18);
  camera.lookAt(0, 0, 0);

  // color state
  const cur = new THREE.Color(0x101820);
  const target = new THREE.Color(0x101820);
  window.addEventListener('magzin:color', (e) => {
    const hex = e.detail && e.detail.hex;
    if (!hex) return;
    target.set(hex);
    if (reduced) { // no animated fade under reduced motion — apply instantly
      cur.copy(target);
      mats.body.color.copy(target);
      mats.badge.color.copy(target);
    }
    app.dirty = true;
  });

  let last = -1;
  app.update = (t) => {
    // cross-fade toward the picked color; keep dirty so the fade animates
    // even through the 30fps cap and reduced-motion gating
    if (!cur.equals(target)) {
      cur.lerp(target, 0.14);
      if (Math.abs(cur.r - target.r) + Math.abs(cur.g - target.g) +
          Math.abs(cur.b - target.b) < 0.004) cur.copy(target);
      mats.body.color.copy(cur);
      mats.badge.color.copy(cur);
      app.dirty = true;
    }
    if (!reduced) {
      if (t - last < 1 / 30 && !app.dirty) return; // 30fps cap
      last = t;
      rig.rotation.y = Math.sin(t * 0.22) * 0.34;  // sway, never edge-on
      rig.position.y = Math.sin(t * 0.25) * 0.07;
    }
    app.renderer.render(app.scene, camera);
  };
}

/* ------------------------------------------------------------------ init */
function init() {
  try {
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = rmq.matches;
    if (rmq.addEventListener) {
      rmq.addEventListener('change', (e) => {
        reduced = e.matches;
        for (const a of apps) a.dirty = true;
      });
    }

    lang = (document.documentElement.classList.contains('lang-ar') ||
      document.documentElement.lang === 'ar') ? 'ar' : 'en';
    window.addEventListener('magzin:lang', (e) => {
      lang = (e.detail && e.detail.lang) === 'ar' ? 'ar' : 'en';
      refreshLabelText();
      for (const a of apps) a.dirty = true;
    });

    const darkEnv = buildEnvTexture('dark');
    const lightEnv = buildEnvTexture('light');
    const mats = buildMaterials(false);
    const matsLight = buildMaterials(true);

    buildHero(darkEnv, mats);
    buildPull(darkEnv, mats);
    buildAnatomy(lightEnv, matsLight);
    buildBeats(darkEnv, mats);
    buildCollection(lightEnv, matsLight);

    if (!apps.length) {
      console.warn(`${TAG} no 3D canvases found — module idle.`);
      return;
    }

    // per-section render pausing
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const a = apps.find((x) => x.section === en.target || x.canvas === en.target);
        if (a) {
          a.visible = en.isIntersecting;
          if (a.visible) a.dirty = true;
        }
      }
    }, { rootMargin: '80px' });
    for (const a of apps) io.observe(a.section);

    // NOTE: no ResizeObserver on the canvases on purpose — if the page CSS
    // does not constrain a canvas, renderer.setSize() changing the attribute
    // size would re-trigger the observer in a feedback loop. Window resize +
    // load cover the contract cases (canvases are CSS-sized by the layout).
    const fitAll = () => { for (const a of apps) a.fit(); };
    fitAll();
    window.addEventListener('resize', fitAll);
    window.addEventListener('load', fitAll);

    // debug hook: force every scene to render at time t, bypassing the
    // visible/dirty gating — rAF is fully suspended in occluded/automation
    // tabs, so headless verification (and perf debugging) must use this.
    window.__p3dRender = (t = 0) => {
      for (const a of apps) { a.dirty = true; a.update(t); }
    };

    // one rAF loop drives every visible scene
    const loop = (ms) => {
      requestAnimationFrame(loop);
      const t = ms / 1000;
      for (const a of apps) {
        if (!a.visible) continue;
        // reduced motion → every scene holds a static pose; render only when
        // something changed (resize / visibility / language)
        if (reduced && !a.dirty) continue;
        a.update(t);
        a.dirty = false;
      }
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.warn(`${TAG} init failed:`, err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

/* ---- shared builders for draft comparison pages (draft-flip-motions.html).
 * The module still self-initializes above; on pages without the site's
 * canvases each scene no-ops with a console.warn, which is expected. */
export {
  buildEnvTexture, buildMaterials, createSeamlessStick, createChain,
  chainHalf, makeRenderer, STICK_LEN, STICK_STEP, R_CAP,
};
