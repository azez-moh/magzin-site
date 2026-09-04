/* MAGZIN — 03 PLAYGROUND
   Four hanging pairs of magnetic sticks (8 pieces, attached in doubles) on a pin rail.
   Owned by the PHYSICS agent (see site/CONTRACT.md — do not edit index.html/css from here).

   Physics is LAW, per assets/magzin-swing-params.json:
     alpha = (3/N) * ( -G*sin(theta) - K*wrap(theta)*exp(-(theta/falloff)^2) ) - c*omega
     (theta measured from the straight-down rest; both torque terms restore toward it,
      matching the tuned toy: gravity hangs the pair down, magnet holds it there)
     bottom-contact restitution: omega *= 0.15 + 0.45*overshootAmount per bottom crossing
     length scaling for an N-piece pendulum: torques x 3/N, rates x sqrt(3/N), rests x sqrt(N/3)
     integration: 120 Hz fixed-step semi-implicit Euler, accumulator + render interpolation.
   Here each pendulum is a double => N = 2.
*/

const N_PIECES = 2;            // two 35mm sticks end-to-end per hanging pair
const STEP = 1 / 120;          // timestepHz: 120
const TAU = Math.PI * 2;

export const DEFAULT_PARAMS = {
  // fallback copy of assets/magzin-swing-params.json (file:// / fetch-failure case)
  gravityStrength: 26,
  angularDamping: 0.06,
  magneticHoldTorque: 32,
  holdFalloffDeg: 18,
  restTopSec: 0.45,
  restBottomSec: 0.35,
  returnSwingSpeed: 1,
  overshootAmount: 0.4,
  pieceCount: 8,
  pieceLengthMm: 35,
  pieceDiameterMm: 5,
  motionBlurStrength: 0.4
};

export function wrapPi(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

export function deriveSim(p) {
  const n = N_PIECES;
  const torqueScale = 3 / n;             // torques x 3/N
  const rateScale = Math.sqrt(3 / n);    // rates x sqrt(3/N) (falls out of the torque scale)
  const restScale = Math.sqrt(n / 3);    // rests x sqrt(N/3)
  return {
    G: p.gravityStrength,
    K: p.magneticHoldTorque,
    c: p.angularDamping,
    falloff: (p.holdFalloffDeg * Math.PI) / 180,
    torqueScale,
    rateScale,
    restScale,
    restitution: 0.15 + 0.45 * p.overshootAmount,
    restTop: p.restTopSec * restScale,    // idle-swing dwell (used to pace idle gusts)
    restBottom: p.restBottomSec * restScale, // used as neighbor-click cooldown
    speed: p.returnSwingSpeed,
    blur: p.motionBlurStrength,
    pairLenMm: n * p.pieceLengthMm,       // 70mm double
    pieceLenMm: p.pieceLengthMm,
    diaMm: p.pieceDiameterMm
  };
}

/* One 120Hz semi-implicit Euler step for a hanging pair.
   st: { th (unwrapped rad, 0 = straight down), om (rad/s), armed (bool) }
   pivotAlpha: pendulum-on-moving-pivot coupling (-a_pin*cos(theta)/L), extraAlpha: air noise.
   Returns true when a bottom-contact restitution crossing fired.
   "armed" requires the pair to have left the bottom (>~0.9deg) since the last crossing,
   so a fling released exactly at the hang point isn't killed on frame one and rest
   micro-jitter never restitutes; every real swing/rotation re-arms within one step. */
export function stepPendulum(st, sim, h, pivotAlpha = 0, extraAlpha = 0) {
  const w = wrapPi(st.th);
  const q = w / sim.falloff;
  const alpha =
    sim.torqueScale * (-sim.G * Math.sin(w) - sim.K * w * Math.exp(-(q * q))) -
    sim.c * st.om +
    pivotAlpha +
    extraAlpha;
  st.om += alpha * h;                    // semi-implicit: velocity first,
  st.th += st.om * h;                    // then position with the new velocity
  const after = wrapPi(st.th);
  const crossedBottom =
    ((w > 0 && after < 0) || (w < 0 && after > 0)) &&
    Math.abs(w) < 1.2 && Math.abs(after) < 1.2; // through the bottom, not over the top
  if (crossedBottom && st.armed) {
    st.om *= sim.restitution;            // omega *= 0.15 + 0.45*overshoot
    st.armed = false;
    return true;
  }
  if (Math.abs(after) > 0.015) st.armed = true;
  return false;
}

/* ------------------------------------------------------------------ DOM app */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const nowSec = () => performance.now() / 1000;

const BG = '#f8f4ed';          // brand off-white (magzin guideline)
const NAVY = '#1b1a18';        // playground stick finish — brand ink
const NAVY_HI = '#3a3733';
const NAVY_LO = '#111009';
const ACCENT = '#6e8f6a';      // brand green — small CTA/interactive touches

/* seeded tiling noise for the molded-grain overlay (semi-transparent gray
   pixels: light specks show on the ink body). Seeded so reloads are
   pixel-identical, matching the 3D scenes' deterministic grain. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const noiseCanvas = (() => {
  const rand = mulberry32(1618033);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  const img = c.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = Math.floor(rand() * 256);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
    img.data[i + 3] = 12;
  }
  c.putImageData(img, 0, 0);
  return cv;
})();

function init() {
  const canvas = document.getElementById('playground-canvas');
  if (!canvas) {
    console.warn('[playground] #playground-canvas missing — playground disabled.');
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[playground] 2d context unavailable — playground disabled.');
    return;
  }
  const resetBtn = document.getElementById('playground-reset');
  if (!resetBtn) console.warn('[playground] #playground-reset missing — reset disabled.');

  let params = { ...DEFAULT_PARAMS };
  let sim = deriveSim(params);

  const mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mql && mql.matches);
  if (mql && mql.addEventListener) mql.addEventListener('change', (e) => { reduced = e.matches; });

  /* ---- world state ---- */
  let W = 0, Hc = 0, dpr = 1, gap = 0, L = 120, railY = 0, pxMm = 1, stickW = 5;
  let layoutOk = false;

  const pins = [];
  const pairs = [];
  for (let i = 0; i < 4; i++) {
    pins.push({
      idx: i, fx: (i + 1) / 5,
      x: 0, prevX: 0, vx: 0, ax: 0,
      drag: null, targetX: 0, tween: null
    });
    pairs.push({
      idx: i, pin: pins[i],
      th: 0, prevTh: 0, om: 0, armed: false,
      drag: null, tween: null,
      noise: 0, gust: 0, gustDur: 0, gustDur0: 1,
      gustT: 3 + Math.random() * 6
    });
  }
  if (!reduced) for (const pr of pairs) pr.th = pr.prevTh = (Math.random() - 0.5) * 0.22;

  const flashes = [];                 // neighbor-click ticks {x,y,age}
  const clickCooldown = [0, 0, 0];    // per adjacent gap
  let slowTimer = 0;                  // 1-frame "freeze feel" timescale dip

  /* ---- layout ---- */
  function layout() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; Hc = rect.height;
    if (W < 10 || Hc < 10) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr), bh = Math.round(Hc * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    gap = W / 5;
    // fit: headroom above the rail for full over-the-top rotations, room below to hang
    L = Math.max(30, Math.min((Hc - 70) / 2, 0.95 * gap));
    railY = clamp(Hc * 0.3, L + 26, Hc - L - 44);
    pxMm = L / sim.pairLenMm;
    stickW = Math.max(3, sim.diaMm * pxMm);
    for (const p of pins) { p.x = p.prevX = p.fx * W; p.vx = 0; p.ax = 0; }
    return true;
  }

  /* ---- fixed-step simulation ---- */
  function stepWorld(h) {
    // pins (horizontal rail)
    for (const p of pins) {
      p.prevX = p.x;
      const oldV = p.vx, oldX = p.x;
      if (p.drag) {
        const k = 600, d = 2 * Math.sqrt(k);          // critically damped follow
        const a = k * (p.targetX - p.x) - d * p.vx;
        p.vx += a * h;
        p.x += p.vx * h;
      } else if (p.tween) {
        const tw = p.tween;
        tw.t += h;
        const u = Math.min(1, tw.t / tw.dur);
        p.x = tw.from + (tw.to - tw.from) * easeInOut(u);
        p.vx = (p.x - oldX) / h;
        if (u >= 1) { p.tween = null; p.vx = 0; }
      } else if (p.vx !== 0) {
        p.vx *= Math.max(0, 1 - 10 * h);
        if (Math.abs(p.vx) < 0.5) p.vx = 0;
        p.x += p.vx * h;
      }
      p.x = clamp(p.x, gap * 0.25, W - gap * 0.25);
      p.ax = clamp((p.vx - oldV) / h, -9000, 9000);   // pivot acceleration for coupling
      p.fx = p.x / W;
    }

    // pairs
    for (const pr of pairs) {
      pr.prevTh = pr.th;
      if (pr.drag) {
        // critically damped chase of the pointer angle — slight lag for weight
        const k = 260, d = 2 * Math.sqrt(k) * 1.05;
        const a = k * (pr.drag.targetTh - pr.th) - d * pr.om;
        pr.om = clamp(pr.om + a * h, -60, 60);
        pr.th += pr.om * h;
        pr.drag.hist.push({ t: nowSec(), th: pr.drag.targetTh });
        if (pr.drag.hist.length > 48) pr.drag.hist.splice(0, pr.drag.hist.length - 48);
      } else if (pr.tween) {
        const tw = pr.tween;
        tw.t += h;
        const u = Math.min(1, tw.t / tw.dur);
        const nth = tw.from + (tw.to - tw.from) * easeInOut(u);
        pr.om = (nth - pr.th) / h;
        pr.th = nth;
        if (u >= 1) { pr.tween = null; pr.th = 0; pr.om = 0; pr.armed = false; }
      } else {
        let ext = 0;
        if (!reduced) {
          // barely-visible air sway: OU torque noise + an occasional soft gust
          pr.noise += -2.2 * pr.noise * h + (Math.random() - 0.5) * 1.1 * Math.sqrt(h);
          ext += pr.noise * 3;
          pr.gustT -= h;
          if (pr.gustT <= 0) {
            pr.gust = (Math.random() - 0.5) * 3;
            pr.gustDur0 = pr.gustDur = 0.5 + Math.random() * 0.5;
            pr.gustT = sim.restTop + 4 + Math.random() * 7;
          }
          if (pr.gustDur > 0) {
            ext += pr.gust * Math.sin(Math.PI * (pr.gustDur / pr.gustDur0));
            pr.gustDur -= h;
          }
        }
        // pendulum on a moving pivot: -a_pin * cos(theta) / L
        const piv = clamp(-(pr.pin.ax / L) * Math.cos(wrapPi(pr.th)), -400, 400);
        stepPendulum(pr, sim, h, piv, ext);
        if (Math.abs(pr.om) > 80) pr.om = 80 * Math.sign(pr.om);
      }
    }

    neighborStep(h);
    for (let i = 0; i < 3; i++) if (clickCooldown[i] > 0) clickCooldown[i] -= h;
  }

  // adjacent-pair magnetic attraction + click at bottom-tip contact
  function neighborStep(h) {
    const order = [...pairs].sort((a, b) => a.pin.x - b.pin.x);
    const range = sim.pieceLenMm * pxMm;             // ~one piece length
    const contact = Math.max(4, stickW * 1.15);
    for (let i = 0; i < 3; i++) {
      const A = order[i], B = order[i + 1];
      if (A.tween || B.tween) continue;
      if (Math.abs(wrapPi(A.th)) > 1.5 || Math.abs(wrapPi(B.th)) > 1.5) continue; // hanging-ish only
      const ax = A.pin.x + L * Math.sin(A.th), ay = railY + L * Math.cos(A.th);
      const bx = B.pin.x + L * Math.sin(B.th), by = railY + L * Math.cos(B.th);
      const dx = bx - ax, dy = by - ay;
      const d = Math.hypot(dx, dy);
      if (d >= range || d < 1e-6) continue;
      const ux = dx / d, uy = dy / d;
      const tAx = Math.cos(A.th), tAy = -Math.sin(A.th);  // tip tangent directions
      const tBx = Math.cos(B.th), tBy = -Math.sin(B.th);
      const dotA = ux * tAx + uy * tAy;
      const dotB = ux * tBx + uy * tBy;
      if (d > contact) {
        // brief mutual attraction impulse, growing as tips near
        const s = 22 * (1 - d / range);
        A.om += s * dotA * h;
        B.om -= s * dotB * h;
      } else if (clickCooldown[i] <= 0) {
        const closing =
          (A.om * L * tAx - B.om * L * tBx) * ux +
          (A.om * L * tAy - B.om * L * tBy) * uy;   // >0 when tips approach
        if (closing > 25) {
          const e = 0.35;
          const jm = ((1 + e) * closing) / 2;
          A.om -= (jm * dotA) / L;
          B.om += (jm * dotB) / L;
          clickCooldown[i] = Math.max(0.25, sim.restBottom);
          if (!reduced) {
            flashes.push({ x: (ax + bx) / 2, y: (ay + by) / 2, age: 0 });
            slowTimer = 0.055;                       // tiny timescale dip = freeze feel
          }
        }
      }
    }
  }

  /* ---- rendering ----
     Real product silhouette (factory CAD Sheet1.dxf, measured): each stick is
     a NEAR-UNIFORM molded PP cylinder — Ø8.1 end blocks, Ø7.85 collar,
     Ø6.8 middle (a subtle molded step, not a dog-bone), with small magnet
     wells recessed into the wall near each end. Seamless one-piece read:
     faint molded grain + soft-fading sheen, no hard internal boundaries —
     only the middle joint seam where two sticks meet is kept. */
  const grainPattern = ctx.createPattern(noiseCanvas, 'repeat');
  function pairBodyPath(len, R) {
    const half = len / 2; // one stick
    const wAt = (y) => {
      const u = (y % half) / half;                     // 0..1 along a single stick
      const a = Math.min(u, 1 - u);                    // distance from nearest tip
      if (a < 0.16) return R;                          // Ø8.1 end block
      if (a < 0.27) return R * 0.97;                   // Ø7.85 collar
      if (a < 0.31) {                                  // gentle blend to middle
        const t = (a - 0.27) / 0.04;
        return R * (0.97 - 0.13 * t * t * (3 - 2 * t));
      }
      return R * 0.84;                                 // Ø6.8 middle body
    };
    const S = 28; // edge samples for the whole pair
    ctx.beginPath();
    ctx.arc(0, R, R, Math.PI, 0);                      // top tip cap
    for (let i = 0; i <= S; i++) {                     // right edge, down
      const y = R + (len - 2 * R) * (i / S);
      ctx.lineTo(wAt(y), y);
    }
    ctx.arc(0, len - R, R, 0, Math.PI);                // bottom tip cap
    for (let i = S; i >= 0; i--) {                     // left edge, up
      const y = R + (len - 2 * R) * (i / S);
      ctx.lineTo(-wAt(y), y);
    }
    ctx.closePath();
  }

  function drawPair(px, th, alpha, ghost) {
    ctx.save();
    ctx.translate(px, railY);
    ctx.rotate(-th);
    ctx.globalAlpha = alpha;
    const w = stickW, r = w / 2;
    if (ghost) {
      pairBodyPath(L, r);
      ctx.fillStyle = NAVY;
      ctx.fill();
      ctx.restore();
      return;
    }
    // soft offset drop shadow onto the paper background (~8% black)
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowOffsetX = 4 * dpr;
    ctx.shadowOffsetY = 9 * dpr;
    pairBodyPath(L, r);
    const grad = ctx.createLinearGradient(0, 0, 0, L);
    grad.addColorStop(0, NAVY_HI);
    grad.addColorStop(0.5, NAVY);
    grad.addColorStop(1, NAVY_LO);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // details clipped inside the body silhouette
    ctx.save();
    pairBodyPath(L, r);
    ctx.clip();
    const half = L / 2;
    const bl = 0.16 * half;                            // Ø8.1 end block (per CAD)
    // faint molded grain over the base gradient
    ctx.fillStyle = grainPattern;
    ctx.fillRect(-r, 0, w, L);
    // sheen with soft-fading edges — no hard boundary inside a stick
    const soft = (y0, y1, stops) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      for (const [p2, a2] of stops) g.addColorStop(p2, `rgba(255,255,255,${a2 * 0.05})`);
      ctx.fillStyle = g;
      ctx.fillRect(-r, y0, w, y1 - y0);
    };
    soft(0, bl * 1.6, [[0, 1], [0.55, 1], [1, 0]]);
    soft(half - bl * 1.6, half + bl * 1.6, [[0, 0], [0.3, 1], [0.7, 1], [1, 0]]);
    soft(L - bl * 1.6, L, [[0, 0], [0.45, 1], [1, 1]]);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';                // joint seam where the sticks meet — KEPT
    ctx.fillRect(-r, half - 0.5, w, 1);
    // brass magnet dots recessed into the wall near each stick end (per CAD:
    // ~2.85 mm and ~7.85 mm from each tip, two offset rows)
    const dr = Math.max(0.6, r * 0.14);
    const d1 = 0.078 * half, d2 = 0.214 * half;
    ctx.fillStyle = 'rgba(178,142,79,0.85)';
    for (const y of [d1, d2, half - d2, half - d1,
                     half + d1, half + d2, L - d2, L - d1]) {
      for (const dx of [-r * 0.35, r * 0.35]) {
        ctx.beginPath();
        ctx.arc(dx, y, dr, 0, TAU);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';        // machined sheen
    ctx.lineWidth = Math.max(1, w * 0.18);
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, r * 0.8);
    ctx.lineTo(-w * 0.2, L - r * 0.8);
    ctx.stroke();
    ctx.restore();

    pairBodyPath(L, r);
    ctx.strokeStyle = 'rgba(27,26,24,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function render(ai) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, Hc);

    // rail
    ctx.strokeStyle = 'rgba(10,10,10,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gap * 0.2, railY + 0.5);
    ctx.lineTo(W - gap * 0.2, railY + 0.5);
    ctx.stroke();

    for (const pr of pairs) {
      const th = pr.prevTh + (pr.th - pr.prevTh) * ai;
      const px = pr.pin.prevX + (pr.pin.x - pr.pin.prevX) * ai;
      // faint velocity-stretched afterimage when swinging fast
      if (!reduced && sim.blur > 0) {
        const sp = Math.abs(pr.om);
        if (sp > 7) {
          const f = Math.min(1, (sp - 7) / 12);
          for (let k = 1; k <= 2; k++) {
            drawPair(px, th - pr.om * 0.013 * k, (0.34 * sim.blur * f) / k, true);
          }
        }
      }
      drawPair(px, th, 1, false);
    }

    // pins on top of the sticks' pivot ends
    for (const p of pins) {
      const px = p.prevX + (p.x - p.prevX) * ai;
      const active = p.drag || pairs[p.idx].drag;
      ctx.beginPath();
      ctx.arc(px, railY, 4.5, 0, TAU);
      ctx.fillStyle = '#1b1a18';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, railY, active ? 9 : 8, 0, TAU);
      ctx.strokeStyle = active ? ACCENT : 'rgba(10,10,10,0.28)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
    }

    // click flashes
    for (const f of flashes) {
      const a = f.age / 0.16;
      const rr = 3 + 16 * a;
      ctx.globalAlpha = 1 - a;
      ctx.strokeStyle = 'rgba(191,216,236,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr + 1.5, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr, 0, TAU);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const an = Math.PI / 4 + (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(an) * (rr + 2), f.y + Math.sin(an) * (rr + 2));
        ctx.lineTo(f.x + Math.cos(an) * (rr + 7), f.y + Math.sin(an) * (rr + 7));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---- frame loop: accumulator + interpolation ---- */
  let raf = 0, running = false, lastT = 0, acc = 0;

  function frame(t) {
    raf = 0;
    if (!running) return;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);

    if (slowTimer > 0) slowTimer -= dt;                    // real-time effects
    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].age += dt;
      if (flashes[i].age > 0.16) flashes.splice(i, 1);
    }

    if (!layoutOk) layoutOk = layout();                    // canvas may size in late
    if (layoutOk) {
      const ts = slowTimer > 0 ? 0.12 : 1;                 // freeze-feel dip
      acc += dt * ts * sim.speed;                          // returnSwingSpeed scales sim time
      let n = 0;
      while (acc >= STEP && n < 48) { stepWorld(STEP); acc -= STEP; n++; }
      if (n === 48) acc = 0;                               // spiral-of-death guard
      render(clamp(acc / STEP, 0, 1));
    }
    raf = requestAnimationFrame(frame);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) {
      lastT = performance.now();
      acc = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* ---- interaction ---- */
  const drags = new Map(); // pointerId -> {type:'pin'|'pair', p}
  canvas.style.touchAction = 'none';

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function distToPair(pr, pt) {
    const x0 = pr.pin.x, y0 = railY;
    const vx = L * Math.sin(pr.th), vy = L * Math.cos(pr.th);
    const t = clamp(((pt.x - x0) * vx + (pt.y - y0) * vy) / (L * L), 0, 1);
    return Math.hypot(pt.x - (x0 + vx * t), pt.y - (y0 + vy * t));
  }

  function hitTest(pt, touch) {
    const pinRad = touch ? 26 : 15;
    for (const p of pins) {
      const dx = pt.x - p.x, dy = pt.y - railY;
      if (dx * dx + dy * dy < pinRad * pinRad) return { type: 'pin', p };
    }
    const reach = (touch ? 24 : 14) + stickW / 2;
    let best = null, bestD = reach;
    for (const pr of pairs) {
      const d = distToPair(pr, pt);
      if (d < bestD) { bestD = d; best = pr; }
    }
    return best ? { type: 'pair', p: best } : null;
  }

  function onDown(e) {
    if (!layoutOk) return;
    const pt = pointerPos(e);
    const target = hitTest(pt, e.pointerType === 'touch');
    if (!target) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    drags.set(e.pointerId, target);
    canvas.style.cursor = 'grabbing';
    if (target.type === 'pin') {
      const p = target.p;
      p.tween = null;
      p.targetX = p.x;
      p.drag = { id: e.pointerId, grabDx: pt.x - p.x };
    } else {
      const pr = target.p;
      pr.tween = null;
      const dx = pt.x - pr.pin.x, dy = pt.y - railY;
      const ang = Math.atan2(dx, dy); // theta from straight-down
      pr.drag = {
        id: e.pointerId,
        offset: wrapPi(wrapPi(pr.th) - ang), // no snap at grab point
        targetTh: pr.th,
        hist: [{ t: nowSec(), th: pr.th }]
      };
    }
  }

  function onMove(e) {
    const d = drags.get(e.pointerId);
    const pt = pointerPos(e);
    if (!d) {
      if (e.pointerType === 'mouse' && layoutOk) {
        canvas.style.cursor = hitTest(pt, false) ? 'grab' : '';
      }
      return;
    }
    e.preventDefault();
    if (d.type === 'pin') {
      const p = d.p;
      let tx = pt.x - p.drag.grabDx;
      const minSep = Math.max(26, gap * 0.3);
      for (const o of pins) {
        if (o === p) continue;
        if (o.x < p.x) tx = Math.max(tx, o.x + minSep);
        else tx = Math.min(tx, o.x - minSep);
      }
      p.targetX = clamp(tx, gap * 0.25, W - gap * 0.25);
    } else {
      const pr = d.p;
      const dx = pt.x - pr.pin.x, dy = pt.y - railY;
      if (dx * dx + dy * dy < 64) return; // too close to the pin — angle unstable
      const raw = Math.atan2(dx, dy) + pr.drag.offset;
      const prev = pr.drag.targetTh;
      pr.drag.targetTh = raw + TAU * Math.round((prev - raw) / TAU); // continuous over the top
      pr.drag.hist.push({ t: nowSec(), th: pr.drag.targetTh });
    }
  }

  function onUp(e) {
    const d = drags.get(e.pointerId);
    if (!d) return;
    drags.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    canvas.style.cursor = '';
    if (d.type === 'pin') {
      d.p.drag = null;
    } else {
      const pr = d.p;
      if (pr.drag) {
        // throw: angular velocity from the recent pointer travel (last ~120ms)
        const hist = pr.drag.hist, tn = nowSec();
        let first = null;
        const last = hist[hist.length - 1];
        for (let i = hist.length - 1; i >= 0; i--) {
          if (tn - hist[i].t <= 0.12) first = hist[i];
          else break;
        }
        if (first && last && last.t - first.t > 0.016) {
          pr.om = clamp((last.th - first.th) / (last.t - first.t), -45, 45);
        }
        pr.drag = null;
        pr.armed = Math.abs(wrapPi(pr.th)) > 0.015;
      }
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  /* ---- reset: pins back to even spacing, pairs to rest (~0.6s eased) ---- */
  function doReset() {
    if (!layoutOk) return;
    const order = [...pins].sort((a, b) => a.x - b.x);
    order.forEach((p, j) => {
      if (p.drag) return;
      const to = gap * (j + 1);
      if (reduced) { p.x = p.prevX = to; p.vx = 0; p.fx = to / W; }
      else p.tween = { from: p.x, to, t: 0, dur: 0.6 };
    });
    for (const pr of pairs) {
      if (pr.drag) continue;
      pr.th = wrapPi(pr.th); // collapse full rotations to the nearest rest
      pr.prevTh = pr.th;
      if (reduced) { pr.th = pr.prevTh = 0; pr.om = 0; pr.armed = false; }
      else pr.tween = { from: pr.th, to: 0, t: 0, dur: 0.6 };
    }
    if (!running && layoutOk) render(1);
  }
  if (resetBtn) resetBtn.addEventListener('click', doReset);

  /* ---- lifecycle ---- */
  layoutOk = layout();
  if (layoutOk) render(1);

  function onResize() {
    layoutOk = layout();
    if (layoutOk && !running) render(1);
  }
  window.addEventListener('resize', onResize);
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(canvas);

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => { for (const en of entries) setRunning(en.isIntersecting); },
      { rootMargin: '120px' }
    );
    io.observe(canvas);
  } else {
    setRunning(true);
  }

  /* ---- tuned params (LAW) — fallback defaults already active if this fails ---- */
  fetch('assets/magzin-swing-params.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((j) => {
      params = { ...DEFAULT_PARAMS, ...j };
      sim = deriveSim(params);
      layoutOk = layout();
      if (layoutOk && !running) render(1);
    })
    .catch((err) => {
      console.warn('[playground] params fetch failed, using built-in defaults:', err && err.message);
    });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
