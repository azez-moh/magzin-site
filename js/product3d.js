/*
 * MAGZIN — product3d.js
 * Cinematic 3D product scenes (hero / pull / anatomy / beats / collection).
 * Owned by the 3D agent per CONTRACT.md. Reads index.html DOM, never edits it.
 * Three.js r164, vendored. No other dependencies.
 *
 * Material truth (Motion/"MAGZIN product (matches CAD).png", user-confirmed):
 * molded polypropylene body — molded finish with coarse orange-peel grain,
 * NOT paint, NOT machined metal; recessed neodymium magnets (warm gold-toned
 * plating); black-on-black debossed stadium MAGZIN plate on the middle band.
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
const HOLE_PHI = [62, 118, 242, 298]; // texture phi = 90° − θ, for θ = ±28°

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
        + (n1(u, v) - 0.5) * 0.30
        + (n2(u, v) - 0.5) * 0.46
        + (n3(u, v) - 0.5) * 0.22
        + (rand() - 0.5) * 0.08;
    }
  }
  // hair-thin raised parting-line seams where the mold halves meet (u=0 wraps)
  for (const cx of [0, TEXW / 2]) {
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

  // roughness: waxy PP mean ≈ 0.70, peaks matter more than pits
  const rcv = document.createElement('canvas');
  rcv.width = TEXW; rcv.height = TEXH;
  const rc = rcv.getContext('2d');
  const rimg = rc.createImageData(TEXW, TEXH);
  for (let i = 0; i < h.length; i++) {
    const g = clamp(0.70 + (h[i] - 0.5) * 0.30, 0.3, 1) * 255;
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

  const normalTex = new THREE.CanvasTexture(ncv);
  const roughTex = new THREE.CanvasTexture(rcv);
  for (const t of [normalTex, roughTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  BODY_MAPS = { normalTex, roughTex };
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

function buildBadgeCanvases() {
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
    c.fillStyle = BODY_CSS;
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

/* -------------------------------------------------------------- materials */
function buildMaterials(light) {
  // Molded polypropylene, molded finish — not paint: zero metalness, waxy
  // low-gloss sheen broken up by the grain (normal + roughness maps).
  const bm = bodyMaps();
  const body = new THREE.MeshStandardMaterial({
    color: 0x26272B, metalness: 0.0, roughness: 1.0,
    normalMap: bm.normalTex, normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: bm.roughTex,
    envMapIntensity: 1.0,
  });
  // unlit near-black interior = the depth shadow inside a real recessed well
  const holeWall = new THREE.MeshBasicMaterial({ color: 0x0b0a09, side: THREE.BackSide });
  const holeRim = new THREE.MeshBasicMaterial({ color: 0x0b0a09, side: THREE.DoubleSide });
  // neodymium magnet (warm gold-toned plating) sunk in shadow — soft metal,
  // glints only when the well lines up with the light
  const dot = new THREE.MeshStandardMaterial({
    color: 0xB28E4F, metalness: 1.0, roughness: 0.52,
    envMapIntensity: light ? 1.0 : 1.1,
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
    const s = Math.max(0.05, r + d * taperTip * taperBadge - dip) / r;
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
 * photo: dark chamfer ring at the mouth + unlit tapered wall + brass disc
 * sunk 0.055 deep. At grazing angles the wall hides the brass — dark hole,
 * exactly like most holes in the photo; face-on it glints. */
function wellMatrices(gyList, yOff) {
  const FWD = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const rims = [], walls = [], brass = [];
  for (const gy of gyList) {
    for (const phi of HOLE_PHI) {
      const th = (90 - phi) * DEG;
      const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      const qF = new THREE.Quaternion().setFromUnitVectors(FWD, dir);
      const qU = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      // +headroom over the curved, undulating surface so the rim clears it
      const surf = stickRadius(Math.abs(gy)) + 0.016;
      const at = (q, radial) => new THREE.Matrix4().compose(
        new THREE.Vector3(dir.x * radial, gy - yOff, dir.z * radial), q, one);
      rims.push(at(qF, surf));
      walls.push(at(qU, surf - 0.048)); // wall spans surf+0.002 … surf−0.098
      brass.push(at(qF, surf - 0.055));
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
    GEO.badge = new THREE.CylinderGeometry(
      R_MID + 0.012, R_MID + 0.012, 0.62, 48, 1, true, -0.48, 0.96);
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
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
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
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
      txt.style.cssText =
        'color:#1b1a18;white-space:nowrap;text-transform:uppercase;';
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
 * One dark canvas, five scissor cells: the same two-stick hinge flip frozen
 * at RELEASE / FALL / ARRIVE / SETTLE / RETURN, each oscillating ±2°. */
function buildBeats(darkEnv, mats) {
  const app = makeApp('beats-canvas', 'beats', 1.1, 0.56);
  if (!app) return;
  const { scene, camera, renderer } = app;
  scene.environment = darkEnv;
  renderer.autoClear = false;

  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-5, 7, 5);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(4, 0, -5);
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0x35322c, 0.3);
  scene.add(key, rim, hemi);

  // hinge: stick A fixed along +X ending at origin; stick B folds over it,
  // pivot at the magnet contact tangent (0, r, 0)
  const asm = new THREE.Group();
  const sA = createSeamlessStick(mats);
  sA.rotation.z = -Math.PI / 2;
  sA.position.set(-STICK_LEN / 2, 0, 0);
  const hinge = new THREE.Group();
  hinge.position.set(0, R_TIP, 0); // pivot at the magnet contact tangent
  const sB = createSeamlessStick(mats);
  sB.rotation.z = -Math.PI / 2;
  sB.position.set(STICK_LEN / 2, -R_TIP, 0);
  hinge.add(sB);
  asm.add(sA, hinge);
  asm.rotation.set(0.12, 0.42, -0.05);
  scene.add(asm);

  camera.fov = 32;
  const POSES = [0.14, 1.08, 2.35, 3.1, 0.55]; // RELEASE FALL ARRIVE SETTLE RETURN
  let cellW = 100, camZ = 20;
  app.onFit = () => {
    cellW = app.w / 5;
    const cellAspect = cellW / app.h;
    camera.aspect = cellAspect;
    camZ = clamp(8.6 / (2 * Math.tan((camera.fov / 2) * DEG) * cellAspect), 13, 46);
  };

  app.update = (t) => {
    renderer.setScissorTest(false);
    renderer.setClearColor(0x1b1a18, 1);
    renderer.clear();
    renderer.setScissorTest(true);
    renderer.setClearColor(0x24221e, 1);
    camera.position.set(0, 0.5, camZ);
    camera.lookAt(0, 0.5, 0);
    for (let i = 0; i < 5; i++) {
      const osc = reduced ? 0 : Math.sin(t * 0.9 + i * 1.7) * 0.035; // ±2°
      hinge.rotation.z = POSES[i] + osc;
      const x = Math.round(i * cellW);
      renderer.setViewport(x, 0, Math.round(cellW), app.h);
      renderer.setScissor(x + 1, 0, Math.round(cellW) - 2, app.h);
      renderer.clear();
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false);
  };
}

/* ============================================================= COLLECTION
 * Light card slot: a connected 2-stick piece floating diagonally, very slow
 * rotation, soft studio light, ~30fps cap, paused offscreen (IO). */
function buildCollection(lightEnv, matsLight) {
  const app = makeApp('collection-canvas', 'collection', 1.0, 0.5);
  if (!app) return;
  const { scene, camera } = app;
  scene.background = new THREE.Color(0xe6d8c3);
  scene.environment = lightEnv;

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-4, 6, 5);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 0.45);
  scene.add(key, hemi);

  // turntable: outer rig spins slowly around Y, the piece itself is tilted
  // diagonally so the spin reads (a cylinder spinning on its own axis would
  // look static)
  const rig = new THREE.Group();
  const piece = createChain(2, matsLight);
  piece.rotation.set(0.12, 0, -0.55);
  rig.add(piece);
  scene.add(rig);

  camera.fov = 32;
  camera.position.set(0, 0, 10.5);
  camera.lookAt(0, 0, 0);
  app.onFit = () => { rig.scale.setScalar(clamp(app.aspect, 0.72, 1)); };

  let last = -1;
  app.update = (t) => {
    if (!reduced) {
      if (t - last < 1 / 30 && !app.dirty) return; // 30fps cap
      last = t;
      rig.rotation.y = t * 0.12;
      rig.position.y = Math.sin(t * 0.25) * 0.08;
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
