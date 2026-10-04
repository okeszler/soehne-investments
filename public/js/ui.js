// Gemeinsame UI-Bausteine für Sohn-Ansicht und Verwaltung.
const eurFormatter = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const eur = n => eurFormatter.format(n);
const eur0 = n => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const pct = (v, digits = 2) => (v * 100).toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' %';
const pctShort = v => (v * 100).toLocaleString('de-AT', { maximumFractionDigits: 2 }) + ' %';
const parseDate = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00');
const dateFmt = (iso, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) => parseDate(iso).toLocaleDateString('de-AT', opts);
const $ = sel => document.querySelector(sel);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const escapeDiv = document.createElement('div');
function escapeHtml(str) {
  escapeDiv.textContent = str == null ? '' : String(str);
  return escapeDiv.innerHTML;
}

// Hochzählen wie in Dagoberts Geldspeicher: sehr starkes Ease-out (1 - (1 - t)^12),
// extrem schneller Start, langes Ausklingen, 2 Sekunden, ab dem zuletzt angezeigten Wert.
// Pro Element läuft immer nur eine Animation; eine neue bricht die alte ab.
const countRuns = new WeakMap();
const countShown = new WeakMap();
function animateValue(el, to, render, duration = 2000) {
  const id = (countRuns.get(el) || 0) + 1;
  countRuns.set(el, id);
  const from = countShown.get(el) || 0;
  const show = v => { countShown.set(el, v); render(v); };
  if (prefersReducedMotion || duration === 0) { show(to); return Promise.resolve(true); }
  const start = performance.now();
  return new Promise(done => {
    function tick(now) {
      if (countRuns.get(el) !== id) return done(false);
      // rAF-Zeitstempel kann vor `start` liegen: auf 0..1 klammern, sonst gibt es negative Werte
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      show(from + (to - from) * (1 - Math.pow(1 - t, 12)));
      if (t < 1) requestAnimationFrame(tick); else done(true);
    }
    requestAnimationFrame(tick);
    // Sicherheitsnetz, falls rAF im Hintergrund-Tab ausgesetzt wird
    setTimeout(() => { if (countRuns.get(el) === id && countShown.get(el) !== to) { countRuns.set(el, id + 1); show(to); done(true); } }, duration + 400);
  });
}
const countUp = (el, to, fmt = eur, duration) => animateValue(el, to, v => { el.textContent = fmt(v); }, duration);

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  if (!el) return;
  $('#toast-text').textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.querySelector('.check').textContent = kind === 'error' ? '!' : '✓';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 4200 : 2800);
}

async function api(url, options = {}) {
  const opts = { ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

// Farbschemata: Nachtblau ist Standard (keine data-palette), die anderen setzen data-palette.
const PALETTES = [
  { key: 'blau', name: 'Nachtblau', bg: ['#101A33', '#213A78'], bars: ['#9DB8FF', '#F2C46A'] },
  { key: 'pflaume', name: 'Pflaume', bg: ['#2A1436', '#5A2C73'], bars: ['#D9B3F0', '#FFB47A'] },
  { key: 'graphit', name: 'Graphit', bg: ['#17171A', '#36363D'], bars: ['#FF9C7E', '#F2C46A'] },
  { key: 'bordeaux', name: 'Bordeaux', bg: ['#3A0E1B', '#6E1F35'], bars: ['#F5A9BC', '#F0C565'] }
];
function applyPalette(key) {
  const valid = PALETTES.some(p => p.key === key) ? key : 'blau';
  if (valid === 'blau') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = valid;
  try { localStorage.setItem('palette', valid); } catch (e) {}
  document.querySelectorAll('[data-pal]').forEach(b => b.setAttribute('aria-checked', b.dataset.pal === valid));
  if (typeof syncThemeUi === 'function') syncThemeUi();
  return valid;
}

// PIN-Tastenfeld: schreibt in ein (verstecktes) Eingabefeld, zeigt Punkte und
// schickt bei OK bzw. Enter ab. Tastatureingabe funktioniert ebenfalls.
function setupKeypad({ input, dots, keypad, minLength = 4, onSubmit }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  keypad.innerHTML = keys.map(k => {
    if (k === 'del') return '<button type="button" class="key ghost" data-k="del" aria-label="Löschen">⌫</button>';
    if (k === 'ok') return '<button type="button" class="key ok" data-k="ok">OK</button>';
    return `<button type="button" class="key" data-k="${k}">${k}</button>`;
  }).join('');
  const max = Number(input.maxLength) > 0 ? Number(input.maxLength) : 8;
  function render() {
    const n = input.value.length;
    const slots = Math.max(minLength, n);
    dots.innerHTML = Array.from({ length: slots }, (_, i) => `<span class="${i < n ? 'on' : ''}"></span>`).join('');
  }
  function submit() {
    if (input.value.length < minLength) { shake(); return; }
    onSubmit(input.value);
  }
  function shake() {
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
  }
  function press(k) {
    if (k === 'del') input.value = input.value.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (input.value.length < max) input.value += k;
    render();
  }
  keypad.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (keypad.closest('[hidden]')) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
  });
  render();
  return {
    reset() { input.value = ''; render(); },
    fail() { shake(); setTimeout(() => { input.value = ''; render(); }, 400); },
    success() { dots.classList.add('ok'); setTimeout(() => dots.classList.remove('ok'), 500); }
  };
}

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  invest: '<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
  account: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  deposit: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  withdrawal: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  interest: '<path d="M12 2l2.4 6.9H21l-5.4 4.2 2 7L12 16l-5.6 4.1 2-7L3 8.9h6.6z"/>',
  cashback: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
  kest: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h4"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>'
};
const svgIcon = (name, size) => `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const TX_LABELS = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift', cashback: 'Cashback', kest: 'KESt' };
const TX_ICON_CLASS = { deposit: 'in', withdrawal: 'out', interest: 'int', cashback: 'int', kest: '' };
const isDebit = type => type === 'withdrawal' || type === 'kest';
const FREQ_LABELS = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich', maturity: 'endfällig' };
