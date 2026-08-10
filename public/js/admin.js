const eur = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(n);
const dateFmt = (isoDate) => new Date(isoDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };

let sons = [];
let activeSonId = null;
let recurring = [];
let products = [];

const frequencyLabels = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich', maturity: 'endfällig' };

async function checkSession() {
  const res = await fetch('/api/admin/sons');
  if (res.ok) {
    const data = await res.json();
    sons = data.sons;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';
    renderSonPicker();
    if (sons.length) selectSon(sons[0].id);
    await loadProducts();
    populateMessageRecipients();
    await loadMessages();
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
  document.getElementById('investment-message').textContent = '';
  await loadTransactions();
  await loadRecurring();
  await loadInvestments();
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

async function loadProducts() {
  const res = await fetch('/api/admin/products');
  const data = await res.json();
  products = data.products || [];
  renderProducts();
}

function renderProducts() {
  const body = document.getElementById('product-body');
  const empty = document.getElementById('product-empty');

  if (!products.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';

    body.innerHTML = products.map(p => {
      const infoBtn = p.description ? `<button class="info-btn" data-desc="${p.id}" type="button" title="Info">ⓘ</button>` : '';
      const descRow = p.description
        ? `<tr id="desc-${p.id}" style="display:none;"><td colspan="5"><div class="product-description">${p.description}</div></td></tr>`
        : '';
      return `<tr style="${p.active ? '' : 'opacity:0.5;'}">
        <td>${p.name}${infoBtn}</td>
        <td>${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'}</td>
        <td>${(p.apy * 100).toFixed(2).replace('.', ',')}%</td>
        <td>${frequencyLabels[p.interest_frequency]}</td>
        <td><button class="tx-delete" data-id="${p.id}">Löschen</button></td>
      </tr>${descRow}`;
    }).join('');

    body.querySelectorAll('.tx-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/products?id=${btn.dataset.id}`, { method: 'DELETE' });
        await loadProducts();
      });
    });

    body.querySelectorAll('.info-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = document.getElementById(`desc-${btn.dataset.desc}`);
        row.style.display = row.style.display === 'none' ? '' : 'none';
      });
    });
  }

  const select = document.getElementById('investment-product');
  const activeProducts = products.filter(p => p.active);
  select.innerHTML = activeProducts.length
    ? activeProducts.map(p => `<option value="${p.id}">${p.name} (${(p.apy * 100).toFixed(2).replace('.', ',')}%, ${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'})</option>`).join('')
    : '<option value="">Kein Produkt verfügbar</option>';
}

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById('product-name').value,
    lockDays: parseInt(document.getElementById('product-lock-days').value, 10),
    apy: parseFloat(document.getElementById('product-apy').value) / 100,
    interestFrequency: document.getElementById('product-frequency').value,
    description: document.getElementById('product-description').value
  };
  await fetch('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('product-form').reset();
  await loadProducts();
});

async function loadInvestments() {
  const res = await fetch(`/api/admin/investments?sonId=${activeSonId}`);
  const data = await res.json();
  renderInvestments(data.investments || []);
}

function renderInvestments(investments) {
  const body = document.getElementById('investment-body');
  const empty = document.getElementById('investment-empty');

  if (!investments.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = investments.map(inv => `<tr style="${inv.status === 'paid_out' ? 'opacity:0.5;' : ''}">
      <td>${inv.product_name}</td>
      <td>${eur(inv.principal)}</td>
      <td>${eur(inv.balance)}</td>
      <td>${dateFmt(inv.maturity_date)}</td>
      <td>${inv.status === 'active' ? 'aktiv' : 'ausgezahlt'}</td>
    </tr>`).join('');
}

document.getElementById('investment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById('investment-message');
  messageEl.textContent = '';
  const body = {
    sonId: activeSonId,
    productId: parseInt(document.getElementById('investment-product').value, 10),
    amount: parseFloat(document.getElementById('investment-amount').value)
  };
  const res = await fetch('/api/admin/investments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('investment-amount').value = '';
    await loadInvestments();
    await loadTransactions();
    await refreshSonBalance();
  } else {
    messageEl.textContent = data.error || 'Investition konnte nicht angelegt werden.';
  }
});

function populateMessageRecipients() {
  const select = document.getElementById('message-recipient');
  select.innerHTML = '<option value="">Alle Söhne</option>' +
    sons.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function loadMessages() {
  const res = await fetch('/api/admin/messages');
  const data = await res.json();
  renderMessages(data.messages || []);
}

function renderMessages(messages) {
  const body = document.getElementById('message-body-list');
  const empty = document.getElementById('message-empty');

  if (!messages.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = messages.map(m => `<tr>
      <td>${m.son_name || 'Alle'}</td>
      <td>${m.body}</td>
      <td><button class="tx-delete" data-id="${m.id}">Löschen</button></td>
    </tr>`).join('');

  body.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/messages?id=${btn.dataset.id}`, { method: 'DELETE' });
      await loadMessages();
    });
  });
}

document.getElementById('message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const recipient = document.getElementById('message-recipient').value;
  const body = {
    sonId: recipient ? parseInt(recipient, 10) : null,
    body: document.getElementById('message-body').value
  };
  await fetch('/api/admin/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('message-form').reset();
  await loadMessages();
});

checkSession();
