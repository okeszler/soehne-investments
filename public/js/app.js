// Sohn-Ansicht: Übersicht, Anlegen, Konto, Rechner, Profil.
// Gemeinsame Helfer (eur, countUp, toast, api, Farbschema, Tastenfeld) kommen aus ui.js.

let data = null;          // Antwort von /api/me
let products = [];
let currentView = 'home';
let currentRange = 365;
let heroCounting = false;
let liveTotal = 0;
let filter = 'all';

const heroEl = $('#hero-amount');
const heroFmt = v => {
  const [whole, cents] = eur(v).replace('€', '').trim().split(',');
  return `€ ${whole}<span class="cents">,${cents}</span>`;
};

// ---------- Login ----------
const keypad = setupKeypad({
  input: $('#pin-input'), dots: $('#pin-dots'), keypad: $('#keypad'), minLength: 4,
  onSubmit: async pin => {
    $('#login-error').textContent = '';
    const res = await api('/api/login', { method: 'POST', body: { pin } });
    if (res.ok) {
      keypad.success();
      await loadAndShow();
    } else {
      $('#login-error').textContent = 'PIN stimmt nicht. Versuch es nochmal.';
      keypad.fail();
    }
  }
});

async function loadMe() {
  const res = await api('/api/me');
  if (!res.ok) return false;
  data = res.data;
  return true;
}

async function loadAndShow() {
  if (!(await loadMe())) { showLogin(); return; }
  applyPalette(data.palette);
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderAll();
  go('home', { scroll: false });
  startHero();
  loadProducts();
  setupPush().catch(err => console.error('Push-Setup fehlgeschlagen:', err));
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  keypad.reset();
}

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

// ---------- Navigation ----------
const TABS = [['home', 'Übersicht'], ['invest', 'Anlegen'], ['account', 'Konto'], ['calc', 'Rechner'], ['profile', 'Profil']];
const navHtml = TABS.map(([k, l]) => `<button type="button" class="nav-item" data-go="${k}">${svgIcon(k)}${l}</button>`).join('');
$('#tabbar').innerHTML = navHtml;
$('#side-nav').innerHTML = navHtml;

function go(view, { scroll = true } = {}) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    if (v.id === 'v-' + view) { void v.offsetWidth; v.classList.add('active'); }
  });
  document.querySelectorAll('.nav-item').forEach(n => n.dataset.go === view ? n.setAttribute('aria-current', 'page') : n.removeAttribute('aria-current'));
  if (scroll) window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  if (view === 'home') { drawChart(); animateRings(); placePill(); }
  if (view === 'calc') renderCalculator();
  if (view === 'invest') updateInvestPreview();
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
  const s = e.target.closest('[data-sheet]');
  if (s) openSheet(s.dataset.sheet);
});

// ---------- Rendering ----------
const senderLine = () => data.senderName ? `Nachricht von ${escapeHtml(data.senderName)}` : 'Neue Nachricht';
const payoutInfo = () => data.senderName ? `${escapeHtml(data.senderName)} bekommt sofort eine Benachrichtigung` : 'Dein Antrag wird sofort weitergeleitet';

function lastDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

function renderAll() {
  const today = new Date();
  const hour = today.getHours();
  $('#greet').textContent = `${hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'}, ${data.name}`;
  $('#today').textContent = today.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#side-name').textContent = data.name;
  $('#side-rate').textContent = `FLEX-Zins ${pct(data.annualRate)} p.a.`;

  renderKest();
  const invested = (data.investments || []).reduce((s, i) => s + i.currentValue, 0);
  const flexWithAccrued = data.balance - invested;
  $('#flex-amt').textContent = eur(flexWithAccrued);
  $('#inv-amt').textContent = eur(invested);
  const bars = $('#split-bar').children;
  bars[0].style.flex = Math.max(flexWithAccrued, 0.0001);
  bars[1].style.flex = Math.max(invested, 0.0001);
  bars[1].hidden = invested <= 0;

  countUp($('#today-int'), data.dailyInterest);
  countUp($('#s-interest'), data.totalInterestEarned);
  $('#s-interest-sub').textContent = data.kestRate > 0 ? 'nach Abzug der KESt' : 'steuerfrei gutgeschrieben';

  // Cashback nur zeigen, wenn aktiv oder schon welches angefallen ist
  const showCash = data.cashbackRate > 0 || data.lifetimeCashback > 0;
  $('#stat-cash').hidden = !showCash;
  $('#stat-interest').classList.toggle('full', !showCash);
  if (showCash) countUp($('#s-cash'), data.lifetimeCashback);
  $('#s-cash-sub').textContent = data.cashbackRate > 0 ? `${pctShort(data.cashbackRate)} auf Curve-Zahlungen` : 'derzeit nicht aktiv';

  // FLEX-Zinsen werden am Monatsletzten gebucht: bisher aufgelaufen + Rest bis Monatsende
  const end = lastDayOfMonth(today);
  const daysLeft = Math.max(0, Math.round((end - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5));
  const nextCredit = data.flexAccruedInterest + data.cashBalance * data.annualRate / 365 * (1 - data.kestRate) * daysLeft;
  $('#next-sub').textContent = `FLEX · am ${end.toLocaleDateString('de-AT', { day: 'numeric', month: 'long' })}${data.kestRate > 0 ? ' · nach KESt' : ''}`;
  $('#next-int').textContent = '≈ ' + eur(nextCredit);

  renderMessages();
  renderInvestments();
  $('#tx-recent').innerHTML = renderTxList([...data.transactions].reverse().slice(0, 6)) || '<div class="empty">Noch keine Bewegungen.</div>';

  $('#avail').textContent = eur(data.cashBalance);
  $('#acc-bal').textContent = eur(data.cashBalance);
  $('#acc-rate').textContent = `${pct(data.annualRate)} p.a.${data.kestRate > 0 ? ' vor KESt' : ''}`;
  renderAccount();

  const since = data.memberSince ? parseDate(data.memberSince).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' }) : '';
  $('#profile-sub').textContent = since ? `${data.name} · seit ${since} dabei` : data.name;
  $('#payout-sub').textContent = payoutInfo();
  renderPalettes();

  const rateInput = $('#c-rate');
  if (!rateInput.dataset.touched) rateInput.value = Math.min(10, Math.max(0.5, Math.round(data.annualRate * 1000) / 10));
  if (currentView === 'home') drawChart();
}

function renderKest() {
  if (data.kestRate > 0) {
    $('#kest-label').textContent = 'nach KESt';
    $('#kest-text').textContent = `Von jeder Zinsgutschrift werden ${pctShort(data.kestRate)} Kapitalertragssteuer abgezogen, so wie bei einer Bank. Alle Beträge in der App sind schon nach Abzug. Dein FLEX-Zins von ${pct(data.annualRate)} ergibt netto ${pct(data.annualRate * (1 - data.kestRate))}.`;
  } else {
    // Österreich: Banken behalten auf Sparzinsen 25 % KESt ein
    const who = data.senderName ? `${data.senderName} übernimmt diese Steuer für dich.` : 'Diese Steuer wird für dich übernommen.';
    $('#kest-label').textContent = 'KESt-frei';
    $('#kest-text').textContent = `Banken in Österreich behalten 25 % deiner Zinsen als Kapitalertragssteuer ein. ${who} Bei deinem FLEX-Zins von ${pct(data.annualRate)} würde eine Bank dir effektiv nur ${pct(data.annualRate * 0.75)} auszahlen.`;
  }
}

$('#kest-btn').addEventListener('click', e => {
  const open = $('#kest-explain').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});

function startHero() {
  liveTotal = data.balance;
  heroCounting = true;
  animateValue(heroEl, data.balance, v => { heroEl.innerHTML = heroFmt(v); })
    .then(finished => { if (finished) heroCounting = false; });
}

// Live-Zinsen: der Betrag wächst sichtbar mit dem sekundengenauen Zins (erst nach dem Hochzählen)
setInterval(() => {
  if (!data || heroCounting || currentView !== 'home' || $('#app').hidden || document.hidden) return;
  liveTotal += data.dailyInterest / 86400 * 3;
  heroEl.innerHTML = heroFmt(liveTotal);
}, 3000);

// ---------- Nachrichten & Push ----------
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = (data.messages || []).map(m => `
    <div class="notice" data-id="${m.id}">
      <div class="ico">${svgIcon('message', 18)}</div>
      <div><b>${senderLine()}</b><span>${escapeHtml(m.body)}</span></div>
      <button class="x" type="button" data-dismiss="${m.id}" aria-label="Nachricht schließen">✕</button>
    </div>`).join('');
}

$('#messages').addEventListener('click', async e => {
  const btn = e.target.closest('[data-dismiss]');
  if (!btn) return;
  const id = btn.dataset.dismiss;
  const notice = btn.closest('.notice');
  notice.classList.add('gone');
  setTimeout(() => notice.remove(), 450);
  data.messages = data.messages.filter(m => String(m.id) !== id);
  await api('/api/dismiss-message', { method: 'POST', body: { messageId: id } });
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0)));
}

let swRegistration = null;
const storageGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

function pushBanner(html, kind) {
  $('#push-banner-wrap').innerHTML = `<div class="notice" data-kind="${kind}">
    <div class="ico">${svgIcon('bell', 18)}</div><div>${html}</div>
    <button class="x" type="button" id="push-banner-x" aria-label="Hinweis schließen">✕</button></div>`;
  $('#push-banner-x').addEventListener('click', () => {
    storageSet(kind === 'ios-hint' ? 'pushHintDismissed' : 'pushOfferDismissed', '1');
    $('#push-banner-wrap').innerHTML = '';
  });
}

async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { toast('Benachrichtigungen wurden im Browser nicht erlaubt', 'error'); return false; }
  const { data: keyData } = await api('/api/vapid-public-key');
  const sub = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) });
  await api('/api/push-subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  return true;
}

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  swRegistration = await navigator.serviceWorker.register('/sw.js');

  if (isIOS && !isStandalone) {
    if (!storageGet('pushHintDismissed')) pushBanner('<b>Benachrichtigungen</b><span>Füge die App über „Teilen“ → „Zum Home-Bildschirm“ hinzu, um Benachrichtigungen zu bekommen.</span>', 'ios-hint');
    return;
  }

  const existing = await swRegistration.pushManager.getSubscription();
  $('#push-setting').hidden = false;
  $('#sw-push').setAttribute('aria-checked', !!existing);
  if (Notification.permission === 'denied') {
    $('#push-sub').textContent = 'Im Browser blockiert';
    $('#sw-push').disabled = true;
    return;
  }
  if (existing || storageGet('pushOfferDismissed')) return;
  pushBanner('<b>Nichts verpassen</b><span>Lass dich benachrichtigen, wenn Geld oder eine Nachricht ankommt.</span><div class="actions"><button type="button" class="btn small" id="push-enable">Benachrichtigungen aktivieren</button></div>', 'offer');
  $('#push-enable').addEventListener('click', async () => {
    if (await subscribePush()) {
      $('#push-banner-wrap').innerHTML = '';
      $('#sw-push').setAttribute('aria-checked', true);
      toast('Benachrichtigungen aktiviert');
    }
  });
}

$('#sw-push').addEventListener('click', async e => {
  const sw = e.currentTarget;
  if (!swRegistration) return;
  if (sw.getAttribute('aria-checked') === 'true') {
    const sub = await swRegistration.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    sw.setAttribute('aria-checked', false);
    toast('Benachrichtigungen aus');
  } else if (await subscribePush()) {
    sw.setAttribute('aria-checked', true);
    $('#push-banner-wrap').innerHTML = '';
    toast('Benachrichtigungen aktiviert');
  }
});

// ---------- Investitionen ----------
const RING_C = 2 * Math.PI * 18;

function renderInvestments() {
  const list = data.investments || [];
  if (!list.length) {
    $('#inv-list').innerHTML = '<div class="empty">Noch keine Investitionen. Unter „Anlegen“ kannst du Geld fest anlegen und mehr Zinsen bekommen.</div>';
    return;
  }
  $('#inv-list').innerHTML = list.map((inv, i) => {
    const progress = inv.lockDays > 0 ? Math.min(1, Math.max(0, 1 - inv.daysRemaining / inv.lockDays)) : null;
    const ring = progress === null
      ? '<div class="inv-flex" aria-label="flexibel">∞</div>'
      : `<div class="ring"><svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="18"/><circle class="fg" cx="23" cy="23" r="18" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" data-p="${progress}"/></svg><span>${Math.round(progress * 100)}%</span></div>`;
    const interestAtMaturity = Math.round((inv.maturityValue - inv.principal) * 100) / 100;
    const meta = inv.lockDays > 0
      ? `${pct(inv.apy)} · noch ${inv.daysRemaining} ${inv.daysRemaining === 1 ? 'Tag' : 'Tage'} · fällig ${dateFmt(inv.maturityDate, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : `${pct(inv.apy)} · flexibel`;
    return `<div class="inv">
      ${ring}
      <div style="min-width:0"><div class="inv-name">${escapeHtml(inv.productName)}</div><div class="inv-meta">${meta}</div>
        ${inv.description ? `<button type="button" class="more" data-toggle="inv-desc-${i}">Was ist das?</button><div class="desc" id="inv-desc-${i}" hidden>${escapeHtml(inv.description)}</div>` : ''}</div>
      <div class="inv-val"><b class="num">${eur(inv.currentValue)}</b><span class="num">+${eur(interestAtMaturity)} am Ende${data.kestRate > 0 ? ' (netto)' : ''}</span></div>
    </div>`;
  }).join('');
}

function animateRings() {
  document.querySelectorAll('.ring .fg').forEach(c => {
    c.style.transition = 'none';
    c.style.strokeDashoffset = RING_C;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.style.transition = '';
      c.style.strokeDashoffset = RING_C * (1 - Number(c.dataset.p));
    }));
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  const el = document.getElementById(t.dataset.toggle);
  el.hidden = !el.hidden;
  t.textContent = el.hidden ? (t.dataset.more || 'Was ist das?') : 'Weniger';
});

// ---------- Buchungen ----------
function txTitle(tx) {
  if (tx.type === 'kest') return 'KESt';
  return tx.note ? tx.note : TX_LABELS[tx.type];
}

function renderTxList(txs) {
  return txs.map(tx => {
    const debit = isDebit(tx.type);
    const sub = [dateFmt(tx.date, { day: 'numeric', month: 'short', year: 'numeric' })];
    if (tx.note && tx.type !== 'kest') sub.push(TX_LABELS[tx.type]);
    if (tx.type === 'kest' && tx.note) sub.push(escapeHtml(tx.note));
    return `<div class="tx">
      <span class="tx-ic ${TX_ICON_CLASS[tx.type] || ''}">${svgIcon(tx.type)}</span>
      <div style="min-width:0"><div class="tx-title">${escapeHtml(txTitle(tx))}</div><div class="tx-sub">${sub.join(' · ')}</div></div>
      <div class="tx-amt num ${debit ? 'neg' : 'pos'}">${debit ? '−' : '+'}${eur(tx.amount)}</div></div>`;
  }).join('');
}

const FILTERS = [['all', 'Alle'], ['in', 'Eingänge'], ['earn', 'Zinsen & Cashback'], ['out', 'Ausgänge']];
const FILTER_TYPES = { in: ['deposit'], earn: ['interest', 'cashback', 'kest'], out: ['withdrawal'] };
$('#filters').innerHTML = FILTERS.map(([k, l]) => `<button type="button" class="fchip" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('');
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filters [data-f]').forEach(x => x.setAttribute('aria-pressed', x === b));
  renderAccount(true);
});

function renderAccount(animate) {
  const txs = [...data.transactions].reverse().filter(t => filter === 'all' || FILTER_TYPES[filter].includes(t.type));
  let html = '', lastMonth = '';
  let group = [];
  const flush = () => { if (group.length) { html += renderTxList(group); group = []; } };
  txs.forEach(t => {
    const m = parseDate(t.date).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
    if (m !== lastMonth) { flush(); html += `<div class="month">${m}</div>`; lastMonth = m; }
    group.push(t);
  });
  flush();
  const el = $('#tx-all');
  el.innerHTML = html || '<div class="empty">Keine Bewegungen in dieser Auswahl.</div>';
  if (animate && !prefersReducedMotion) el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'ease-out' });
}

// ---------- Verlaufsdiagramm (SVG) ----------
// Aus den Buchungsständen eine Tagesreihe bis heute machen (Stand bleibt bis zur nächsten Buchung gleich).
function dailySeries() {
  const hist = data.history || [];
  if (!hist.length) return [];
  const byDate = new Map();
  hist.forEach(h => byDate.set(h.date, h.balance));
  const start = parseDate(hist[0].date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  let v = 0;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (byDate.has(key)) v = byDate.get(key);
    out.push({ d: new Date(d), v });
  }
  // Seit der letzten Buchung wachsen Zinsen gleichmäßig: dieses Stück bis zum heutigen
  // Stand (inkl. aufgelaufener Zinsen) linear zeichnen statt als Sprung am Ende.
  const lastIdx = out.findIndex(p => p.d >= parseDate(hist[hist.length - 1].date));
  if (lastIdx < 0) { out[out.length - 1].v = data.balance; return out; }
  const fromV = out[lastIdx].v, span = out.length - 1 - lastIdx;
  for (let i = lastIdx + 1; i < out.length; i++) out[i].v = fromV + (data.balance - fromV) * (i - lastIdx) / span;
  out[out.length - 1].v = data.balance;
  return out;
}

function drawChart() {
  const wrap = $('#chart-wrap');
  if (!data || !wrap.clientWidth) return;
  wrap.querySelector('svg')?.remove();
  wrap.querySelector('.empty')?.remove();
  const all = dailySeries();
  if (all.length < 2) {
    $('#chart-delta').textContent = '';
    wrap.insertAdjacentHTML('beforeend', '<div class="empty">Der Verlauf startet mit der ersten Einzahlung.</div>');
    return;
  }
  const today = all[all.length - 1].d;
  let pts = all.filter(p => (today - p.d) / 864e5 <= currentRange);
  if (pts.length < 2) pts = all.slice(-2);
  const step = Math.max(1, Math.floor(pts.length / 160));
  const s = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);

  const W = Math.max(280, wrap.clientWidth), H = 200, padL = 4, padR = 4, padT = 12, padB = 24;
  const vals = s.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(1, hi * 0.1);
  lo = Math.max(0, lo - span * 0.12); hi = hi + span * 0.08;
  const x = i => padL + i / (s.length - 1) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  let d = '';
  s.forEach((p, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); });
  const area = `${d}L${x(s.length - 1)} ${H - padB}L${x(0)} ${H - padB}Z`;
  const grid = [0, 0.5, 1].map(f => { const yy = padT + f * (H - padT - padB); return `<line class="chart-grid" x1="0" x2="${W}" y1="${yy}" y2="${yy}"/>`; }).join('');
  const tickFmt = { month: 'short', year: '2-digit' };
  const ticks = [0, Math.floor((s.length - 1) / 2), s.length - 1].map((i, k) =>
    `<text class="chart-label" x="${x(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${s[i].d.toLocaleDateString('de-AT', tickFmt)}</text>`).join('');
  const last = s[s.length - 1];

  wrap.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Verlauf des Gesamtkapitals">
    <defs><linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".22"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="chart-area" d="${area}"/><path class="chart-line draw" d="${d}"/>
    <line class="chart-cursor" y1="${padT}" y2="${H - padB}" x1="-10" x2="-10"/>
    <circle class="chart-dot" r="5" cx="${x(s.length - 1)}" cy="${y(last.v)}"/>${ticks}</svg>`);
  const line = wrap.querySelector('.chart-line');
  const len = line.getTotalLength();
  line.style.strokeDasharray = len;
  line.style.setProperty('--len', len);

  const diff = last.v - s[0].v;
  $('#chart-delta').innerHTML = `<b class="num" style="${diff < 0 ? 'color:var(--ink)' : ''}">${diff >= 0 ? '+' : '−'}${eur(Math.abs(diff))}</b> im gewählten Zeitraum`;

  const svg = wrap.querySelector('svg'), tip = $('#tip'), cur = svg.querySelector('.chart-cursor'), dot = svg.querySelector('.chart-dot');
  function move(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const i = Math.max(0, Math.min(s.length - 1, Math.round((px - padL) / (W - padL - padR) * (s.length - 1))));
    cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.classList.add('on');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(s[i].v));
    tip.style.left = (x(i) / W * 100) + '%';
    tip.style.top = (y(s[i].v) / H * 200) + 'px';
    tip.innerHTML = `<b class="num">${eur(s[i].v)}</b>${s[i].d.toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    tip.style.opacity = 1;
  }
  function leave() {
    tip.style.opacity = 0; cur.classList.remove('on');
    dot.setAttribute('cx', x(s.length - 1)); dot.setAttribute('cy', y(last.v));
  }
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchend', leave);
}

const seg = $('#range-seg');
function placePill() {
  const on = seg.querySelector('[aria-pressed="true"]'), pill = seg.querySelector('.pill');
  if (!on.offsetWidth) return;
  pill.style.left = on.offsetLeft + 'px';
  pill.style.width = on.offsetWidth + 'px';
}
seg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  currentRange = Number(b.dataset.range);
  placePill();
  drawChart();
});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    placePill();
    if (currentView === 'home') drawChart();
    if (currentView === 'calc') renderCalculator();
  }, 150);
});
document.addEventListener('themechange', () => { if (data && currentView === 'home') drawChart(); });

// ---------- Anlegen ----------
async function loadProducts() {
  const res = await api('/api/products');
  products = res.data.products || [];
  renderProducts();
}

let selectedProductId = null;
function lockLabel(days) {
  if (!days) return 'flexibel';
  if (days % 365 === 0) return `${days / 365} ${days === 365 ? 'Jahr' : 'Jahre'} Bindung`;
  if (days >= 28 && days < 365) return `${Math.round(days / 30.4)} Monate Bindung`;
  return `${days} Tage Bindung`;
}

function renderProducts() {
  if (!products.length) {
    $('#products').innerHTML = '<div class="card empty">Gerade gibt es keine Anlageprodukte.</div>';
    $('#invest-submit').disabled = true;
    return;
  }
  if (!products.some(p => p.id === selectedProductId)) selectedProductId = products[0].id;
  $('#products').innerHTML = products.map(p => `<button type="button" class="prod" data-id="${p.id}" aria-pressed="${p.id === selectedProductId}">
      <div class="prod-top"><span class="prod-name">${escapeHtml(p.name)}</span><span class="prod-apy num">${(p.apy * 100).toLocaleString('de-AT', { maximumFractionDigits: 2 })}<small> %</small></span></div>
      ${p.description ? `<div class="prod-desc clamp">${escapeHtml(p.description)}</div>` : ''}
      <div class="tags"><span class="tag">${lockLabel(p.lock_days)}</span><span class="tag">Zinsen ${FREQ_LABELS[p.interest_frequency]}</span></div>
    </button>`).join('');
  updateInvestPreview();
}

$('#products').addEventListener('click', e => {
  const b = e.target.closest('.prod');
  if (!b) return;
  selectedProductId = Number(b.dataset.id);
  document.querySelectorAll('.prod').forEach(x => x.setAttribute('aria-pressed', x === b));
  b.querySelector('.prod-desc')?.classList.remove('clamp');
  updateInvestPreview();
});

$('#presets').innerHTML = [100, 250, 500, 1000].map(v => `<button type="button" class="fchip" data-v="${v}">${eur0(v)}</button>`).join('');
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  $('#invest-amount').value = b.dataset.v;
  $('#invest-range').value = b.dataset.v;
  updateInvestPreview();
});
$('#invest-range').addEventListener('input', e => { $('#invest-amount').value = e.target.value; updateInvestPreview(); });
$('#invest-amount').addEventListener('input', e => { $('#invest-range').value = e.target.value; updateInvestPreview(); });

function updateInvestPreview() {
  const p = products.find(x => x.id === selectedProductId);
  if (!p || !data) { $('#invest-preview').innerHTML = ''; return; }
  const maxRange = Math.max(100, Math.floor(data.cashBalance / 10) * 10);
  $('#invest-range').max = maxRange;
  const amount = Math.max(0, Number($('#invest-amount').value) || 0);
  const days = p.lock_days || 365;
  const gross = amount * p.apy * days / 365;
  const interest = gross * (1 - data.kestRate);
  const due = new Date(); due.setDate(due.getDate() + days);
  $('#invest-preview').innerHTML = `
    <div><div class="k">${p.lock_days ? 'Fällig am' : 'Nach 1 Jahr'}</div><div class="v">${due.toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: '2-digit' })}</div></div>
    <div><div class="k">Zinsen${data.kestRate > 0 ? ' netto' : ''}</div><div class="v gold num">≈ +${eur(interest)}</div></div>
    <div><div class="k">Auszahlung</div><div class="v num">≈ ${eur(amount + interest)}</div></div>`;
}

$('#invest-form').addEventListener('submit', async e => {
  e.preventDefault();
  const amount = Number($('#invest-amount').value);
  if (!(amount >= 100)) { toast('Bitte mindestens € 100 anlegen', 'error'); return; }
  if (amount > data.cashBalance) { toast(`So viel ist auf FLEX nicht verfügbar (${eur(data.cashBalance)})`, 'error'); return; }
  const btn = $('#invest-submit');
  btn.disabled = true;
  const res = await api('/api/invest', { method: 'POST', body: { productId: selectedProductId, amount } });
  btn.disabled = false;
  if (!res.ok) { toast(res.data.error || 'Investition konnte nicht angelegt werden', 'error'); return; }
  const product = products.find(x => x.id === selectedProductId);
  await loadMe();
  renderAll();
  go('home');
  startHero();
  toast(`${eur(amount)} in ${product ? product.name : 'das Produkt'} angelegt`);
});

// ---------- Rechner ----------
// Simuliert den Wertverlauf periodenweise (identisch zur Cron-Logik: an jeder
// Periodengrenze wird Zins aufs bisherige Kapital gutgeschrieben und compoundet;
// "endfällig" ist eine einzige Periode über die volle Laufzeit).
const CONTRIBUTION_DAYS = 30;

function contributedCapitalAtDay(startCapital, monthlyContribution, day) {
  return startCapital + monthlyContribution * Math.floor(day / CONTRIBUTION_DAYS);
}

function simulateCompoundSeries(startCapital, totalDays, apy, frequency, monthlyContribution = 0) {
  const periodDaysMap = { monthly: 30, quarterly: 91, yearly: 365 };
  const periodDays = frequency === 'maturity' ? totalDays : periodDaysMap[frequency];

  const ticks = new Set();
  for (let d = periodDays; d < totalDays && periodDays > 0; d += periodDays) ticks.add(d);
  if (monthlyContribution > 0) {
    for (let d = CONTRIBUTION_DAYS; d < totalDays; d += CONTRIBUTION_DAYS) ticks.add(d);
  }
  ticks.add(totalDays);
  const sortedTicks = Array.from(ticks).sort((a, b) => a - b);

  const boundaries = [0];
  const valueAt = new Map([[0, startCapital]]);
  let value = startCapital;
  let last = 0;
  for (const d of sortedTicks) {
    const step = d - last;
    if (step > 0) value += value * apy * step / 365;
    if (monthlyContribution > 0 && d % CONTRIBUTION_DAYS === 0) value += monthlyContribution;
    last = d;
    boundaries.push(d);
    valueAt.set(d, Math.round(value * 100) / 100);
  }
  return { boundaries, valueAt, finalValue: valueAt.get(boundaries[boundaries.length - 1]) };
}

function valueAtDay(boundaries, valueAt, day) {
  let v = valueAt.get(0);
  for (const b of boundaries) {
    if (b <= day) v = valueAt.get(b); else break;
  }
  return v;
}

function renderCalculator() {
  const startCapital = Math.max(0, Number($('#c-cap').value) || 0);
  const ratePct = Number($('#c-rate').value);
  const apy = ratePct / 100;
  const years = Number($('#c-years').value);
  const monthly = Math.max(0, Number($('#c-monthly').value) || 0);
  const frequency = $('#c-freq').value;
  $('#c-rate-v').textContent = ratePct.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  $('#c-years-v').textContent = years + (years === 1 ? ' Jahr' : ' Jahre');

  const totalDays = years * 365;
  const { boundaries, valueAt, finalValue } = simulateCompoundSeries(startCapital, totalDays, apy, frequency, monthly);
  const totalContributed = contributedCapitalAtDay(startCapital, monthly, totalDays);
  const rows = [];
  for (let y = 1; y <= years; y++) {
    const day = y * 365;
    const paid = contributedCapitalAtDay(startCapital, monthly, day);
    rows.push({ paid, bal: valueAtDay(boundaries, valueAt, day) });
  }

  $('#c-final').textContent = eur0(finalValue);
  $('#c-int').textContent = '+' + eur0(finalValue - totalContributed);
  $('#calc-note').textContent = `Aus ${eur(startCapital)}${monthly > 0 ? ` plus ${eur(monthly)} im Monat (insgesamt ${eur(totalContributed)} eingezahlt)` : ''} werden bei ${pct(apy)} p.a. und Zinszubuchung ${FREQ_LABELS[frequency]} in ${years} ${years === 1 ? 'Jahr' : 'Jahren'} rechnerisch ${eur(finalValue)}.`;

  const wrap = $('#calc-chart');
  if (!wrap.clientWidth) return;
  const W = Math.max(280, wrap.clientWidth), H = 220, padB = 22, padT = 8;
  const max = Math.max(1, ...rows.map(r => Math.max(r.bal, r.paid))) * 1.05;
  const slot = W / rows.length, bw = slot * 0.64, gap = slot * 0.36;
  const yS = v => (v / max) * (H - padB - padT);
  const labelStep = rows.length > 15 ? 5 : rows.length > 8 ? 2 : 1;
  const bars = rows.map((r, i) => {
    const x = i * slot + gap / 2, hp = yS(r.paid), hi = yS(Math.max(0, r.bal - r.paid));
    return `<rect class="bar-in" x="${x}" y="${H - padB - hp}" width="${bw}" height="${hp}" rx="3" style="animation-delay:${i * 25}ms"/>
      <rect class="bar-int" x="${x}" y="${H - padB - hp - hi}" width="${bw}" height="${Math.max(0, hi - 1)}" rx="3" style="animation-delay:${i * 25 + 120}ms"/>
      ${(i + 1) % labelStep === 0 || i === 0 ? `<text class="chart-label" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${i + 1}</text>` : ''}`;
  }).join('');
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="Kapitalentwicklung nach Jahren"><line class="chart-grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/><g class="bars">${bars}</g></svg>`;
}
$('#calc-form').addEventListener('input', e => { if (e.target.id === 'c-rate') e.target.dataset.touched = '1'; renderCalculator(); });
$('#calc-form').addEventListener('submit', e => e.preventDefault());

// ---------- Profil: Farbschema ----------
function renderPalettes() {
  $('#palettes').innerHTML = PALETTES.map(p => `<button type="button" class="pal-opt" role="radio" data-pal="${p.key}" aria-checked="${p.key === (data.palette || 'blau')}">
      <span class="pal-prev" style="background:linear-gradient(150deg, ${p.bg[1]}, ${p.bg[0]} 75%)"><i style="background:${p.bars[0]};flex:3"></i><i style="background:${p.bars[1]};flex:4"></i><span class="dot">✓</span></span>
      <span class="pal-name">${p.name}</span></button>`).join('');
}

$('#palettes').addEventListener('click', async e => {
  const b = e.target.closest('[data-pal]');
  if (!b) return;
  const previous = data.palette;
  data.palette = applyPalette(b.dataset.pal);
  if (currentView === 'home') drawChart();
  const res = await api('/api/preferences', { method: 'POST', body: { palette: data.palette } });
  if (!res.ok) {
    data.palette = applyPalette(previous);
    toast('Farbschema konnte nicht gespeichert werden', 'error');
  }
});

// ---------- Sheets: Auszahlung & PIN ----------
function openSheet(kind) {
  document.querySelectorAll('[data-sheet-body]').forEach(el => { el.hidden = el.dataset.sheetBody !== kind; });
  $('#sheet').setAttribute('aria-labelledby', `sheet-title-${kind}`);
  if (kind === 'payout') $('#payout-lead').innerHTML = `${payoutInfo()}. Verfügbar: <b class="num">${eur(data.cashBalance)}</b>`;
  $('#scrim').classList.add('open');
  $('#sheet').classList.add('open');
  setTimeout(() => $(`[data-sheet-body="${kind}"] input`)?.focus({ preventScroll: true }), 350);
}
function closeSheet() {
  $('#scrim').classList.remove('open');
  $('#sheet').classList.remove('open');
}
$('#scrim').addEventListener('click', closeSheet);
$('#sheet-close').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

$('#payout-form').addEventListener('submit', async e => {
  e.preventDefault();
  const amount = Number($('#payout-amount').value);
  const res = await api('/api/payout-request', { method: 'POST', body: { amount, note: $('#payout-note').value } });
  if (!res.ok) { toast(res.data.error || 'Antrag konnte nicht gesendet werden', 'error'); return; }
  e.target.reset();
  closeSheet();
  toast(data.senderName ? `Antrag gesendet, ${data.senderName} wurde informiert` : 'Antrag gesendet');
});

$('#pin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const newPin = $('#new-pin').value;
  if (newPin !== $('#new-pin-confirm').value) { toast('Die neuen PINs stimmen nicht überein', 'error'); return; }
  const res = await api('/api/change-pin', { method: 'POST', body: { currentPin: $('#current-pin').value, newPin } });
  if (!res.ok) { toast(res.data.error || 'PIN konnte nicht geändert werden', 'error'); return; }
  e.target.reset();
  closeSheet();
  toast('PIN geändert');
});

// ---------- Start ----------
loadAndShow();
