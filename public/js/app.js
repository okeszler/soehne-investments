const eurFormatter = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const eur = (n) => eurFormatter.format(n);
const dateFmt = (isoDate) => new Date(isoDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const escapeDiv = document.createElement('div');
function escapeHtml(str) {
  escapeDiv.textContent = str == null ? '' : String(str);
  return escapeDiv.innerHTML;
}

let currentData = null;
let historyChart = null;
let calculatorChart = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function dismissPushBanner(kind) {
  localStorage.setItem(kind === 'ios-hint' ? 'pushHintDismissed' : 'pushOfferDismissed', '1');
  document.getElementById('push-banner').style.display = 'none';
}

document.getElementById('push-banner-dismiss').addEventListener('click', () => {
  dismissPushBanner(document.getElementById('push-banner').dataset.kind);
});

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const banner = document.getElementById('push-banner');
  const text = document.getElementById('push-banner-text');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const registration = await navigator.serviceWorker.register('/sw.js');

  if (isIOS && !isStandalone) {
    if (localStorage.getItem('pushHintDismissed')) return;
    banner.dataset.kind = 'ios-hint';
    banner.style.display = 'flex';
    text.textContent = 'Füge diese Seite über „Teilen“ → „Zum Home-Bildschirm“ hinzu, um Benachrichtigungen zu erhalten.';
    return;
  }

  if (Notification.permission === 'denied') return;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return;
  if (localStorage.getItem('pushOfferDismissed')) return;

  banner.dataset.kind = 'offer';
  banner.style.display = 'flex';
  text.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'admin-submit';
  btn.style.padding = '6px 14px';
  btn.style.fontSize = '12px';
  btn.textContent = '🔔 Benachrichtigungen aktivieren';
  btn.addEventListener('click', async () => {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      banner.style.display = 'none';
      return;
    }
    const { publicKey } = await (await fetch('/api/vapid-public-key')).json();
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    banner.style.display = 'none';
  });
  text.appendChild(btn);
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const chartAnimation = prefersReducedMotion ? false : { duration: 700, easing: 'easeOutQuart' };

// Split-Flap-Anzeige (Solari-Board-Style, wie der Hatch-Zähler in "Lost"):
// ein <div class="flap-card"> pro Zeichen mit oberer/unterer Hälfte; bei
// einer Wertänderung werden zwei kurzlebige "Flip"-Halbkarten eingeblendet,
// die die alte obere Hälfte wegklappen und die neue untere Hälfte reinklappen.
function flapCharHtml(char) {
  const safe = /\s/.test(char) ? '&nbsp;' : escapeHtml(char);
  return `<span class="flap-char">${safe}</span>`;
}

function createFlapCard(char) {
  const card = document.createElement('div');
  card.className = 'flap-card';
  card.dataset.char = char;
  card.innerHTML =
    `<div class="flap-half flap-top">${flapCharHtml(char)}</div>` +
    `<div class="flap-half flap-bottom">${flapCharHtml(char)}</div>`;
  return card;
}

function updateFlapCard(card, newChar) {
  if (card.dataset.char === newChar) return;
  card.dataset.char = newChar;

  const top = card.querySelector('.flap-top');
  const bottom = card.querySelector('.flap-bottom');
  card.querySelectorAll('.flap-flip').forEach(n => n.remove());

  if (prefersReducedMotion) {
    top.innerHTML = flapCharHtml(newChar);
    bottom.innerHTML = flapCharHtml(newChar);
    return;
  }

  const foldTop = document.createElement('div');
  foldTop.className = 'flap-flip flap-flip-top';
  foldTop.innerHTML = top.innerHTML;

  const foldBottom = document.createElement('div');
  foldBottom.className = 'flap-flip flap-flip-bottom';
  foldBottom.innerHTML = flapCharHtml(newChar);

  bottom.innerHTML = flapCharHtml(newChar);
  card.appendChild(foldTop);
  card.appendChild(foldBottom);

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    top.innerHTML = flapCharHtml(newChar);
    foldTop.remove();
    foldBottom.remove();
  }
  foldBottom.addEventListener('animationend', finish);
  setTimeout(finish, 800); // Sicherheitsnetz falls die Animation aussetzt (z.B. Hintergrund-Tab)
}

function renderFlapBoard(container, text) {
  const chars = [...text];
  const existing = [...container.children];

  if (existing.length !== chars.length) {
    container.innerHTML = '';
    const cards = chars.map(ch => {
      const isSpace = /\s/.test(ch);
      const el = isSpace ? document.createElement('div') : createFlapCard(' ');
      if (isSpace) el.className = 'flap-space';
      container.appendChild(el);
      return { el, ch, isSpace };
    });

    // Beim (erneuten) Aufbau starten alle Karten blank und rasten dann von
    // links nach rechts nacheinander auf ihren Wert ein, statt sofort fertig
    // dazustehen — so sieht man den Flip-Effekt auch beim Laden/Neuladen.
    cards.forEach(({ el, ch, isSpace }, i) => {
      if (isSpace) return;
      if (prefersReducedMotion) {
        updateFlapCard(el, ch);
      } else {
        setTimeout(() => updateFlapCard(el, ch), i * 70);
      }
    });
    return;
  }

  chars.forEach((ch, i) => {
    const el = existing[i];
    if (el.classList.contains('flap-card')) updateFlapCard(el, ch);
  });
}

async function checkSession() {
  const res = await fetch('/api/me');
  if (res.ok) {
    currentData = await res.json();
    showDashboard();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pin-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  if (res.ok) {
    const meRes = await fetch('/api/me');
    currentData = await meRes.json();
    showDashboard();
  } else {
    errorEl.textContent = 'PIN ungültig — bitte nochmal versuchen.';
    document.getElementById('pin-input').value = '';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';

  document.getElementById('greeting').textContent = `Hallo ${currentData.name}`;
  document.getElementById('stamp-date').textContent = dateFmt(new Date().toISOString());
  renderFlapBoard(document.getElementById('balance-amount'), eur(currentData.balance));
  document.getElementById('daily-interest').textContent = eur(currentData.dailyInterest);
  document.getElementById('flex-balance-line').textContent = `Verfügbar: ${eur(currentData.cashBalance)}`;
  document.getElementById('flex-ledger-balance-amount').textContent = eur(currentData.cashBalance);
  renderKestExplainer();

  document.querySelectorAll('#dashboard > .stamp-card, #dashboard > .section').forEach((el, i) => {
    el.style.setProperty('--fade-i', i);
  });

  renderMessages();
  renderInvestments();
  loadAvailableProducts();
  renderLedger();
  setupPush().catch(err => console.error('Push-Setup fehlgeschlagen:', err));

  try {
    renderHistoryChart();
    renderCalculator();
  } catch (err) {
    console.error('Diagramme konnten nicht geladen werden:', err);
  }
}

const KEST_RATE = 0.275;
const pct = v => `${(v * 100).toFixed(2).replace('.', ',')}%`;

function renderKestExplainer() {
  const rate = currentData.annualRate;
  const netRate = rate * (1 - KEST_RATE);
  document.getElementById('kest-explainer').innerHTML =
    `Normale Banken behalten in Österreich automatisch 27,5% deiner Zinsgewinne als
    <strong>Kapitalertragssteuer (KESt)</strong> ein, bevor du sie siehst. Papi übernimmt
    diese Steuer für dich — du bekommst den vollen Zinssatz ohne Abzug.<br><br>
    Konkret: bei deinem FLEX-Zinssatz von ${pct(rate)} p.a. würde eine normale Bank dir
    nach KESt effektiv nur ${pct(netRate)} p.a. auszahlen. Ein Zinssatz, der hier
    "niedrig" wirkt, kann dir also trotzdem mehr bringen als ein höherer bei einer
    echten Bank.`;
}

document.getElementById('kest-info-btn').addEventListener('click', () => {
  const el = document.getElementById('kest-explainer');
  el.style.display = el.style.display === 'none' ? '' : 'none';
});

function renderHistoryChart() {
  const ctx = document.getElementById('history-chart');
  const history = currentData.history;

  if (!history.length) {
    ctx.parentElement.innerHTML += '<div class="empty-note">Noch keine Bewegungen — der Verlauf startet mit der ersten Einzahlung.</div>';
    return;
  }

  const labels = history.map(h => dateFmt(h.date));
  const values = history.map(h => h.balance);

  const accent = cssVar('--brass-bright');
  const muted = cssVar('--muted');
  const grid = cssVar('--chart-grid');

  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: accent,
        backgroundColor: accent + '1F',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      animation: chartAnimation,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: muted, maxTicksLimit: 6 }, grid: { display: false } },
        y: { ticks: { color: muted, callback: v => eur(v) }, grid: { color: grid } }
      }
    }
  });
}

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
  const startCapital = parseFloat(document.getElementById('calc-capital').value) || 0;
  const durationValue = parseFloat(document.getElementById('calc-duration').value) || 0;
  const durationUnit = document.getElementById('calc-duration-unit').value;
  const apy = (parseFloat(document.getElementById('calc-rate').value) || 0) / 100;
  const monthlyContribution = parseFloat(document.getElementById('calc-contribution').value) || 0;
  const frequency = document.getElementById('calc-frequency').value;

  const totalDays = Math.max(1, Math.round(durationValue * (durationUnit === 'years' ? 365 : 30.4368)));
  const { boundaries, valueAt, finalValue } = simulateCompoundSeries(startCapital, totalDays, apy, frequency, monthlyContribution);
  const totalContributed = contributedCapitalAtDay(startCapital, monthlyContribution, totalDays);

  let labels, capitalValues, interestValues;
  if (frequency === 'maturity') {
    labels = ['Start', 'Fällig'];
    capitalValues = [startCapital, totalContributed];
    interestValues = [0, Math.round((finalValue - totalContributed) * 100) / 100];
  } else {
    const yearly = totalDays > 365;
    const bucketDays = yearly ? 365 : 30;
    labels = [];
    capitalValues = [];
    interestValues = [];
    for (let day = 0, i = 0; ; day += bucketDays, i++) {
      const d = Math.min(day, totalDays);
      const v = valueAtDay(boundaries, valueAt, d);
      const contributed = contributedCapitalAtDay(startCapital, monthlyContribution, d);
      labels.push(i === 0 ? 'Start' : (yearly ? `Jahr ${i}` : `Monat ${i}`));
      capitalValues.push(contributed);
      interestValues.push(Math.round((v - contributed) * 100) / 100);
      if (d >= totalDays) break;
    }
  }

  const ctx = document.getElementById('calculator-chart');
  const muted = cssVar('--muted');
  const grid = cssVar('--chart-grid');

  if (calculatorChart) calculatorChart.destroy();
  calculatorChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Kapital', data: capitalValues, backgroundColor: cssVar('--stone') },
        { label: 'Zinsen', data: interestValues, backgroundColor: cssVar('--mist') }
      ]
    },
    options: {
      animation: chartAnimation,
      plugins: {
        legend: { display: true, labels: { color: muted, boxWidth: 12, font: { size: 11 } } }
      },
      scales: {
        x: { stacked: true, ticks: { color: muted }, grid: { display: false } },
        y: { stacked: true, ticks: { color: muted, callback: v => eur(v) }, grid: { color: grid } }
      }
    }
  });

  const durationText = `${durationValue} ${durationUnit === 'years' ? 'Jahr(en)' : 'Monat(en)'}`;
  const rateText = `${(apy * 100).toFixed(2).replace('.', ',')}% p.a.`;
  const contributionText = monthlyContribution > 0
    ? ` zzgl. ${eur(monthlyContribution)} monatlichem Sparbeitrag (insgesamt ${eur(totalContributed)} eingezahltes Kapital)`
    : '';
  document.getElementById('calculator-footnote').textContent =
    `Bei ${rateText} (Zinszubuchung ${frequencyLabels[frequency]}) würde aus ${eur(startCapital)}${contributionText} in ${durationText} rechnerisch ${eur(finalValue)} werden (davon ${eur(finalValue - totalContributed)} Zinsen).`;
}

document.getElementById('calculator-form').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    renderCalculator();
  } catch (err) {
    console.error('Rechner konnte nicht aktualisiert werden:', err);
  }
});

// Chart.js rendert in ein verstecktes <canvas> mit Breite 0, solange der
// umgebende <details>-Block zugeklappt ist — beim Aufklappen neu zeichnen.
document.getElementById('calculator-details').addEventListener('toggle', (e) => {
  if (e.target.open && currentData) {
    try {
      renderCalculator();
    } catch (err) {
      console.error('Rechner konnte nicht aktualisiert werden:', err);
    }
  }
});

function renderLedger() {
  const body = document.getElementById('ledger-body');
  const empty = document.getElementById('ledger-empty');
  const txs = [...currentData.transactions].reverse();

  if (!txs.length) {
    empty.style.display = 'block';
    return;
  }

  body.innerHTML = txs.map((tx, i) => {
    const sign = tx.type === 'withdrawal' ? '−' : '+';
    const cls = tx.type === 'deposit' ? 'tx-deposit' : tx.type === 'withdrawal' ? 'tx-withdrawal' : 'tx-interest';
    return `<tr style="--fade-i: ${Math.min(i, 12)}">
      <td>${dateFmt(tx.date)}</td>
      <td class="${cls}">${typeLabels[tx.type]}</td>
      <td style="text-align:right;" class="${cls}">${sign} ${eur(tx.amount)}</td>
    </tr>`;
  }).join('');
}

function renderMessages() {
  const container = document.getElementById('message-banners');
  const messages = currentData.messages || [];

  container.innerHTML = messages.map(m => `<div class="message-banner" data-id="${m.id}">
      <div class="message-banner-body">${escapeHtml(m.body)}</div>
      <button class="message-banner-dismiss" data-id="${m.id}" type="button" aria-label="Nachricht schließen">×</button>
    </div>`).join('');

  container.querySelectorAll('.message-banner-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await fetch('/api/dismiss-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id })
      });
      container.querySelector(`.message-banner[data-id="${id}"]`).remove();
    });
  });
}

function renderInvestments() {
  const section = document.getElementById('investments-section');
  const investments = currentData.investments || [];

  if (!investments.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const body = document.getElementById('investment-body');
  body.innerHTML = investments.map((inv, i) => {
    const infoBtn = inv.description ? `<button class="info-btn" data-desc="inv-${i}" type="button" title="Info">ⓘ</button>` : '';
    const descRow = inv.description
      ? `<tr id="desc-inv-${i}" style="display:none;"><td colspan="4"><div class="product-description">${escapeHtml(inv.description)}</div></td></tr>`
      : '';
    const interestAtMaturity = Math.round((inv.maturityValue - inv.principal) * 100) / 100;
    return `<tr>
      <td>${escapeHtml(inv.productName)}${infoBtn}</td>
      <td>${inv.daysRemaining} Tage</td>
      <td>${eur(inv.currentValue)}</td>
      <td>${eur(interestAtMaturity)}</td>
    </tr>${descRow}`;
  }).join('');

  body.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`desc-${btn.dataset.desc}`);
      row.style.display = row.style.display === 'none' ? '' : 'none';
    });
  });
}

const frequencyLabels = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich', maturity: 'endfällig' };

async function loadAvailableProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  renderAvailableProducts(data.products || []);
}

function renderAvailableProducts(products) {
  const section = document.getElementById('products-section');
  if (!products.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const body = document.getElementById('available-product-body');
  body.innerHTML = products.map(p => {
    const infoBtn = p.description ? `<button class="info-btn" data-desc="prod-${p.id}" type="button" title="Info">ⓘ</button>` : '';
    const descRow = p.description
      ? `<tr id="desc-prod-${p.id}" style="display:none;"><td colspan="4"><div class="product-description">${escapeHtml(p.description)}</div></td></tr>`
      : '';
    return `<tr>
      <td>${escapeHtml(p.name)}${infoBtn}</td>
      <td>${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'}</td>
      <td>${(p.apy * 100).toFixed(2).replace('.', ',')}%</td>
      <td>${frequencyLabels[p.interest_frequency]}</td>
    </tr>${descRow}`;
  }).join('');

  body.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`desc-${btn.dataset.desc}`);
      row.style.display = row.style.display === 'none' ? '' : 'none';
    });
  });

  const select = document.getElementById('invest-product');
  select.innerHTML = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${(p.apy * 100).toFixed(2).replace('.', ',')}%, ${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'})</option>`).join('');
}

document.getElementById('invest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('invest-message');
  msgEl.textContent = '';
  msgEl.classList.remove('pin-change-success');

  const body = {
    productId: parseInt(document.getElementById('invest-product').value, 10),
    amount: parseFloat(document.getElementById('invest-amount').value)
  };
  const res = await fetch('/api/invest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('invest-amount').value = '';
    const meRes = await fetch('/api/me');
    currentData = await meRes.json();
    showDashboard();
    const refreshedMsgEl = document.getElementById('invest-message');
    refreshedMsgEl.textContent = 'Investition angelegt!';
    refreshedMsgEl.classList.add('pin-change-success');
  } else {
    msgEl.textContent = data.error || 'Investition konnte nicht angelegt werden.';
  }
});

document.getElementById('payout-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('payout-request-message');
  msgEl.textContent = '';
  msgEl.classList.remove('pin-change-success');

  const body = {
    amount: parseFloat(document.getElementById('payout-amount').value),
    note: document.getElementById('payout-note').value
  };
  const res = await fetch('/api/payout-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('payout-amount').value = '';
    document.getElementById('payout-note').value = '';
    msgEl.textContent = 'Antrag gesendet — Papi wurde informiert.';
    msgEl.classList.add('pin-change-success');
  } else {
    msgEl.textContent = data.error || 'Antrag konnte nicht gesendet werden.';
  }
});

document.getElementById('pin-change-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPin = document.getElementById('current-pin').value;
  const newPin = document.getElementById('new-pin').value;
  const newPinConfirm = document.getElementById('new-pin-confirm').value;
  const msgEl = document.getElementById('pin-change-message');
  msgEl.textContent = '';
  msgEl.classList.remove('pin-change-success');

  if (newPin !== newPinConfirm) {
    msgEl.textContent = 'Neue PIN stimmt nicht mit der Wiederholung überein.';
    return;
  }

  const res = await fetch('/api/change-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPin, newPin })
  });

  const data = await res.json();
  if (res.ok) {
    msgEl.textContent = 'PIN erfolgreich geändert.';
    msgEl.classList.add('pin-change-success');
    document.getElementById('pin-change-form').reset();
  } else {
    msgEl.textContent = data.error || 'PIN konnte nicht geändert werden.';
  }
});

document.addEventListener('themechange', () => {
  if (!currentData) return;
  try {
    renderHistoryChart();
    renderCalculator();
  } catch (err) {
    console.error('Diagramme konnten nach Theme-Wechsel nicht neu geladen werden:', err);
  }
});

checkSession();
