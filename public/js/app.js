const eur = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(n);
const dateFmt = (isoDate) => new Date(isoDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };

let currentData = null;
let historyChart = null;
let projectionChart = null;

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
  document.getElementById('balance-amount').textContent = eur(currentData.balance);
  document.getElementById('daily-interest').textContent = eur(currentData.dailyInterest);
  document.getElementById('rate-display').textContent = `${(currentData.annualRate * 100).toFixed(2).replace('.', ',')}%`;

  renderLedger();

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

  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#90AFC5',
        backgroundColor: 'rgba(144,175,197,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#90AFC5', maxTicksLimit: 6 }, grid: { display: false } },
        y: { ticks: { color: '#90AFC5', callback: v => eur(v) }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

function renderProjectionChart(years) {
  const points = currentData.projections[years];
  const ctx = document.getElementById('projection-chart');

  const labels = points.map(p => `Monat ${p.month}`);
  const values = points.map(p => p.value);

  if (projectionChart) projectionChart.destroy();
  projectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#336B87',
        backgroundColor: 'rgba(51,107,135,0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { display: false }, grid: { display: false } },
        y: { ticks: { color: '#90AFC5', callback: v => eur(v) }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });

  const start = currentData.balance;
  const end = points[points.length - 1].value;
  document.getElementById('projection-footnote').textContent =
    `Fiktiv: bei ${(currentData.annualRate * 100).toFixed(2).replace('.', ',')}% p.a. und ohne weitere Ein-/Auszahlungen würde aus ${eur(start)} in ${years} Jahr(en) rechnerisch ${eur(end)} werden.`;
}

function renderLedger() {
  const body = document.getElementById('ledger-body');
  const empty = document.getElementById('ledger-empty');
  const txs = [...currentData.transactions].reverse();

  if (!txs.length) {
    empty.style.display = 'block';
    return;
  }

  body.innerHTML = txs.map(tx => {
    const sign = tx.type === 'withdrawal' ? '−' : '+';
    const cls = tx.type === 'deposit' ? 'tx-deposit' : tx.type === 'withdrawal' ? 'tx-withdrawal' : 'tx-interest';
    return `<tr>
      <td>${dateFmt(tx.date)}</td>
      <td class="${cls}">${typeLabels[tx.type]}</td>
      <td style="text-align:right;" class="${cls}">${sign} ${eur(tx.amount)}</td>
    </tr>`;
  }).join('');
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

checkSession();
