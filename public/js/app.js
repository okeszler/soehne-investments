const eur = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(n);
const dateFmt = (isoDate) => new Date(isoDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let currentData = null;
let historyChart = null;
let projectionChart = null;

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

function animateNumber(el, to, formatFn) {
  if (prefersReducedMotion) {
    el.textContent = formatFn(to);
    return;
  }
  const duration = 600;
  const start = performance.now();
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    el.textContent = formatFn(to);
  }
  function tick(now) {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatFn(to * eased);
    if (t < 1) requestAnimationFrame(tick);
    else finish();
  }
  requestAnimationFrame(tick);
  setTimeout(finish, duration + 150); // Sicherheitsnetz falls rAF ausgesetzt wird (z.B. Hintergrund-Tab)
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
  animateNumber(document.getElementById('balance-amount'), currentData.balance, eur);
  document.getElementById('daily-interest').textContent = eur(currentData.dailyInterest);
  const hasInvestments = (currentData.investments || []).length > 0;
  const flexRateText = `FLEX ${(currentData.annualRate * 100).toFixed(2).replace('.', ',')}% p.a.`;
  document.getElementById('rate-display').textContent = hasInvestments
    ? `${flexRateText} + Anlagen`
    : flexRateText;

  const flexLine = document.getElementById('flex-balance-line');
  if (hasInvestments) {
    flexLine.style.display = 'block';
    flexLine.textContent = `davon FLEX: ${eur(currentData.cashBalance)}`;
  } else {
    flexLine.style.display = 'none';
  }

  document.querySelectorAll('#dashboard > .stamp-card, #dashboard > .section').forEach((el, i) => {
    el.style.setProperty('--fade-i', i);
  });

  renderMessages();
  renderInvestments();
  renderLedger();
  setupPush().catch(err => console.error('Push-Setup fehlgeschlagen:', err));

  try {
    renderHistoryChart();
    renderProjectionChart('5');
  } catch (err) {
    console.error('Diagramme konnten nicht geladen werden:', err);
  }

  document.querySelectorAll('.horizon-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.horizon-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      try {
        renderProjectionChart(btn.dataset.years);
      } catch (err) {
        console.error('Diagramm konnte nicht geladen werden:', err);
      }
    });
  });
}

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

function renderProjectionChart(years) {
  const points = currentData.projections[years];
  const ctx = document.getElementById('projection-chart');

  const labels = points.map(p => p.year === 0 ? 'Start' : `Jahr ${p.year}`);
  const capitalValues = points.map(p => p.capital);
  const interestValues = points.map(p => p.interest);

  const muted = cssVar('--muted');
  const grid = cssVar('--chart-grid');

  if (projectionChart) projectionChart.destroy();
  projectionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Kapital',
          data: capitalValues,
          backgroundColor: cssVar('--stone')
        },
        {
          label: 'Zinsen',
          data: interestValues,
          backgroundColor: cssVar('--mist')
        }
      ]
    },
    options: {
      animation: chartAnimation,
      plugins: {
        legend: {
          display: true,
          labels: { color: muted, boxWidth: 12, font: { size: 11 } }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: muted }, grid: { display: false } },
        y: { stacked: true, ticks: { color: muted, callback: v => eur(v) }, grid: { color: grid } }
      }
    }
  });

  const start = currentData.cashBalance;
  const end = points[points.length - 1].value;
  const rateText = `FLEX-Zinssatz von ${(currentData.annualRate * 100).toFixed(2).replace('.', ',')}% p.a.`;
  const contribution = currentData.monthlyContribution || 0;
  const contributionText = contribution > 0
    ? ` und deiner automatischen monatlichen Zahlung von ${eur(contribution)} (z.B. Taschengeld)`
    : contribution < 0
      ? ` und deiner automatischen monatlichen Abbuchung von ${eur(Math.abs(contribution))}`
      : ' und ohne weitere Ein-/Auszahlungen';
  document.getElementById('projection-footnote').textContent =
    `Fiktiv: bei ${rateText}${contributionText} würde dein FLEX-Guthaben von ${eur(start)} in ${years} Jahr(en) rechnerisch auf ${eur(end)} wachsen.`;
}

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
      <div class="message-banner-body">${m.body}</div>
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
      ? `<tr id="desc-inv-${i}" style="display:none;"><td colspan="4"><div class="product-description">${inv.description}</div></td></tr>`
      : '';
    return `<tr>
      <td>${inv.productName}${infoBtn}</td>
      <td>${eur(inv.principal)}</td>
      <td>${eur(inv.balance)}</td>
      <td>${dateFmt(inv.maturityDate)}</td>
    </tr>${descRow}`;
  }).join('');

  body.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`desc-${btn.dataset.desc}`);
      row.style.display = row.style.display === 'none' ? '' : 'none';
    });
  });
}

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
    const activeTab = document.querySelector('.horizon-tab.active');
    renderProjectionChart(activeTab ? activeTab.dataset.years : '5');
  } catch (err) {
    console.error('Diagramme konnten nach Theme-Wechsel nicht neu geladen werden:', err);
  }
});

checkSession();
