/* salesman-bills.js — Admin view of all salesman delivery bills */
(function () {
  let offset = 0;
  let salesmen = [];

  async function init() {
    await App.init('salesman-bills');
    await loadSalesmen();
    loadBills(true);

    const btnRecord = document.getElementById('btnRecordBill');
    if (btnRecord) btnRecord.addEventListener('click', openRecordBillModal);

    document.getElementById('filterSalesman').addEventListener('change', () => loadBills(true));
    document.getElementById('filterStatus').addEventListener('change', () => loadBills(true));
    document.getElementById('filterDate').addEventListener('change', () => loadBills(true));
    document.getElementById('filterQ').addEventListener('input', debounce(() => loadBills(true), 400));
    document.getElementById('clearFilter').addEventListener('click', () => {
      document.getElementById('filterSalesman').value = '';
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterDate').value = '';
      document.getElementById('filterQ').value = '';
      loadBills(true);
    });
    document.getElementById('loadMoreBtn').addEventListener('click', () => loadBills(false));
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  async function loadSalesmen() {
    try {
      const { salesmen: list } = await App.api('/api/salesman/salesmen');
      salesmen = list || [];
      const sel = document.getElementById('filterSalesman');
      sel.innerHTML = '<option value="">All Salesmen</option>' +
        salesmen.map(s => `<option value="${s.id}">${App.esc(s.name)}</option>`).join('');
    } catch (_) {}
  }

  async function loadBills(reset = true) {
    if (reset) offset = 0;
    const params = new URLSearchParams({ offset });
    const smId   = document.getElementById('filterSalesman').value;
    const status = document.getElementById('filterStatus').value;
    const date   = document.getElementById('filterDate').value;
    const q      = document.getElementById('filterQ').value;
    if (smId)   params.set('salesman_id', smId);
    if (status) params.set('status', status);
    if (date)   params.set('date', date);
    if (q)      params.set('q', q);

    try {
      const { bills, hasMore } = await App.api('/api/salesman/bills?' + params);
      const tbody = document.getElementById('billsBody');
      if (reset) tbody.innerHTML = '';
      if (!bills.length && reset) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">No delivery bills found.</td></tr>';
      } else {
        const html = bills.map(b => {
          const hasBal = b.remaining_balance > 0;
          let statusBadge = '';
          if (b.status === 'paid') {
            statusBadge = '<span class="badge badge-ok">✓ Paid</span>';
          } else if (b.status === 'partial') {
            statusBadge = '<span class="badge badge-low">Partially Paid</span>';
          } else {
            statusBadge = '<span class="badge badge-out">Unpaid</span>';
          }

          return `
            <tr>
              <td><b>#${App.esc(String(b.bill_number))}</b></td>
              <td><b>${App.esc(b.salesman_name)}</b></td>
              <td class="nowrap">${App.dateTime(b.created_at)}</td>
              <td class="num">${b.total_quantity || b.item_count} units (${b.item_count} items)</td>
              <td class="num"><b>${App.money(b.grand_total)}</b></td>
              <td class="num" style="color:#15803d;font-weight:600">${App.money(b.paid_amount)}</td>
              <td class="num" style="font-weight:700;color:${hasBal ? '#dc2626' : '#15803d'}">${App.money(b.remaining_balance)}</td>
              <td>${statusBadge}</td>
              <td class="actions" style="display:flex;gap:.3rem">
                ${hasBal ? `<button class="btn btn-sm btn-primary" data-pay="${b.id}" style="background:#15803d;border-color:#15803d;font-weight:600">💰 Pay</button>` : ''}
                <button class="btn btn-sm btn-dark" data-view="${b.id}">View Bill</button>
                <button class="btn btn-sm btn-danger" data-del="${b.id}" title="Delete">🗑</button>
              </td>
            </tr>`;
        }).join('');

        tbody.insertAdjacentHTML('beforeend', html);
        tbody.querySelectorAll('[data-prices]').forEach(btn =>
          btn.addEventListener('click', () => {
            const b = bills.find(x => x.id === Number(btn.dataset.prices));
            if (b) openSetPricesModal(b);
          }));
        tbody.querySelectorAll('[data-pay]').forEach(btn =>
          btn.addEventListener('click', () => {
            const b = bills.find(x => x.id === Number(btn.dataset.pay));
            if (b) openPayBillModal(b);
          }));
        tbody.querySelectorAll('[data-view]').forEach(btn =>
          btn.addEventListener('click', () => viewBill(Number(btn.dataset.view))));
        tbody.querySelectorAll('[data-del]').forEach(btn =>
          btn.addEventListener('click', () => deleteBill(Number(btn.dataset.del), btn.closest('tr'))));
      }
      offset += bills.length;
      document.getElementById('loadMoreWrap').classList.toggle('hidden', !hasMore);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  async function openSetPricesModal(billSummary) {
    try {
      const { bill } = await App.api('/api/salesman/bills/' + billSummary.id);
      const items = (bill.items || []).map((it, idx) => ({
        ...it,
        key: 'it_' + idx,
        unit_price: Number(it.unit_price) || 0,
        quantity: Number(it.quantity) || 1,
      }));

      const d = App.dialog({
        title: `✏️ Set / Edit Purchase Prices · Bill #${bill.bill_number} (${App.esc(bill.salesman_name)})`,
        wide: true,
        body: `
          <div class="form-error hidden" id="priceErr"></div>
          <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid var(--line);margin-bottom:12px;font-size:.9rem">
            <b>Delivered By:</b> ${App.esc(bill.salesman_name)} &nbsp;·&nbsp; <b>Date:</b> ${App.dateTime(bill.created_at)}
          </div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:8px">
            <table class="table">
              <thead>
                <tr>
                  <th>Product Delivered</th>
                  <th class="num">Quantity Delivered</th>
                  <th style="width:150px">Unit Price (Rs)</th>
                  <th class="num" style="width:130px">Total Price</th>
                </tr>
              </thead>
              <tbody id="priceRows">
                ${items.map(it => `
                  <tr data-k="${it.key}">
                    <td><b>${App.esc(it.item_name)}</b></td>
                    <td class="num" style="font-weight:700">${it.quantity}</td>
                    <td>
                      <input type="number" min="0" step="any" class="price-input" data-k="${it.key}" value="${it.unit_price}" style="width:130px;font-weight:700">
                    </td>
                    <td class="num"><b data-lt="${it.key}">${App.money(it.unit_price * it.quantity)}</b></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin-top:10px;background:#f8fafc;border-radius:8px;border:1px solid var(--line)">
            <span style="font-weight:700">Total Bill Amount:</span>
            <span style="font-size:1.35rem;font-weight:800;color:#15803d" id="modalBillTotal">Rs 0</span>
          </div>
          <div class="field" style="margin-top:10px">
            <label>Notes (optional)</label>
            <input id="editNotesInput" value="${App.esc(bill.notes || '')}" placeholder="Optional delivery notes…">
          </div>
        `,
        foot: `
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-save-prices style="font-weight:700">Save Prices &amp; Total</button>
        `,
      });

      const updateTotal = () => {
        const total = items.reduce((s, it) => s + (it.unit_price * it.quantity), 0);
        d.querySelector('#modalBillTotal').textContent = App.money(total);
      };
      updateTotal();

      d.querySelectorAll('.price-input').forEach(inp => {
        inp.addEventListener('input', () => {
          const it = items.find(x => x.key === inp.dataset.k);
          if (it) {
            it.unit_price = Math.max(0, Number(inp.value) || 0);
            d.querySelector(`[data-lt="${it.key}"]`).textContent = App.money(it.unit_price * it.quantity);
            updateTotal();
          }
        });
      });

      d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
      d.querySelector('[data-save-prices]').addEventListener('click', async () => {
        const err = d.querySelector('#priceErr');
        err.classList.add('hidden');
        await App.busy(d.querySelector('[data-save-prices]'), async () => {
          try {
            await App.api('/api/salesman/bills/' + bill.id, {
              method: 'PUT',
              body: {
                notes: d.querySelector('#editNotesInput').value.trim() || null,
                items: items.map(it => ({
                  product_id: it.product_id,
                  item_name: it.item_name,
                  quantity: it.quantity,
                  unit_price: it.unit_price,
                })),
              },
            });
            d.close();
            App.toast('Bill prices saved successfully!', 'success');
            loadBills(true);
          } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
          }
        });
      });
    } catch (err) { App.toast(err.message, 'error'); }
  }

  function openPayBillModal(bill) {
    const today = new Date().toISOString().slice(0, 10);
    const d = App.dialog({
      title: `💰 Record Payment · Bill #${bill.bill_number} (${App.esc(bill.salesman_name)})`,
      body: `
        <div class="form-error hidden" id="payBillErr"></div>
        <div style="background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="muted">Salesman:</span>
            <b>${App.esc(bill.salesman_name)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="muted">Total Bill:</span>
            <b>${App.money(bill.grand_total)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#15803d">
            <span>Already Paid:</span>
            <b>${App.money(bill.paid_amount)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;color:#dc2626;font-size:1.1rem;font-weight:700">
            <span>Outstanding Balance:</span>
            <span>${App.money(bill.remaining_balance)}</span>
          </div>
        </div>

        <div class="field">
          <label style="font-weight:700">Payment Method</label>
          <div style="display:flex;gap:8px;margin-top:4px">
            <label class="pay-option active-cash" id="lblCashOpt" style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer">
              <input type="radio" name="payType" value="cash" checked> 💵 Cash Payment
            </label>
            <label class="pay-option" id="lblBankOpt" style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer">
              <input type="radio" name="payType" value="bank"> 🏦 Bank Transfer
            </label>
          </div>
        </div>

        <div class="row">
          <div class="field" style="flex:1">
            <label>Amount to Pay (Rs)</label>
            <input type="number" id="payAmountInput" min="0.01" max="${bill.remaining_balance}" step="any" value="${bill.remaining_balance}" required>
          </div>
          <div class="field" style="flex:1">
            <label>Date</label>
            <input type="date" id="payDateInput" value="${today}" required>
          </div>
        </div>

        <!-- Cash fields -->
        <div id="cashFieldsWrap">
          <div class="field">
            <label>Received / Handled By</label>
            <input id="payRecvInput" value="${App.esc(App.user.name)}" required placeholder="e.g. Admin, Cashier">
          </div>
        </div>

        <!-- Bank fields -->
        <div id="bankFieldsWrap" class="hidden">
          <div class="row">
            <div class="field" style="flex:1">
              <label>Transfer ID / TXN ID <span style="color:red">*</span></label>
              <input id="payTxnInput" placeholder="Unique transaction ID">
            </div>
            <div class="field" style="flex:1">
              <label>Bank Name (optional)</label>
              <input id="payBankInput" placeholder="e.g. HBL, Meezan Bank">
            </div>
          </div>
          <div class="field">
            <label>Transaction Proof Note (optional)</label>
            <input id="payProofInput" placeholder="e.g. Transfer receipt #1234">
          </div>
        </div>

        <div class="field">
          <label>Notes (optional)</label>
          <input id="payNotesInput" placeholder="Optional notes…">
        </div>
      `,
      foot: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-confirm-pay style="font-weight:700">Record Payment</button>
      `,
    });

    const errBox = d.querySelector('#payBillErr');
    const radCash = d.querySelector('input[name="payType"][value="cash"]');
    const radBank = d.querySelector('input[name="payType"][value="bank"]');
    const lblCash = d.querySelector('#lblCashOpt');
    const lblBank = d.querySelector('#lblBankOpt');
    const cashWrap = d.querySelector('#cashFieldsWrap');
    const bankWrap = d.querySelector('#bankFieldsWrap');

    const setPayType = (isCash) => {
      radCash.checked = isCash;
      radBank.checked = !isCash;
      lblCash.classList.toggle('active-cash', isCash);
      lblBank.classList.toggle('active-account', !isCash);
      cashWrap.classList.toggle('hidden', !isCash);
      bankWrap.classList.toggle('hidden', isCash);
    };

    radCash.addEventListener('change', () => setPayType(true));
    radBank.addEventListener('change', () => setPayType(false));
    lblCash.addEventListener('click', () => setPayType(true));
    lblBank.addEventListener('click', () => setPayType(false));

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-confirm-pay]').addEventListener('click', async () => {
      errBox.classList.add('hidden');
      const amt = Number(d.querySelector('#payAmountInput').value);
      const date = d.querySelector('#payDateInput').value;
      const notes = d.querySelector('#payNotesInput').value.trim() || null;
      if (!amt || amt <= 0) {
        errBox.textContent = 'Please enter a valid amount.';
        errBox.classList.remove('hidden');
        return;
      }
      if (amt > bill.remaining_balance) {
        errBox.textContent = `Amount cannot exceed remaining balance (${App.money(bill.remaining_balance)}).`;
        errBox.classList.remove('hidden');
        return;
      }

      const isCash = radCash.checked;
      await App.busy(d.querySelector('[data-confirm-pay]'), async () => {
        try {
          if (isCash) {
            const recv = d.querySelector('#payRecvInput').value.trim() || 'Admin';
            await App.api('/api/salesman/payments/cash', {
              method: 'POST',
              body: { salesman_id: bill.salesman_id, bill_id: bill.id, amount: amt, payment_date: date, received_by: recv, notes },
            });
          } else {
            const txn = d.querySelector('#payTxnInput').value.trim();
            const bankAcc = d.querySelector('#payBankInput').value.trim() || null;
            const proof = d.querySelector('#payProofInput').value.trim() || null;
            if (!txn) throw new Error('Transfer ID / Transaction ID is required.');
            await App.api('/api/salesman/payments/bank', {
              method: 'POST',
              body: { salesman_id: bill.salesman_id, bill_id: bill.id, amount: amt, transfer_date: date, transfer_id: txn, bank_account: bankAcc, proof_note: proof, notes },
            });
          }
          d.close();
          App.toast('Payment recorded successfully against bill #' + bill.bill_number, 'success');
          loadBills(true);
        } catch (e) {
          errBox.textContent = e.message;
          errBox.classList.remove('hidden');
        }
      });
    });
  }

  async function viewBill(id) {
    try {
      const { bill } = await App.api('/api/salesman/bills/' + id);
      const rows = (bill.items || []).map((it, i) => `
        <tr>
          <td>${i+1}. <b>${App.esc(it.item_name)}</b></td>
          <td class="num">${App.money(it.unit_price)}</td>
          <td class="num">${it.quantity}</td>
          <td class="num"><b>${App.money(it.line_total)}</b></td>
        </tr>`).join('');

      const cashPayments = (bill.payments && bill.payments.cash) || [];
      const bankPayments = (bill.payments && bill.payments.bank) || [];
      const allPayments = [
        ...cashPayments.map(p => ({ date: p.payment_date, type: 'Cash', desc: 'Received by ' + p.received_by, amount: p.amount })),
        ...bankPayments.map(p => ({ date: p.transfer_date, type: 'Bank', desc: (p.bank_account || 'Bank') + ' (TXN: ' + p.transfer_id + ')', amount: p.amount })),
      ].sort((a,b) => new Date(b.date) - new Date(a.date));

      const paymentsHtml = allPayments.length
        ? `<div style="margin-top:1rem;border-top:1px dashed var(--line);padding-top:.75rem">
            <h4 style="margin:0 0 .5rem;font-size:.9rem">Payments Recorded Against This Bill</h4>
            <table class="table" style="font-size:.85rem">
              <thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th></tr></thead>
              <tbody>
                ${allPayments.map(p => `<tr><td>${App.esc(p.date)}</td><td><span class="badge ${p.type==='Cash'?'badge-ok':''}">${p.type}</span></td><td>${App.esc(p.desc)}</td><td class="num"><b>${App.money(p.amount)}</b></td></tr>`).join('')}
              </tbody>
            </table>
          </div>`
        : '';

      const d = App.dialog({
        title: `Salesman Delivery Bill #${bill.bill_number} — ${App.esc(bill.salesman_name)}`,
        wide: true,
        body: `
          <div class="bill-paper">
            <div class="bill-head">
              <div class="bill-header-row">
                <img src="/logo.jpg" alt="MJ AUTOS" class="bill-logo">
                <div class="bill-header-info">
                  <p class="shop">MJ AUTOS</p>
                  <div class="sub">Purchases &amp; Supplier Delivery Bill</div>
                </div>
              </div>
            </div>
            <div class="bill-meta">
              <div>Bill No: <b>#${bill.bill_number}</b></div>
              <div class="r">${App.dateTime(bill.created_at)}</div>
              <div>Salesman: <b>${App.esc(bill.salesman_name)}</b></div>
              <div class="r">Total Qty Delivered: <b>${bill.total_quantity} units</b></div>
            </div>
            <table class="bill-table">
              <thead><tr><th>Product Name</th><th class="n">Unit Price</th><th class="n">Qty Delivered</th><th class="n">Total Price</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="bill-totals">
              <div class="line grand-line"><span>GRAND TOTAL BILL</span><span>${App.money(bill.grand_total)}</span></div>
              <div class="line" style="font-weight:600;color:#15803d"><span>Amount Paid by MJ Autos</span><span>${App.money(bill.paid_amount)}</span></div>
              <div class="line" style="font-weight:700;font-size:1.05em;border-top:1px dashed #000;margin-top:4px;padding-top:4px;color:${bill.remaining_balance > 0 ? '#b91c1c' : '#15803d'}">
                <span>Remaining Outstanding Balance</span>
                <span>${bill.remaining_balance > 0 ? '⚠️ ' + App.money(bill.remaining_balance) : '✓ ALL PAID (مکمل ادا شدہ)'}</span>
              </div>
            </div>
            ${bill.notes ? `<div style="margin-top:.5rem;padding:.5rem;background:#f8fafc;border-radius:6px;font-size:.85rem"><b>Notes:</b> ${App.esc(bill.notes)}</div>` : ''}
            ${paymentsHtml}
          </div>`,
        foot: `
          ${bill.remaining_balance > 0 ? `<button class="btn btn-primary" data-pay-from-view style="background:#15803d;border-color:#15803d;margin-right:auto">💰 Pay Bill</button>` : ''}
          <button class="btn btn-dark" data-print>🖨️ Print</button>
          <button class="btn" data-close>Close</button>`,
      });

      const payBtn = d.querySelector('[data-pay-from-view]');
      if (payBtn) {
        payBtn.addEventListener('click', () => {
          d.close();
          openPayBillModal(bill);
        });
      }

      d.querySelector('[data-print]').addEventListener('click', () => {
        let area = document.getElementById('printArea');
        if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
        area.innerHTML = d.querySelector('.bill-paper').outerHTML;
        let s = document.getElementById('pageSizeStyle');
        if (!s) { s = document.createElement('style'); s.id = 'pageSizeStyle'; document.head.appendChild(s); }
        s.textContent = '@page { size: 80mm auto; margin: 4mm 4mm; }';
        window.print();
      });
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
    } catch (err) { App.toast(err.message, 'error'); }
  }

  let catalogProducts = [];

  async function openRecordBillModal() {
    if (!catalogProducts.length) {
      try {
        const { products } = await App.api('/api/products');
        catalogProducts = products || [];
      } catch (_) { catalogProducts = []; }
    }

    let cart = [];
    const smOptions = salesmen.map(s => `<option value="${s.id}">${App.esc(s.name)}</option>`).join('');

    const d = App.dialog({
      title: '📦 Record Bill Received from Salesman (بل درج کریں)',
      wide: true,
      body: `
        <div class="form-error hidden" id="recBillErr" style="margin-bottom:.75rem"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
          <div>
            <label class="label" style="font-weight:700">Salesman (سیلز مین) *</label>
            <select id="billSmId" class="input">
              ${smOptions ? smOptions : '<option value="">No salesman accounts found</option>'}
            </select>
          </div>
          <div>
            <label class="label">Delivery Date &amp; Time</label>
            <input class="input" value="${new Date().toLocaleString()}" disabled>
          </div>
        </div>

        <div style="background:#f8fafc;padding:.75rem;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:.75rem">
          <div style="font-weight:700;margin-bottom:.5rem;font-size:.9rem">Add Products Delivered:</div>
          <div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
            <div style="flex:2;min-width:180px">
              <label class="label">Product from Catalog</label>
              <select id="billProdSelect" class="input">
                <option value="">-- Choose from Catalog --</option>
                ${catalogProducts.map(p => `<option value="${p.id}" data-name="${App.esc(p.name)}">${App.esc(p.name)}${p.part_number ? ' (' + App.esc(p.part_number) + ')' : ''}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1;min-width:120px">
              <label class="label">Or Custom Name</label>
              <input type="text" id="billCustomName" placeholder="e.g. Brake Pads" class="input">
            </div>
            <div style="width:90px">
              <label class="label">Quantity</label>
              <input type="number" id="billProdQty" class="input" min="1" value="1">
            </div>
            <div style="width:110px">
              <label class="label">Unit Price (Rs)</label>
              <input type="number" id="billProdPrice" class="input" min="0" step="any" placeholder="0">
            </div>
            <button class="btn btn-primary" id="btnAddCartItem" type="button" style="height:38px">+ Add</button>
          </div>
        </div>

        <div class="table-wrap" style="max-height:240px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px">
          <table class="table">
            <thead>
              <tr>
                <th>Product</th>
                <th class="num" style="width:90px">Quantity</th>
                <th class="num" style="width:110px">Unit Price</th>
                <th class="num" style="width:110px">Total Price</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="billCartTbody">
              <tr><td colspan="5" class="empty">No products added yet.</td></tr>
            </tbody>
          </table>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.75rem;padding:.5rem .75rem;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
          <div><b>Total Units:</b> <span id="billTotalUnits" style="font-weight:700">0 units</span></div>
          <div><b>Grand Total Amount:</b> <span id="billGrandTotal" style="font-size:1.2rem;font-weight:800;color:#15803d">Rs 0</span></div>
        </div>

        <div style="margin-top:.75rem">
          <label class="label">Delivery Notes / Remarks (optional)</label>
          <input type="text" id="billNotesInput" class="input" placeholder="e.g. Batch #10, warranty items, partial delivery…">
        </div>
      `,
      foot: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="btnSaveBill" style="background:#15803d;border-color:#15803d;font-weight:700">Submit Delivery Bill (بل محفوظ کریں)</button>
      `,
    });

    const errBox = d.querySelector('#recBillErr');
    const prodSelect = d.querySelector('#billProdSelect');
    const customInput = d.querySelector('#billCustomName');
    const qtyInput = d.querySelector('#billProdQty');
    const priceInput = d.querySelector('#billProdPrice');
    const cartTbody = d.querySelector('#billCartTbody');
    const totalUnitsEl = d.querySelector('#billTotalUnits');
    const grandTotalEl = d.querySelector('#billGrandTotal');

    function updateCartView() {
      if (!cart.length) {
        cartTbody.innerHTML = '<tr><td colspan="5" class="empty">No products added yet.</td></tr>';
        totalUnitsEl.textContent = '0 units';
        grandTotalEl.textContent = 'Rs 0';
        return;
      }
      cartTbody.innerHTML = cart.map((it, idx) => `
        <tr>
          <td><b>${App.esc(it.item_name)}</b></td>
          <td class="num">${it.quantity}</td>
          <td class="num">${App.money(it.unit_price)}</td>
          <td class="num"><b>${App.money(it.line_total)}</b></td>
          <td class="actions">
            <button class="btn btn-sm btn-dark" data-del-cart="${idx}" title="Remove" style="padding:2px 7px">✕</button>
          </td>
        </tr>
      `).join('');

      cartTbody.querySelectorAll('[data-del-cart]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.delCart);
          cart.splice(idx, 1);
          updateCartView();
        });
      });

      const totalUnits = cart.reduce((s, it) => s + it.quantity, 0);
      const grandTotal = cart.reduce((s, it) => s + it.line_total, 0);
      totalUnitsEl.textContent = totalUnits + ' units';
      grandTotalEl.textContent = App.money(grandTotal);
    }

    d.querySelector('#btnAddCartItem').addEventListener('click', () => {
      errBox.classList.add('hidden');
      const prodId = prodSelect.value ? Number(prodSelect.value) : null;
      const opt = prodSelect.options[prodSelect.selectedIndex];
      const prodName = (prodId && opt) ? opt.dataset.name : customInput.value.trim();
      const qty = parseInt(qtyInput.value) || 0;
      const unitPrice = parseFloat(priceInput.value) || 0;

      if (!prodName) {
        errBox.textContent = 'Please choose a product from the list or enter a custom name.';
        errBox.classList.remove('hidden');
        return;
      }
      if (qty <= 0) {
        errBox.textContent = 'Quantity must be at least 1.';
        errBox.classList.remove('hidden');
        qtyInput.focus();
        return;
      }

      const lineTotal = Math.round(qty * unitPrice * 100) / 100;
      cart.push({
        product_id: prodId,
        item_name: prodName,
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
      });

      prodSelect.value = '';
      customInput.value = '';
      qtyInput.value = 1;
      priceInput.value = '';
      updateCartView();
    });

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());

    const saveBtn = d.querySelector('#btnSaveBill');
    saveBtn.addEventListener('click', async () => {
      errBox.classList.add('hidden');
      const smId = d.querySelector('#billSmId').value;
      if (!smId) {
        errBox.textContent = 'Please select a salesman.';
        errBox.classList.remove('hidden');
        return;
      }
      if (!cart.length) {
        errBox.textContent = 'Please add at least one product to this delivery bill.';
        errBox.classList.remove('hidden');
        return;
      }

      const notes = d.querySelector('#billNotesInput').value.trim() || null;
      const items = cart.map(it => ({
        product_id: it.product_id,
        item_name: it.item_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
      }));

      await App.busy(saveBtn, async () => {
        try {
          await App.api('/api/salesman/bills', {
            method: 'POST',
            body: {
              salesman_id: Number(smId),
              items,
              notes,
            },
          });
          d.close();
          App.toast('Delivery bill recorded successfully! / بل کامیابی سے درج ہو گیا', 'success');
          loadBills(true);
        } catch (err) {
          errBox.textContent = err.message || 'Failed to record delivery bill';
          errBox.classList.remove('hidden');
        }
      });
    });
  }

  async function deleteBill(id, row) {
    const ok = await App.confirm('Delete this delivery bill permanently? This cannot be undone.', { okText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await App.api('/api/salesman/bills/' + id, { method: 'DELETE' });
      row.remove();
      App.toast('Bill deleted', 'success');
    } catch (err) { App.toast(err.message, 'error'); }
  }

  init().catch(err => App.toast(err.message, 'error'));
})();
