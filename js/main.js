// MAGZIN — main.js (layout agent)
// i18n engine, reveal-on-scroll, video visibility, nav scroll state. No libraries.

const LANG_KEY = 'magzin-lang';

/* ---------------- i18n ---------------- */

function applyLang(lang) {
  const ar = lang === 'ar';
  const root = document.documentElement;
  root.lang = ar ? 'ar' : 'en';
  root.dir = ar ? 'rtl' : 'ltr';
  root.classList.toggle('lang-ar', ar);

  document.querySelectorAll('[data-en]').forEach((el) => {
    const text = ar ? el.dataset.ar : el.dataset.en;
    if (typeof text === 'string') el.textContent = text;
  });

  try { localStorage.setItem(LANG_KEY, lang); } catch (_) { /* private mode */ }

  window.dispatchEvent(new CustomEvent('magzin:lang', { detail: { lang } }));
}

function currentLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch (_) { /* ignore */ }
  return 'en';
}

function initI18n() {
  const toggle = () => applyLang(currentLang() === 'ar' ? 'en' : 'ar');

  const btn = document.getElementById('lang-toggle');
  if (btn) btn.addEventListener('click', toggle);
  else console.warn('main.js: #lang-toggle missing');

  document.querySelectorAll('.lang-link').forEach((el) => el.addEventListener('click', toggle));

  // Apply persisted language on load (also normalizes DOM text on first paint).
  applyLang(currentLang());
}

/* ---------------- reveal on scroll ---------------- */

function initReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });

  targets.forEach((el) => io.observe(el));
}

/* ---------------- videos: play only in view ---------------- */

function initVideos() {
  const videos = document.querySelectorAll('#wild video');
  if (!videos.length) return;

  if (!('IntersectionObserver' in window)) return; // autoplay attribute handles it

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const v = entry.target;
      if (entry.isIntersecting) {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.25 });

  videos.forEach((v) => io.observe(v));
}

/* ---------------- nav scroll state ---------------- */

function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) { console.warn('main.js: #nav missing'); return; }

  let ticking = false;
  const update = () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}

/* ---------------- boot ---------------- */

function init() {
  initI18n();
  initReveal();
  initVideos();
  initNav();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
