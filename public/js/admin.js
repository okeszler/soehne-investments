// Verwaltung: Konditionen pro Person, Buchungen, automatische Buchungen, Nachrichten,
// Investitionen und Anlageprodukte. Gemeinsame Helfer kommen aus ui.js.

let sons = [];
let activeSonId = null;
let products = [];
let messages = [];
let editingProductId = null;
let txExpanded = false;
let freshChange = false;
const TX_PAGE = 8;

const activeSon = () => sons.find(s => s.id === activeSonId);

// ---------- Login ----------
const keypad = setupKeypad({
  input: $('#pin-input'), dots: $('#pin-dots'), keypad: $('#keypad'), minLength: 4,
  onSubmit: async pin => {
    $('#login-error').textContent = '';
    const res = await api('/api/admin-login', { method: 'POST', body: { pin } });
    if (res.ok) { keypad.success(); await start(); }
    else { $('#login-error').textContent = 'PIN stimmt nicht.'; keypad.fail(); }
  }
});

async function start() {
  const res = await api('/api/admin/sons');
  if (!res.ok) { $('#admin').hidden = true; $('#login').hidden = false; keypad.reset(); return; }
  sons = res.data.sons || [];
  $('#login').hidden = true;
  $('#admin').hidden = false;
  if (!activeSonId && sons.length) activeSonId = sons[0].id;
  renderPeople();
  $('#tx-date').value = new Date().toISOString().slice(0, 10);
  await Promise.all([loadProducts(), loadMessages()]);
  await selectSon(activeSonId);
}

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

// Zweistufiges Löschen: erster Klick fragt nach, zweiter löscht.
function confirmButton(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const original = btn.innerHTML;
  btn.innerHTML = '<span style="font-size:12px;font-weight:700;padding:0 6px">Löschen?</span>';
  btn.style.width = 'auto';
  setTimeout(() => { delete btn.dataset.armed; btn.innerHTML = original; btn.style.width = ''; }, 3000);
  return false;
}
const deleteBtn = (attr, id, label) => `<button type="button" class="icon-sm" ${attr}="${id}" aria-label="${label}">${svgIcon('trash')}</button>`;

// ---------- Personen ----------
async function refreshSons() {
  const res = await api('/api/admin/sons');
  if (res.ok) sons = res.data.sons || [];
  renderPeople();
}

function renderPeople() {
  $('#people').innerHTML = sons.map(s => `<button type="button" class="person" data-son="${s.id}" aria-pressed="${s.id === activeSonId}">
      <span class="avatar">${escapeHtml(s.name[0] || '?')}</span>
      <span><span class="pn">${escapeHtml(s.name)}</span><br><span class="pb num">${eur(s.balance)}</span></span></button>`).join('');
  populateRecipients();
}

$('#people').addEventListener('click', e => {
  const b = e.target.closest('[data-son]');
  if (b) selectSon(Number(b.dataset.son));
});

async function selectSon(id) {
  activeSonId = id;
  txExpanded = false;
  document.querySelectorAll('[data-son]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.son) === id));
  renderConditions();
  renderTxTypes();
  renderMsgPreview();
  await Promise.all([loadTransactions(), loadRecurring(), loadInvestments()]);
}

// ---------- Konditionen ----------
function conditionText(c) {
  return `FLEX ${pct(c.annual_rate)} · ${c.cashback_rate > 0 ? 'Cashback ' + pctShort(c.cashback_rate) : 'kein Cashback'}${c.kest_rate > 0 ? ' · KESt ' + pctShort(c.kest_rate) : ''}`;
}

function renderConditions() {
  const s = activeSon();
  if (!s) return;
  $('#cond-title').textContent = `Konditionen für ${s.name}`;
  $('#a-flex').value = (s.annual_rate * 100).toFixed(2);
  const cbOn = s.cashback_rate > 0;
  $('#a-cb-on').setAttribute('aria-checked', cbOn);
  $('#a-cb').value = ((cbOn ? s.cashback_rate : 0.03) * 100).toFixed(1);
  $('#a-cb').disabled = !cbOn;
  $('#a-kest').value = String(s.kest_rate);
  if (![...$('#a-kest').options].some(o => o.value === String(s.kest_rate))) {
    $('#a-kest').insertAdjacentHTML('beforeend', `<option value="${s.kest_rate}">${pctShort(s.kest_rate)}</option>`);
    $('#a-kest').value = String(s.kest_rate);
  }
  $('#a-sender').value = s.sender_name || '';
  const changes = s.changes || [];
  $('#cond-hist').innerHTML = changes.length
    ? '<div style="font-weight:600;color:var(--ink)">Änderungsverlauf</div>' + changes.map((c, i) =>
      `<div class="${i === 0 && freshChange ? 'new' : ''}"><span>${conditionText(c)}</span><span class="num">ab ${dateFmt(c.changed_at)}</span></div>`).join('')
    : '';
  freshChange = false;
}

$('#a-cb-on').addEventListener('click', e => {
  const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', on);
  $('#a-cb').disabled = !on;
  if (on) $('#a-cb').focus();
});

$('#cond-form').addEventListener('submit', async e => {
  e.preventDefault();
  const s = activeSon();
  const cbOn = $('#a-cb-on').getAttribute('aria-checked') === 'true';
  const body = {
    sonId: s.id,
    annualRate: Math.round(Number($('#a-flex').value) * 100) / 10000,
    cashbackRate: cbOn ? Math.round(Number($('#a-cb').value) * 100) / 10000 : 0,
    kestRate: Number($('#a-kest').value),
    senderName: $('#a-sender').value.trim()
  };
  if (cbOn && !(body.cashbackRate > 0)) { toast('Bitte einen Cashback-Satz über 0 % eintragen oder Cashback ausschalten', 'error'); return; }
  const res = await api('/api/admin/sons', { method: 'POST', body });
  if (!res.ok) { toast(res.data.error || 'Konditionen konnten nicht gespeichert werden', 'error'); return; }
  const before = (s.changes || []).length;
  await refreshSons();
  freshChange = (activeSon().changes || []).length > before || (activeSon().changes || [])[0]?.changed_at !== (s.changes || [])[0]?.changed_at;
  renderConditions();
  renderTxTypes();
  renderMsgPreview();
  toast(`Gespeichert. ${s.name} sieht die neuen Werte beim nächsten Öffnen.`);
});

// ---------- Buchungen ----------
function renderTxTypes() {
  const s = activeSon();
  const opts = [['deposit', 'Einzahlung'], ['withdrawal', 'Auszahlung'], ['interest', 'Zinsgutschrift']];
  // Curve-Zahlung nur anbieten, wenn für diese Person Cashback aktiv ist
  if (s && s.cashback_rate > 0) opts.push(['curve_payment', `Curve-Zahlung (+${pctShort(s.cashback_rate)})`]);
  const prev = $('#tx-type').value;
  $('#tx-type').innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (opts.some(o => o[0] === prev)) $('#tx-type').value = prev;
  txHint();
}

function txHint() {
  const s = activeSon();
  const amount = Number($('#tx-amount').value) || 0;
  const type = $('#tx-type').value;
  let text = '';
  if (type === 'curve_payment') text = `Bucht den Betrag ab und schreibt ${amount ? eur(Math.round(amount * s.cashback_rate * 100) / 100) : pctShort(s.cashback_rate)} Cashback gut.`;
  else if (type === 'interest' && s && s.kest_rate > 0) text = `Hinweis: Für ${s.name} gilt ${pctShort(s.kest_rate)} KESt. Bei manuellen Zinsgutschriften bitte den Nettobetrag buchen.`;
  $('#tx-hint').textContent = text;
}
$('#tx-type').addEventListener('change', txHint);
$('#tx-amount').addEventListener('input', txHint);

async function loadTransactions() {
  const res = await api(`/api/admin/transactions?sonId=${activeSonId}`);
  const txs = res.data.transactions || [];
  const visible = txExpanded ? txs : txs.slice(0, TX_PAGE);
  $('#tx-list').innerHTML = visible.length ? visible.map(tx => {
    const debit = isDebit(tx.type);
    return `<div class="list-row"><div style="display:flex;gap:12px;align-items:center;min-width:0">
        <span class="tx-ic ${TX_ICON_CLASS[tx.type] || ''}">${svgIcon(tx.type)}</span>
        <div style="min-width:0"><div class="t">${escapeHtml(tx.type === 'kest' ? 'KESt' : (tx.note || TX_LABELS[tx.type]))}</div>
        <div class="s">${dateFmt(tx.date)} · ${TX_LABELS[tx.type]} · <b class="num" style="color:${debit ? 'var(--ink)' : 'var(--pos)'}">${debit ? '−' : '+'}${eur(tx.amount)}</b></div></div></div>
      <div class="row-actions">${deleteBtn('data-del-tx', tx.id, 'Buchung löschen')}</div></div>`;
  }).join('') : '<div class="empty">Noch keine Buchungen für diese Person.</div>';
  $('#tx-show-all').hidden = txs.length <= TX_PAGE;
  $('#tx-show-all').textContent = txExpanded ? 'Weniger anzeigen' : `Alle ${txs.length} anzeigen`;
}
$('#tx-show-all').addEventListener('click', () => { txExpanded = !txExpanded; loadTransactions(); });

$('#tx-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-del-tx]');
  if (!b || !confirmButton(b)) return;
  await api(`/api/admin/transactions?id=${b.dataset.delTx}`, { method: 'DELETE' });
  toast('Buchung gelöscht');
  await Promise.all([loadTransactions(), refreshSons()]);
});

$('#tx-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    sonId: activeSonId,
    date: $('#tx-date').value,
    type: $('#tx-type').value,
    amount: Number($('#tx-amount').value),
    note: $('#tx-note').value
  };
  const res = await api('/api/admin/transactions', { method: 'POST', body });
  if (!res.ok) { toast(res.data.error || 'Buchung konnte nicht gespeichert werden', 'error'); return; }
  $('#tx-amount').value = '';
  $('#tx-note').value = '';
  txHint();
  toast(`Buchung für ${activeSon().name} gespeichert`);
  await Promise.all([loadTransactions(), refreshSons()]);
});

// ---------- Automatische Buchungen ----------
async function loadRecurring() {
  const res = await api('/api/admin/recurring');
  const list = (res.data.recurring || []).filter(r => r.son_id === activeSonId);
  $('#rec-list').innerHTML = list.length ? list.map(r => `<div class="list-row">
      <div><div class="t">${escapeHtml(r.note || TX_LABELS[r.type])}</div><div class="s">${TX_LABELS[r.type]} · <b class="num">${eur(r.amount)}</b> · jeden 1. des Monats</div></div>
      <div class="row-actions">${deleteBtn('data-del-rec', r.id, 'Automatische Buchung löschen')}</div></div>`).join('')
    : '<div class="empty">Keine automatische Buchung für diese Person.</div>';
}

$('#rec-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-del-rec]');
  if (!b || !confirmButton(b)) return;
  await api(`/api/admin/recurring?id=${b.dataset.delRec}`, { method: 'DELETE' });
  toast('Automatische Buchung gelöscht');
  await loadRecurring();
});

$('#rec-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { sonId: activeSonId, type: $('#rec-type').value, amount: Number($('#rec-amount').value), note: $('#rec-note').value };
  const res = await api('/api/admin/recurring', { method: 'POST', body });
  if (!res.ok) { toast(res.data.error || 'Konnte nicht angelegt werden', 'error'); return; }
  e.target.reset();
  toast('Automatische Buchung angelegt');
  await loadRecurring();
});

// ---------- Nachrichten ----------
function populateRecipients() {
  const prev = $('#msg-to').value;
  $('#msg-to').innerHTML = '<option value="">Alle</option>' + sons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (prev && sons.some(s => String(s.id) === prev)) $('#msg-to').value = prev;
}

function renderMsgPreview() {
  const to = $('#msg-to').value;
  const target = to ? sons.find(s => String(s.id) === to) : activeSon();
  if (!target) return;
  const from = target.sender_name ? `Nachricht von ${escapeHtml(target.sender_name)}` : 'Neue Nachricht';
  $('#msg-preview').innerHTML = `<div class="ico">${svgIcon('message', 16)}</div>
    <div><b>${from}</b><span>${escapeHtml($('#msg-body').value || '…')}</span>${to ? '' : `<br><span style="font-size:12px">So sieht es ${escapeHtml(target.name)}. Jede Person sieht ihren eigenen Absendernamen.</span>`}</div>`;
}
$('#msg-body').addEventListener('input', renderMsgPreview);
$('#msg-to').addEventListener('change', renderMsgPreview);

async function loadMessages() {
  const res = await api('/api/admin/messages');
  messages = res.data.messages || [];
  $('#msg-list').innerHTML = messages.length ? '<div class="preview-label" style="margin-bottom:4px">Gesendet</div>' + messages.map(m => `<div class="list-row">
      <div style="min-width:0"><div class="t">${escapeHtml(m.body)}</div><div class="s">an ${escapeHtml(m.son_name || 'alle')} · ${dateFmt(m.created_at)}</div></div>
      <div class="row-actions">${deleteBtn('data-del-msg', m.id, 'Nachricht löschen')}</div></div>`).join('')
    : '';
}

$('#msg-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-del-msg]');
  if (!b || !confirmButton(b)) return;
  await api(`/api/admin/messages?id=${b.dataset.delMsg}`, { method: 'DELETE' });
  toast('Nachricht gelöscht');
  await loadMessages();
});

$('#msg-form').addEventListener('submit', async e => {
  e.preventDefault();
  const to = $('#msg-to').value;
  const res = await api('/api/admin/messages', { method: 'POST', body: { sonId: to ? Number(to) : null, body: $('#msg-body').value } });
  if (!res.ok) { toast(res.data.error || 'Nachricht konnte nicht gesendet werden', 'error'); return; }
  $('#msg-body').value = '';
  renderMsgPreview();
  toast(to ? `Nachricht an ${sons.find(s => String(s.id) === to).name} gesendet` : 'Nachricht an alle gesendet');
  await loadMessages();
});

// ---------- Investitionen ----------
async function loadInvestments() {
  const res = await api(`/api/admin/investments?sonId=${activeSonId}`);
  const list = res.data.investments || [];
  $('#inv-list').innerHTML = list.length ? list.map(inv => `<div class="list-row ${inv.status === 'active' ? '' : 'muted'}">
      <div style="min-width:0"><div class="t">${escapeHtml(inv.product_name)}</div>
      <div class="s">${eur(inv.principal)} angelegt · aktuell <b class="num">${eur(inv.balance)}</b> · ${inv.status === 'active' ? 'fällig ' + dateFmt(inv.maturity_date) : 'ausgezahlt'}</div></div>
      <span class="tag">${inv.status === 'active' ? 'aktiv' : 'ausgezahlt'}</span></div>`).join('')
    : '<div class="empty">Keine Investitionen für diese Person.</div>';
}

$('#inv-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { sonId: activeSonId, productId: Number($('#inv-product').value), amount: Number($('#inv-amount').value) };
  const res = await api('/api/admin/investments', { method: 'POST', body });
  if (!res.ok) { toast(res.data.error || 'Investition konnte nicht angelegt werden', 'error'); return; }
  $('#inv-amount').value = '';
  toast('Investition angelegt');
  await Promise.all([loadInvestments(), loadTransactions(), refreshSons()]);
});

// ---------- Produkte ----------
async function loadProducts() {
  const res = await api('/api/admin/products');
  products = res.data.products || [];
  $('#prod-list').innerHTML = products.length ? products.map(p => `<div class="list-row ${p.active ? '' : 'muted'}">
      <div style="min-width:0"><div class="t">${escapeHtml(p.name)}</div>
      <div class="s">${pct(p.apy)} · ${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'} · Zinsen ${FREQ_LABELS[p.interest_frequency]}${p.active ? '' : ' · inaktiv'}</div></div>
      <div class="row-actions">
        <button type="button" class="icon-sm edit" data-edit-prod="${p.id}" aria-label="Produkt bearbeiten">${svgIcon('edit')}</button>
        ${deleteBtn('data-del-prod', p.id, 'Produkt löschen')}
      </div></div>`).join('')
    : '<div class="empty">Noch keine Anlageprodukte.</div>';
  const active = products.filter(p => p.active);
  $('#inv-product').innerHTML = active.length
    ? active.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${pct(p.apy)}, ${p.lock_days === 0 ? 'flexibel' : p.lock_days + ' Tage'})</option>`).join('')
    : '<option value="">Kein Produkt verfügbar</option>';
}

function startProductEdit(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  $('#prod-name').value = p.name;
  $('#prod-lock').value = p.lock_days;
  $('#prod-apy').value = (p.apy * 100).toFixed(2);
  $('#prod-freq').value = p.interest_frequency;
  $('#prod-desc').value = p.description || '';
  $('#prod-title').textContent = `Produkt bearbeiten: ${p.name}`;
  $('#prod-submit').textContent = 'Produkt speichern';
  $('#prod-cancel').hidden = false;
  $('#prod-form').scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
}

function cancelProductEdit() {
  editingProductId = null;
  $('#prod-form').reset();
  $('#prod-title').textContent = 'Anlageprodukte (für alle)';
  $('#prod-submit').textContent = 'Produkt anlegen';
  $('#prod-cancel').hidden = true;
}
$('#prod-cancel').addEventListener('click', cancelProductEdit);

$('#prod-list').addEventListener('click', async e => {
  const edit = e.target.closest('[data-edit-prod]');
  if (edit) { startProductEdit(Number(edit.dataset.editProd)); return; }
  const del = e.target.closest('[data-del-prod]');
  if (!del || !confirmButton(del)) return;
  const res = await api(`/api/admin/products?id=${del.dataset.delProd}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data.error || 'Produkt konnte nicht gelöscht werden', 'error'); return; }
  if (editingProductId === Number(del.dataset.delProd)) cancelProductEdit();
  toast('Produkt gelöscht');
  await loadProducts();
});

$('#prod-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: $('#prod-name').value,
    lockDays: parseInt($('#prod-lock').value, 10),
    apy: Math.round(Number($('#prod-apy').value) * 100) / 10000,
    interestFrequency: $('#prod-freq').value,
    description: $('#prod-desc').value
  };
  const res = editingProductId
    ? await api('/api/admin/products', { method: 'PATCH', body: { ...body, id: editingProductId } })
    : await api('/api/admin/products', { method: 'POST', body });
  if (!res.ok) { toast(res.data.error || 'Produkt konnte nicht gespeichert werden', 'error'); return; }
  toast(editingProductId ? 'Produkt gespeichert' : 'Produkt angelegt');
  cancelProductEdit();
  await loadProducts();
});

start();
