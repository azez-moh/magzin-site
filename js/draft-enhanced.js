// MAGZIN — draft-enhanced.js (UX DRAFT — used only by draft-enhanced.html)
// Adds: collection color picker, nav scrollspy, pull scrub progress bar,
// offscreen pause for the film video. No libraries.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isAr = () => document.documentElement.classList.contains('lang-ar');

/* ---------------- collection color picker ---------------- */

function initSwatches() {
  const buttons = Array.from(document.querySelectorAll('.swatch-btn'));
  if (!buttons.length) { console.warn('[draft] no .swatch-btn found'); return; }
  const chip = document.getElementById('canvas-chip');
  const nameLine = document.getElementById('color-name-1');

  const setLabelText = (el, en, ar) => {
    if (!el) return;
    // keep BOTH i18n attributes current so the language toggle re-renders
    // the right name (main.js swaps textContent from data-en/data-ar)
    el.dataset.en = en;
    el.dataset.ar = ar;
    el.textContent = isAr() ? ar : en;
  };

  const select = (btn) => {
    const hex = btn.dataset.hex;
    const en = btn.dataset.nameEn;
    const ar = btn.dataset.nameAr;
    for (const b of buttons) {
      b.setAttribute('aria-pressed', b.dataset.hex === hex ? 'true' : 'false');
    }
    setLabelText(chip, en, ar);
    setLabelText(nameLine, `COLOR — ${en}`, `اللون — ${ar}`);
    window.dispatchEvent(new CustomEvent('magzin:color', { detail: { hex, name: en } }));
  };

  for (const b of buttons) b.addEventListener('click', () => select(b));

  // localized aria-labels for the round buttons (they have no text content)
  const refreshAria = () => {
    for (const b of buttons) {
      b.setAttribute('aria-label', isAr() ? b.dataset.nameAr : b.dataset.nameEn);
    }
  };
  window.addEventListener('magzin:lang', refreshAria);
  refreshAria();
}

/* ---------------- nav scrollspy ---------------- */

function initScrollspy() {
  const links = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));
  const pairs = links
    .map((a) => ({ a, sec: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter((p) => p.sec);
  if (!pairs.length) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const mid = window.innerHeight / 2;
    let current = null;
    for (const p of pairs) {
      const r = p.sec.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) current = p;
    }
    for (const p of pairs) p.a.classList.toggle('active', p === current);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}

/* ---------------- pull scrub progress ---------------- */

function initPullProgress() {
  const section = document.getElementById('pull');
  const fill = document.getElementById('pull-progress-fill');
  if (!section || !fill) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = section.getBoundingClientRect();
    const denom = rect.height - window.innerHeight;
    if (denom <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) return;
    const p = clamp(-rect.top / denom, 0, 1);
    fill.style.width = `${(p * 100).toFixed(2)}%`;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}

/* ---------------- film video: play only in view ---------------- */

function initFilmVideo() {
  const videos = document.querySelectorAll('#film video, #howto video');
  if (!videos.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const v = en.target;
      if (en.isIntersecting) {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else {
        v.pause();
      }
    }
  }, { threshold: 0.2 });
  videos.forEach((v) => io.observe(v));
}

/* ---------------- boot ---------------- */

function init() {
  initSwatches();
  initScrollspy();
  initPullProgress();
  initFilmVideo();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
