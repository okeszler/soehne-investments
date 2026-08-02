const eur = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(n);
const dateFmt = (isoDate) => new Date(isoDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };

let sons = [];
let activeSonId = null;
let recurring = [];

async function checkSession() {
  const res = await fetch('/api/admin/sons');
  if (res.ok) {
    const data = await res.json();
    sons = data.sons;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';
    renderSonPicker();
    if (sons.length) selectSon(sons[0].id);
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pin-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  const res = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  if (res.ok) {
    checkSession();
  } else {
    errorEl.textContent = 'PIN ungültig.';
    document.getElementById('pin-input').value = '';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

function renderSonPicker() {
  const picker = document.getElementById('son-picker');
  picker.innerHTML = sons.map(s =>
    `<button class="son-pill" data-id="${s.id}">${s.name} · ${eur(s.balance)}</button>`
  ).join('');
  picker.querySelectorAll('.son-pill').forEach(btn => {
    btn.addEventListener('click', () => selectSon(Number(btn.dataset.id)));
  });
}

async function selectSon(id) {
  activeSonId = id;
  document.querySelectorAll('.son-pill').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.id) === id);
  });
  const son = sons.find(s => s.id === id);
  document.getElementById('rate-input').value = (son.annual_rate * 100).toFixed(2);
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  await loadTransactions();
  await loadRecurring();
}

async function loadRecurring() {
  const res = await fetch('/api/admin/recurring');
  const data = await res.json();
  recurring = (data.recurring || []).filter(r => r.son_id === activeSonId);
  renderRecurring();
}

function renderRecurring() {
  const body = document.getElementById('recurring-body');
  const empty = document.getElementById('recurring-empty');

  if (!recurring.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = recurring.map(r => {
    const cls = r.type === 'deposit' ? 'tx-deposit' : r.type === 'withdrawal' ? 'tx-withdrawal' : 'tx-interest';
    return `<tr>
      <td class="${cls}">${typeLabels[r.type]}</td>
      <td class="${cls}">${eur(r.amount)}</td>
      <td>${r.note || ''}</td>
      <td><button class="tx-delete" data-id="${r.id}">Löschen</button></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/recurring?id=${btn.dataset.id}`, { method: 'DELETE' });
      await loadRecurring();
    });
  });
}

document.getElementById('recurring-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    sonId: activeSonId,
    type: document.getElementById('recurring-type').value,
    amount: parseFloat(document.getElementById('recurring-amount').value),
    note: document.getElementById('recurring-note').value
  };
  await fetch('/api/admin/recurring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('recurring-amount').value = '';
  document.getElementById('recurring-note').value = '';
  await loadRecurring();
});

async function loadTransactions() {
  const res = await fetch(`/api/admin/transactions?sonId=${activeSonId}`);
  const data = await res.json();
  const body = document.getElementById('tx-body');
  const empty = document.getElementById('tx-empty');

  if (!data.transactions.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = data.transactions.map(tx => {
    const cls = tx.type === 'deposit' ? 'tx-deposit' : tx.type === 'withdrawal' ? 'tx-withdrawal' : 'tx-interest';
    return `<tr>
      <td>${dateFmt(tx.date)}</td>
      <td class="${cls}">${typeLabels[tx.type]}</td>
      <td class="${cls}">${eur(tx.amount)}</td>
      <td><button class="tx-delete" data-id="${tx.id}">Löschen</button></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/transactions?id=${btn.dataset.id}`, { method: 'DELETE' });
      await loadTransactions();
      await refreshSonBalance();
    });
  });
}

async function refreshSonBalance() {
  const res = await fetch('/api/admin/sons');
  const data = await res.json();
  sons = data.sons;
  renderSonPicker();
  document.querySelectorAll('.son-pill').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.id) === activeSonId);
  });
}

document.getElementById('tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    sonId: activeSonId,
    date: document.getElementById('tx-date').value,
    type: document.getElementById('tx-type').value,
    amount: parseFloat(document.getElementById('tx-amount').value),
    note: document.getElementById('tx-note').value
  };
  await fetch('/api/admin/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  await loadTransactions();
  await refreshSonBalance();
});

document.getElementById('rate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const annualRate = parseFloat(document.getElementById('rate-input').value) / 100;
  await fetch('/api/admin/sons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sonId: activeSonId, annualRate })
  });
  await refreshSonBalance();
});

checkSession();
