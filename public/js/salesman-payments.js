/* salesman-payments.js — Admin manages payments made to salesmen */
(function () {
  let salesmen = [];
  let activeTab = 'cash';

  async function init() {
    await App.init('salesman-payments');
    await loadSalesmen();
    loadAdminDashboard();
    loadCashPayments();
    loadBankPayments();

    document.getElementById('addCashBtn').addEventListener('click', () => openCashForm());
    document.getElementById('addBankBtn').addEventListener('click', () => openBankForm());
    document.getElementById('filterSalesman').addEventListener('change', () => { loadCashPayments(); loadBankPayments(); });

    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      document.getElementById('tabCash').classList.toggle('hidden', activeTab !== 'cash');
      document.getElementById('tabBank').classList.toggle('hidden', activeTab !== 'bank');
    }));
  }

  async function loadSalesmen() {
    try {
      const { salesmen: list } = await App.api('/api/salesman/salesmen');
      salesmen = list || [];
      const opts = '<option value="">All Salesmen</option>' + salesmen.map(s => `<option value="${s.id}">${App.esc(s.name)}</option>`).join('');
      document.getElementById('filterSalesman').innerHTML = opts;
    } catch (_) {}
  }

  async function loadAdminDashboard() {
    try {
      const { totals, salesmen: list } = await App.api('/api/salesman/admin-dashboard');
      if (document.getElementById('gTotalBillsCount'))  document.getElementById('gTotalBillsCount').textContent  = totals.total_bills || 0;
      if (document.getElementById('gTotalBillsAmount')) document.getElementById('gTotalBillsAmount').textContent = App.money(totals.total_bill_amount || 0);
      if (document.getElementById('gTotalCash'))        document.getElementById('gTotalCash').textContent        = App.money(totals.total_cash || 0);
      if (document.getElementById('gTotalBank'))        document.getElementById('gTotalBank').textContent        = App.money(totals.total_bank || 0);
      if (document.getElementById('gTotalPaid'))        document.getElementById('gTotalPaid').textContent        = App.money(totals.total_paid || 0);
      if (document.getElementById('gPending'))          document.getElementById('gPending').textContent          = App.money(totals.total_pending || 0);

      const tbody = document.getElementById('summaryBody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">No salesman accounts created yet. <a href="/users">Add a salesman</a> to get started.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(s => `
        <tr>
          <td><b>${App.esc(s.name)}</b></td>
          <td class="num">${s.bill_count || 0}</td>
          <td class="num">${App.money(s.total_bills || 0)}</td>
          <td class="num">${App.money(s.total_cash || 0)}</td>
          <td class="num">${App.money(s.total_bank || 0)}</td>
          <td class="num"><b>${App.money(s.total_paid || 0)}</b></td>
          <td class="num" style="color:${(s.pending || 0) > 0 ? '#b91c1c' : '#15803d'};font-weight:700">${App.money(s.pending || 0)}</td>
          <td class="actions" style="display:flex;gap:.3rem">
            <button class="btn btn-sm btn-primary" data-quick-pay="${s.id}" style="background:#15803d;border-color:#15803d;font-weight:600">💰 Pay</button>
            <a href="/salesman-ledger?id=${s.id}" class="btn btn-sm btn-dark">Ledger →</a>
          </td>
        </tr>`).join('');

      tbody.querySelectorAll('[data-quick-pay]').forEach(btn =>
        btn.addEventListener('click', () => openCashForm(Number(btn.dataset.quickPay))));
    } catch (err) { App.toast(err.message, 'error'); }
  }

  async function loadCashPayments() {
    const smId = document.getElementById('filterSalesman').value;
    const params = smId ? '?salesman_id=' + smId : '';
    try {
      const { payments } = await App.api('/api/salesman/payments/cash' + params);
      const tbody = document.getElementById('cashBody');
      tbody.innerHTML = payments.length
        ? payments.map(p => `
            <tr>
              <td class="nowrap">${App.esc(p.payment_date)}</td>
              <td><b>${App.esc(p.salesman_name)}</b></td>
              <td>${p.bill_number ? `<a href="/salesman-bills?q=${p.bill_number}">#${p.bill_number}</a>` : '<span class="muted small">General Account</span>'}</td>
              <td>${App.esc(p.received_by)}</td>
              <td class="num"><b>${App.money(p.amount)}</b></td>
              <td class="small muted">${App.esc(p.notes || '—')}</td>
              <td><button class="btn btn-sm btn-danger" data-del-cash="${p.id}" title="Delete Payment Record">🗑</button></td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="empty">No cash payments recorded.</td></tr>';
      tbody.querySelectorAll('[data-del-cash]').forEach(btn =>
        btn.addEventListener('click', () => deletePayment('cash', Number(btn.dataset.delCash), btn.closest('tr'))));
    } catch (err) { App.toast(err.message, 'error'); }
  }

  async function loadBankPayments() {
    const smId = document.getElementById('filterSalesman').value;
    const params = smId ? '?salesman_id=' + smId : '';
    try {
      const { payments } = await App.api('/api/salesman/payments/bank' + params);
      const tbody = document.getElementById('bankBody');
      tbody.innerHTML = payments.length
        ? payments.map(p => `
            <tr>
              <td class="nowrap">${App.esc(p.transfer_date)}</td>
              <td><b>${App.esc(p.salesman_name)}</b></td>
              <td>${p.bill_number ? `<a href="/salesman-bills?q=${p.bill_number}">#${p.bill_number}</a>` : '<span class="muted small">General Account</span>'}</td>
              <td>${App.esc(p.bank_account || '—')}</td>
              <td style="font-family:monospace;font-weight:600">${App.esc(p.transfer_id)}</td>
              <td class="num"><b>${App.money(p.amount)}</b></td>
              <td class="small muted">${App.esc(p.proof_note || p.notes || '—')}</td>
              <td><button class="btn btn-sm btn-danger" data-del-bank="${p.id}" title="Delete Payment Record">🗑</button></td>
            </tr>`).join('')
        : '<tr><td colspan="8" class="empty">No bank transfers recorded.</td></tr>';
      tbody.querySelectorAll('[data-del-bank]').forEach(btn =>
        btn.addEventListener('click', () => deletePayment('bank', Number(btn.dataset.delBank), btn.closest('tr'))));
    } catch (err) { App.toast(err.message, 'error'); }
  }

  async function deletePayment(type, id, row) {
    const ok = await App.confirm('Delete this payment record? This cannot be undone.', { okText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await App.api(`/api/salesman/payments/${type}/${id}`, { method: 'DELETE' });
      row.remove();
      App.toast('Payment record deleted', 'success');
      loadAdminDashboard();
    } catch (err) { App.toast(err.message, 'error'); }
  }

  function salesmanOpts(selected = '') {
    return salesmen.map(s => `<option value="${s.id}" ${String(s.id) === String(selected) ? 'selected' : ''}>${App.esc(s.name)}</option>`).join('');
  }

  async function loadSalesmanBillsForSelect(salesmanId, selectEl) {
    if (!salesmanId) {
      selectEl.innerHTML = '<option value="">-- General Account Payment (No specific bill) --</option>';
      return;
    }
    try {
      const { bills } = await App.api(`/api/salesman/bills?salesman_id=${salesmanId}&status=pending`);
      let html = '<option value="">-- General Account Payment (No specific bill) --</option>';
      bills.forEach(b => {
        html += `<option value="${b.id}">Bill #${b.bill_number} (Outstanding: ${App.money(b.remaining_balance)})</option>`;
      });
      selectEl.innerHTML = html;
    } catch (_) {
      selectEl.innerHTML = '<option value="">-- General Account Payment (No specific bill) --</option>';
    }
  }

  function openCashForm(preselectedSalesmanId = null) {
    if (!salesmen.length) { App.toast('No salesman accounts found. Create a salesman user first.', 'info'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const d = App.dialog({
      title: '💵 Record Cash Payment to Salesman',
      body: `
        <div class="form-error hidden" id="cashErr"></div>
        <div class="field"><label>Salesman</label>
          <select id="cashSm"><option value="">-- Select salesman --</option>${salesmanOpts(preselectedSalesmanId)}</select>
        </div>
        <div class="field"><label>Against Bill (optional)</label>
          <select id="cashBillSelect"><option value="">-- General Account Payment (No specific bill) --</option></select>
        </div>
        <div class="row">
          <div class="field"><label>Amount (Rs)</label><input id="cashAmt" type="number" min="0.01" step="any" required placeholder="0.00"></div>
          <div class="field"><label>Payment Date</label><input id="cashDate" type="date" value="${today}" required></div>
        </div>
        <div class="field"><label>Handled / Paid By</label><input id="cashRecv" maxlength="100" required value="${App.esc(App.user.name)}" placeholder="Admin / Cashier name"></div>
        <div class="field"><label>Notes (optional)</label><textarea id="cashNotes" rows="2" maxlength="500" placeholder="e.g. Paid in cash at shop"></textarea></div>`,
      foot: `<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Record Payment</button>`,
    });

    const smSelect = d.querySelector('#cashSm');
    const billSelect = d.querySelector('#cashBillSelect');
    if (preselectedSalesmanId) {
      loadSalesmanBillsForSelect(preselectedSalesmanId, billSelect);
    }
    smSelect.addEventListener('change', () => loadSalesmanBillsForSelect(smSelect.value, billSelect));

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-save]').addEventListener('click', async () => {
      const err = d.querySelector('#cashErr');
      err.classList.add('hidden');
      const smId = smSelect.value;
      const billId = billSelect.value || null;
      const amt  = d.querySelector('#cashAmt').value;
      const date = d.querySelector('#cashDate').value;
      const recv = d.querySelector('#cashRecv').value.trim();
      const notes = d.querySelector('#cashNotes').value.trim();
      if (!smId || !amt || !date || !recv) { err.textContent = 'Salesman, amount, date and handled-by fields are required.'; err.classList.remove('hidden'); return; }
      await App.busy(d.querySelector('[data-save]'), async () => {
        try {
          await App.api('/api/salesman/payments/cash', {
            method: 'POST',
            body: { salesman_id: smId, bill_id: billId, amount: amt, payment_date: date, received_by: recv, notes: notes || null }
          });
          d.close();
          App.toast('Cash payment recorded successfully!', 'success');
          loadCashPayments();
          loadAdminDashboard();
        } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      });
    });
    d.querySelector('#cashSm').focus();
  }

  function openBankForm(preselectedSalesmanId = null) {
    if (!salesmen.length) { App.toast('No salesman accounts found. Create a salesman user first.', 'info'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const d = App.dialog({
      title: '🏦 Record Bank Transfer to Salesman',
      body: `
        <div class="form-error hidden" id="bankErr"></div>
        <div class="field"><label>Salesman</label>
          <select id="bankSm"><option value="">-- Select salesman --</option>${salesmanOpts(preselectedSalesmanId)}</select>
        </div>
        <div class="field"><label>Against Bill (optional)</label>
          <select id="bankBillSelect"><option value="">-- General Account Payment (No specific bill) --</option></select>
        </div>
        <div class="row">
          <div class="field"><label>Amount (Rs)</label><input id="bankAmt" type="number" min="0.01" step="any" required placeholder="0.00"></div>
          <div class="field"><label>Transfer Date</label><input id="bankDate" type="date" value="${today}" required></div>
        </div>
        <div class="row">
          <div class="field"><label>Salesman Bank Name / Account (optional)</label><input id="bankAcc" maxlength="100" placeholder="e.g. HBL, Meezan Bank"></div>
          <div class="field"><label>Transfer ID / TXN ID <span style="color:red">*</span></label><input id="bankTxn" maxlength="100" required placeholder="Unique transaction ID"></div>
        </div>
        <div class="field"><label>Transaction Proof / Note (optional)</label><textarea id="bankProof" rows="2" maxlength="500" placeholder="Screenshot note or bank reference details…"></textarea></div>
        <div class="field"><label>Notes (optional)</label><textarea id="bankNotes" rows="2" maxlength="500"></textarea></div>`,
      foot: `<button class="btn" data-cancel>Cancel</button><button class="btn btn-dark btn-primary" data-save>Record Transfer</button>`,
    });

    const smSelect = d.querySelector('#bankSm');
    const billSelect = d.querySelector('#bankBillSelect');
    if (preselectedSalesmanId) {
      loadSalesmanBillsForSelect(preselectedSalesmanId, billSelect);
    }
    smSelect.addEventListener('change', () => loadSalesmanBillsForSelect(smSelect.value, billSelect));

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-save]').addEventListener('click', async () => {
      const err = d.querySelector('#bankErr');
      err.classList.add('hidden');
      const smId  = smSelect.value;
      const billId = billSelect.value || null;
      const amt   = d.querySelector('#bankAmt').value;
      const date  = d.querySelector('#bankDate').value;
      const acc   = d.querySelector('#bankAcc').value.trim();
      const txn   = d.querySelector('#bankTxn').value.trim();
      const proof = d.querySelector('#bankProof').value.trim();
      const notes = d.querySelector('#bankNotes').value.trim();
      if (!smId || !amt || !date || !txn) { err.textContent = 'Salesman, amount, date and Transfer ID are required.'; err.classList.remove('hidden'); return; }
      await App.busy(d.querySelector('[data-save]'), async () => {
        try {
          await App.api('/api/salesman/payments/bank', {
            method: 'POST',
            body: { salesman_id: smId, bill_id: billId, amount: amt, bank_account: acc || null, transfer_date: date, transfer_id: txn, proof_note: proof || null, notes: notes || null }
          });
          d.close();
          App.toast('Bank transfer recorded successfully!', 'success');
          loadBankPayments();
          loadAdminDashboard();
        } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      });
    });
    d.querySelector('#bankSm').focus();
  }

  init().catch(err => App.toast(err.message, 'error'));
})();
