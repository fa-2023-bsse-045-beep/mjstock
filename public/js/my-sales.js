/* my-sales.js — Salesman product delivery entry & history (Salesman enters Product Name, Quantity, and Unit Price) */
(function () {
  let cartItems = [];
  let offset = 0;
  let hasMore = false;

  async function init() {
    await App.init('my-sales');
    loadSummary();
    loadBills(true);

    document.getElementById('newBillBtn').addEventListener('click', openBillForm);
    const recBtn = document.getElementById('recordPaymentBtn');
    if (recBtn) recBtn.addEventListener('click', () => openRecordPaymentModal());

    document.getElementById('filterDate').addEventListener('change', () => loadBills(true));
    document.getElementById('filterQ').addEventListener('input', debounce(() => loadBills(true), 400));
    document.getElementById('clearFilter').addEventListener('click', () => {
      document.getElementById('filterDate').value = '';
      document.getElementById('filterQ').value = '';
      loadBills(true);
    });
    document.getElementById('loadMoreBtn').addEventListener('click', () => loadBills(false));
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  async function loadSummary() {
    try {
      const { summary } = await App.api('/api/salesman/summary/' + App.user.id);
      if (document.getElementById('statTotalDue'))   document.getElementById('statTotalDue').textContent   = 'PKR ' + App.money(summary.pending || 0);
      if (document.getElementById('statTotalPaid'))  document.getElementById('statTotalPaid').textContent  = 'PKR ' + App.money(summary.total_paid || 0);
      if (document.getElementById('statBillCount'))  document.getElementById('statBillCount').textContent  = summary.bill_count || 0;
      if (document.getElementById('statTotalUnits')) document.getElementById('statTotalUnits').textContent = (summary.total_products_delivered || 0) + ' units';
    } catch (_) {}
  }

  async function loadBills(reset = true) {
    if (reset) { offset = 0; }
    const date = document.getElementById('filterDate').value;
    const q    = document.getElementById('filterQ').value;
    const params = new URLSearchParams({ offset });
    if (date) params.set('date', date);
    if (q)    params.set('q', q);

    try {
      const { bills, hasMore: more } = await App.api('/api/salesman/bills?' + params.toString());
      hasMore = more;
      const tbody = document.getElementById('billsBody');
      if (reset) tbody.innerHTML = '';
      if (!bills.length && reset) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">No delivery bills submitted yet. Click <b>+ Create Delivery Bill</b> above to record delivered products.</td></tr>';
      } else {
        const html = bills.map(renderBillRow).join('');
        tbody.insertAdjacentHTML('beforeend', html);
        tbody.querySelectorAll('[data-view-bill]').forEach(btn =>
          btn.addEventListener('click', () => viewBill(Number(btn.dataset.viewBill)))
        );
        tbody.querySelectorAll('[data-edit-bill]').forEach(btn =>
          btn.addEventListener('click', () => openEditBill(Number(btn.dataset.editBill)))
        );
      }
      offset += bills.length;
      document.getElementById('loadMoreWrap').classList.toggle('hidden', !hasMore);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function renderBillRow(b) {
    const totalUnits = b.total_quantity || b.item_count || 0;
    const isUnpaid = (b.paid_amount || 0) === 0;
    const hasBal = (b.remaining_balance || 0) > 0;
    let statusBadge = '';
    if (b.status === 'paid') {
      statusBadge = '<span class="badge badge-ok">✓ Paid</span>';
    } else if (b.status === 'partial') {
      statusBadge = '<span class="badge badge-low">Partially Paid</span>';
    } else {
      statusBadge = '<span class="badge badge-out">Unpaid</span>';
    }

    return `<tr>
      <td><b>#${App.esc(String(b.bill_number))}</b></td>
      <td class="nowrap">${App.dateTime(b.created_at)}</td>
      <td class="num"><b>${totalUnits} units</b></td>
      <td class="num"><b>${App.money(b.grand_total)}</b></td>
      <td class="num" style="color:#15803d;font-weight:600">${App.money(b.paid_amount)}</td>
      <td class="num" style="font-weight:700;color:${hasBal ? '#dc2626' : '#15803d'}">${App.money(b.remaining_balance)}</td>
      <td>${statusBadge}</td>
      <td class="small muted">${App.esc(b.notes || '—')}</td>
      <td class="actions" style="display:flex;gap:.3rem">
        ${isUnpaid ? `<button class="btn btn-sm btn-dark" data-edit-bill="${b.id}" title="Edit Invoice Products">✏️ Edit</button>` : ''}
        <button class="btn btn-sm" data-view-bill="${b.id}">View Bill</button>
      </td>
    </tr>`;
  }

  async function viewBill(id) {
    try {
      const { bill } = await App.api('/api/salesman/bills/' + id);
      showSalesmanBill(bill);
    } catch (err) { App.toast(err.message, 'error'); }
  }

  function showSalesmanBill(bill) {
    const rows = (bill.items || []).map((it, i) => `
      <tr>
        <td>${i + 1}. <b>${App.esc(it.item_name)}</b></td>
        <td class="num" style="font-weight:700">${it.quantity}</td>
        <td class="num">${App.money(it.unit_price)}</td>
        <td class="num" style="font-weight:700">${App.money(it.line_total)}</td>
      </tr>`).join('');

    const totalQty = bill.total_quantity || (bill.items || []).reduce((s, it) => s + it.quantity, 0);

    const d = App.dialog({
      title: `Product Delivery Bill #${bill.bill_number}`,
      wide: true,
      body: `
        <div class="bill-paper">
          <div class="bill-head">
            <div class="bill-header-row">
              <img src="/logo.jpg" alt="MJ AUTOS" class="bill-logo">
              <div class="bill-header-info">
                <p class="shop">MJ AUTOS</p>
                <div class="sub">Product Delivery Slip (سپلائی بل)</div>
              </div>
            </div>
          </div>
          <div class="bill-meta">
            <div>Bill No: <b>#${bill.bill_number}</b></div>
            <div class="r">${App.dateTime(bill.created_at)}</div>
            <div>Delivered By: <b>${App.esc(bill.salesman_name)}</b></div>
            <div class="r">Total Units: <b>${totalQty} units</b></div>
          </div>
          <table class="bill-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th class="n">Quantity</th>
                <th class="n">Unit Price</th>
                <th class="n">Total Price</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="bill-totals" style="padding-top:8px">
            <div class="line" style="font-weight:600">
              <span>TOTAL DELIVERED UNITS:</span>
              <span>${totalQty} units</span>
            </div>
            <div class="line grand-line" style="font-weight:800;font-size:1.15em">
              <span>GRAND TOTAL BILL:</span>
              <span>${App.money(bill.grand_total)}</span>
            </div>
            <div class="line" style="color:#15803d;font-weight:600">
              <span>Amount Paid:</span>
              <span>${App.money(bill.paid_amount)}</span>
            </div>
            <div class="line" style="font-weight:700;color:${bill.remaining_balance > 0 ? '#b91c1c' : '#15803d'}">
              <span>Remaining Balance:</span>
              <span>${bill.remaining_balance > 0 ? App.money(bill.remaining_balance) : '✓ Fully Paid'}</span>
            </div>
          </div>
          ${bill.notes ? `<div style="margin-top:.75rem;padding:.5rem;background:#f8fafc;border-radius:6px;font-size:.9rem"><b>Delivery Notes:</b> ${App.esc(bill.notes)}</div>` : ''}
        </div>`,
      foot: `
        ${(bill.paid_amount || 0) === 0 ? `<button class="btn btn-dark" id="btnEditBillInModal" style="margin-right:auto">✏️ Edit Invoice (بل میں ترمیم کریں)</button>` : ''}
        <button class="btn btn-primary" id="btnPayBillInModal" style="background:#15803d;border-color:#15803d">+ Record Payment for this Bill</button>
        <button class="btn btn-dark" data-print-bill>🖨️ Print Delivery Slip</button>
        <button class="btn" data-close>Close</button>`,
    });

    d.querySelector('[data-print-bill]').addEventListener('click', () => {
      const area = document.getElementById('printArea') || (() => { const el = document.createElement('div'); el.id = 'printArea'; document.body.appendChild(el); return el; })();
      area.innerHTML = d.querySelector('.bill-paper').outerHTML;
      window.print();
    });
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    const payBtn = d.querySelector('#btnPayBillInModal');
    if (payBtn) {
      payBtn.addEventListener('click', () => {
        d.close();
        openRecordPaymentModal(bill.id);
      });
    }
    const editBtn = d.querySelector('#btnEditBillInModal');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        d.close();
        openEditBill(bill.id);
      });
    }
  }

  async function openEditBill(id) {
    try {
      const { bill } = await App.api('/api/salesman/bills/' + id);
      if (Number(bill.paid_amount) > 0) {
        App.toast('This bill cannot be edited because payment has already been recorded against it.', 'error');
        return;
      }

      let editCart = (bill.items || []).map(it => ({
        key: Date.now() + Math.random(),
        product_id: it.product_id || null,
        item_name: it.item_name,
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        line_total: Math.round((Number(it.unit_price) || 0) * (Number(it.quantity) || 1) * 100) / 100,
      }));

      const d = App.dialog({
        title: `✏️ Edit Delivery Bill #${bill.bill_number} (بل میں ترمیم کریں)`,
        wide: true,
        body: `
          <div class="form-error hidden" id="editBillErr" style="margin-bottom:.75rem"></div>

          <div style="background:#f8fafc;padding:.75rem;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:.75rem">
            <div style="font-weight:700;margin-bottom:.5rem;font-size:.9rem">Add / Change Delivered Products:</div>
            <div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:2;min-width:180px">
                <label class="label">Product Name (پروڈکٹ کا نام) *</label>
                <input type="text" id="editProdName" class="input" placeholder="e.g. Brake Shoe CD70, Mobil 1, etc.">
              </div>
              <div style="width:100px">
                <label class="label">Quantity (تعداد) *</label>
                <input type="number" id="editProdQty" class="input" min="1" value="1">
              </div>
              <div style="width:130px">
                <label class="label">Unit Price (فی یونٹ قیمت) *</label>
                <input type="number" id="editProdPrice" class="input" min="0.01" step="any" placeholder="Rs">
              </div>
              <button class="btn btn-primary" id="addEditCartBtn" type="button" style="height:38px">+ Add to Bill</button>
            </div>
          </div>

          <div class="table-wrap" style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px">
            <table class="table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th class="num" style="width:110px">Quantity</th>
                  <th class="num" style="width:120px">Unit Price (Rs)</th>
                  <th class="num" style="width:120px">Total (Rs)</th>
                  <th style="width:50px"></th>
                </tr>
              </thead>
              <tbody id="editCartBody"></tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.75rem;padding:.5rem .75rem;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
            <div><b>Total Units:</b> <span id="editTotalUnits" style="font-weight:700">0 units</span></div>
            <div><b>Grand Total Amount:</b> <span id="editGrandTotal" style="font-size:1.2rem;font-weight:800;color:#15803d">Rs 0</span></div>
          </div>

          <div style="margin-top:.75rem">
            <label class="label">Delivery Notes / Remarks (optional)</label>
            <textarea id="editBillNotes" class="input" rows="2" placeholder="Optional notes…">${App.esc(bill.notes || '')}</textarea>
          </div>
        `,
        foot: `
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" id="btnSaveEditBill" style="font-weight:700">Save Changes (ترمیم محفوظ کریں)</button>
        `,
      });

      function renderEditCart() {
        const tbody = d.querySelector('#editCartBody');
        if (!editCart.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty">No products in this bill. Please add at least one product.</td></tr>';
          d.querySelector('#editTotalUnits').textContent = '0 units';
          d.querySelector('#editGrandTotal').textContent = 'Rs 0';
          return;
        }
        tbody.innerHTML = editCart.map(it => `
          <tr>
            <td><b>${App.esc(it.item_name)}</b></td>
            <td class="num nowrap">
              <button class="btn btn-sm" data-dec="${it.key}" style="padding:2px 7px">−</button>
              <input type="number" min="1" value="${it.quantity}" data-qty="${it.key}" style="width:55px;text-align:center;padding:2px">
              <button class="btn btn-sm" data-inc="${it.key}" style="padding:2px 7px">+</button>
            </td>
            <td class="num">
              <input type="number" min="0.01" step="any" value="${it.unit_price}" data-price="${it.key}" style="width:85px;text-align:right;padding:2px">
            </td>
            <td class="num"><b>${App.money(it.line_total)}</b></td>
            <td class="actions">
              <button class="btn btn-sm btn-dark" data-remove="${it.key}" title="Remove">✕</button>
            </td>
          </tr>
        `).join('');

        tbody.querySelectorAll('[data-qty]').forEach(inp => inp.addEventListener('change', () => {
          const it = editCart.find(c => String(c.key) === inp.dataset.qty);
          if (it) {
            it.quantity = Math.max(1, parseInt(inp.value) || 1);
            it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
            renderEditCart();
          }
        }));
        tbody.querySelectorAll('[data-price]').forEach(inp => inp.addEventListener('change', () => {
          const it = editCart.find(c => String(c.key) === inp.dataset.price);
          if (it) {
            it.unit_price = Math.max(0, parseFloat(inp.value) || 0);
            it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
            renderEditCart();
          }
        }));
        tbody.querySelectorAll('[data-inc]').forEach(btn => btn.addEventListener('click', () => {
          const it = editCart.find(c => String(c.key) === btn.dataset.inc);
          if (it) {
            it.quantity++;
            it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
            renderEditCart();
          }
        }));
        tbody.querySelectorAll('[data-dec]').forEach(btn => btn.addEventListener('click', () => {
          const it = editCart.find(c => String(c.key) === btn.dataset.dec);
          if (it && it.quantity > 1) {
            it.quantity--;
            it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
            renderEditCart();
          }
        }));
        tbody.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
          editCart = editCart.filter(c => String(c.key) !== btn.dataset.remove);
          renderEditCart();
        }));

        const totalUnits = editCart.reduce((s, it) => s + (it.quantity || 0), 0);
        const grandTotal = editCart.reduce((s, it) => s + (it.line_total || 0), 0);
        d.querySelector('#editTotalUnits').textContent = totalUnits + ' units';
        d.querySelector('#editGrandTotal').textContent = App.money(grandTotal);
      }

      renderEditCart();

      d.querySelector('#addEditCartBtn').addEventListener('click', () => {
        const errBox = d.querySelector('#editBillErr');
        errBox.classList.add('hidden');
        const nameInput = d.querySelector('#editProdName');
        const qtyInput = d.querySelector('#editProdQty');
        const priceInput = d.querySelector('#editProdPrice');

        const name = nameInput.value.trim();
        const qty = parseInt(qtyInput.value) || 0;
        const price = parseFloat(priceInput.value) || 0;

        if (!name) {
          errBox.textContent = 'Please enter product name.';
          errBox.classList.remove('hidden');
          nameInput.focus();
          return;
        }
        if (qty <= 0) {
          errBox.textContent = 'Quantity must be at least 1.';
          errBox.classList.remove('hidden');
          qtyInput.focus();
          return;
        }
        if (price <= 0) {
          errBox.textContent = 'Please enter a valid unit price.';
          errBox.classList.remove('hidden');
          priceInput.focus();
          return;
        }

        const lineTotal = Math.round(qty * price * 100) / 100;
        const existing = editCart.find(c => c.item_name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.quantity += qty;
          existing.unit_price = price;
          existing.line_total = Math.round(existing.quantity * price * 100) / 100;
        } else {
          editCart.push({
            key: Date.now() + Math.random(),
            product_id: null,
            item_name: name,
            quantity: qty,
            unit_price: price,
            line_total: lineTotal,
          });
        }

        nameInput.value = '';
        qtyInput.value = 1;
        priceInput.value = '';
        nameInput.focus();
        renderEditCart();
      });

      d.querySelector('[data-cancel]').addEventListener('click', () => d.close());

      const saveBtn = d.querySelector('#btnSaveEditBill');
      saveBtn.addEventListener('click', async () => {
        const errBox = d.querySelector('#editBillErr');
        errBox.classList.add('hidden');
        if (!editCart.length) {
          errBox.textContent = 'Please add at least one product.';
          errBox.classList.remove('hidden');
          return;
        }

        const notes = d.querySelector('#editBillNotes').value.trim() || null;
        const items = editCart.map(it => ({
          product_id: it.product_id || null,
          item_name: it.item_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
        }));

        await App.busy(saveBtn, async () => {
          try {
            await App.api('/api/salesman/bills/' + bill.id, {
              method: 'PUT',
              body: { items, notes },
            });
            d.close();
            App.toast('Invoice updated successfully! / بل میں ترمیم محفوظ ہو گئی', 'success');
            loadSummary();
            loadBills(true);
          } catch (err) {
            errBox.textContent = err.message || 'Failed to update bill';
            errBox.classList.remove('hidden');
          }
        });
      });
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  async function openRecordPaymentModal(prefillBillId = null) {
    let activeSalesmen = [];
    if (App.user && App.user.role === 'owner') {
      try {
        const sRes = await App.api('/api/salesman/salesmen');
        activeSalesmen = sRes.salesmen || [];
      } catch (_) {
        activeSalesmen = [];
      }
    }

    let billsList = [];
    try {
      const res = await App.api('/api/salesman/bills?offset=0');
      billsList = res.bills || [];
    } catch (_) {}

    const today = new Date().toISOString().slice(0, 10);
    const billOptions = billsList.map((b, i) => {
      const isSelected = prefillBillId ? (b.id === Number(prefillBillId) ? 'selected' : '') : (i === 0 ? 'selected' : '');
      const balText = b.remaining_balance > 0 ? ` [Due: ${App.money(b.remaining_balance)}]` : ' [Paid]';
      return `<option value="${b.id}" ${isSelected}>Bill #${App.esc(String(b.bill_number))}${balText} (${App.dateTime(b.created_at)})</option>`;
    }).join('');

    const salesmanDropdownHtml = (App.user && App.user.role === 'owner' && activeSalesmen.length) ? `
      <div style="margin-bottom:.75rem">
        <label class="label" style="font-weight:700">Salesman (سیلز مین کا انتخاب) *</label>
        <select id="paySalesmanSelect" class="input">
          ${activeSalesmen.map(s => `<option value="${s.id}">${App.esc(s.name)} (${App.esc(s.email)})</option>`).join('')}
        </select>
      </div>` : '';

    const bodyHtml = `
      <form id="recordPaymentForm">
        <div class="form-error hidden" id="payModalErr" style="margin-bottom:.75rem"></div>

        ${salesmanDropdownHtml}

        <div style="display:flex;gap:1rem;margin-bottom:1rem;background:#f8fafc;padding:.75rem;border-radius:6px;border:1px solid #e2e8f0">
          <label style="display:flex;align-items:center;gap:.35rem;font-weight:600;cursor:pointer">
            <input type="radio" name="paymentType" value="cash" id="radioCash" checked>
            <span>💵 Cash (نقد رقم)</span>
          </label>
          <label style="display:flex;align-items:center;gap:.35rem;font-weight:600;cursor:pointer">
            <input type="radio" name="paymentType" value="bank" id="radioBank">
            <span>🏦 Bank Account (بینک اکاؤنٹ / آن لائن ٹرانسفر)</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
          <div>
            <label class="label" style="font-weight:700">Amount Received (وصول شدہ رقم) *</label>
            <input type="number" id="payAmount" step="0.01" min="1" required class="input" placeholder="e.g. 15000" style="font-size:1.1rem;font-weight:700">
          </div>
          <div>
            <label class="label">Date (وصولی کی تاریخ) *</label>
            <input type="date" id="payDate" value="${today}" required class="input">
          </div>
        </div>

        <!-- Bank specific fields -->
        <div id="bankFields" style="display:none;margin-top:.75rem;padding:.75rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">
          <div style="margin-bottom:.5rem">
            <label class="label" style="font-weight:700;color:#1e40af">Transaction ID / TID (ٹرانزیکشن آئی ڈی) *</label>
            <input type="text" id="payTid" placeholder="e.g. TXN84920193 / Bank Ref #" class="input" style="font-family:monospace;font-weight:700">
            <div class="small muted" style="margin-top:.2rem">Enter the unique bank transaction ID / reference number.</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.5rem">
            <div>
              <label class="label">Bank Name / Account (بینک کا نام)</label>
              <input type="text" id="payBankName" placeholder="e.g. Meezan Bank, HBL, EasyPaisa" class="input">
            </div>
            <div>
              <label class="label">Proof Ref / Receipt (رسید کی تفصیل)</label>
              <input type="text" id="payProof" placeholder="e.g. Screenshot taken / Slip ref" class="input">
            </div>
          </div>
        </div>

        <!-- Cash specific fields -->
        <div id="cashFields" style="margin-top:.75rem">
          <label class="label">Received By / Handed Over By</label>
          <input type="text" id="payReceivedBy" value="${App.esc(App.user ? App.user.name : 'Salesman')}" class="input" placeholder="Who handed over / received the cash">
        </div>

        <div style="margin-top:.75rem">
          <label class="label">Against Delivery Bill (بل سے منسلک کریں)</label>
          <select id="payBillId" class="input">
            ${billOptions}
            <option value="">-- General Account (کسی خاص بل کے بغیر) --</option>
          </select>
        </div>

        <div style="margin-top:.75rem">
          <label class="label">Notes / Remarks (اضافی تفصیل)</label>
          <textarea id="payNotes" rows="2" class="input" placeholder="Optional notes..."></textarea>
        </div>
      </form>
    `;

    const dialog = App.dialog({
      title: 'Record Payment Received from MJ Autos (رقم وصولی درج کریں)',
      body: bodyHtml,
      foot: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="btnSubmitPayment" style="background:#15803d;border-color:#15803d">Save Payment (محفوظ کریں)</button>
      `,
    });

    const radioCash = dialog.querySelector('#radioCash');
    const radioBank = dialog.querySelector('#radioBank');
    const bankFields = dialog.querySelector('#bankFields');
    const cashFields = dialog.querySelector('#cashFields');
    const payTid = dialog.querySelector('#payTid');
    const errBox = dialog.querySelector('#payModalErr');

    function toggleFields() {
      const isBank = radioBank.checked;
      bankFields.style.display = isBank ? 'block' : 'none';
      cashFields.style.display = isBank ? 'none' : 'block';
      if (isBank) {
        payTid.setAttribute('required', 'required');
      } else {
        payTid.removeAttribute('required');
      }
    }

    radioCash.addEventListener('change', toggleFields);
    radioBank.addEventListener('change', toggleFields);

    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

    const submitBtn = dialog.querySelector('#btnSubmitPayment');
    submitBtn.addEventListener('click', async () => {
      errBox.classList.add('hidden');
      const isBank = radioBank.checked;
      const amount = parseFloat(dialog.querySelector('#payAmount').value);
      const date = dialog.querySelector('#payDate').value;
      const billId = dialog.querySelector('#payBillId').value || null;
      const notes = dialog.querySelector('#payNotes').value.trim();
      const smSelect = dialog.querySelector('#paySalesmanSelect');
      const salesmanId = smSelect ? smSelect.value : undefined;

      if (!amount || isNaN(amount) || amount <= 0) {
        errBox.textContent = 'Please enter a valid payment amount';
        errBox.classList.remove('hidden');
        dialog.querySelector('#payAmount').focus();
        return;
      }

      if (!date) {
        errBox.textContent = 'Please select a date';
        errBox.classList.remove('hidden');
        return;
      }

      try {
        await App.busy(submitBtn, async () => {
          if (isBank) {
            const tid = payTid.value.trim();
            if (!tid) {
              errBox.textContent = 'Transaction ID (TID) is required for bank transfers';
              errBox.classList.remove('hidden');
              payTid.focus();
              throw new Error('TID required');
            }
            const bankAccount = dialog.querySelector('#payBankName').value.trim();
            const proofNote = dialog.querySelector('#payProof').value.trim();

            await App.api('/api/salesman/payments/bank', {
              method: 'POST',
              body: {
                salesman_id: salesmanId || undefined,
                amount,
                transfer_date: date,
                transfer_id: tid,
                bank_account: bankAccount || null,
                proof_note: proofNote || null,
                notes: notes || null,
                bill_id: billId ? Number(billId) : null,
              },
            });
          } else {
            const receivedBy = dialog.querySelector('#payReceivedBy').value.trim();
            await App.api('/api/salesman/payments/cash', {
              method: 'POST',
              body: {
                salesman_id: salesmanId || undefined,
                amount,
                payment_date: date,
                received_by: receivedBy || null,
                notes: notes || null,
                bill_id: billId ? Number(billId) : null,
              },
            });
          }
        });

        App.toast('Payment recorded successfully! / رقم کامیابی سے درج ہو گئی', 'success');
        dialog.close();
        loadSummary();
      } catch (err) {
        if (err.message !== 'TID required') {
          errBox.textContent = err.message || 'Payment submission failed';
          errBox.classList.remove('hidden');
          App.toast(err.message, 'error');
        }
      }
    });
  }

  function openBillForm() {
    cartItems = [];
    const d = App.dialog({
      title: 'Create Product Delivery Bill (مصنوعات کی ترسیل کا بل)',
      wide: true,
      body: `
        <div class="form-error hidden" id="billErr" style="margin-bottom:.75rem"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
          <div>
            <label class="label">Delivered by</label>
            <input class="input" value="${App.esc(App.user.name)}" disabled>
          </div>
          <div>
            <label class="label">Date &amp; Time</label>
            <input class="input" value="${new Date().toLocaleString()}" disabled>
          </div>
        </div>

        <div style="background:#f8fafc;padding:.75rem;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:.75rem">
          <div style="font-weight:700;margin-bottom:.5rem;font-size:.9rem">Add Delivered Products:</div>
          <div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
            <div style="flex:2;min-width:180px">
              <label class="label">Product Name (پروڈکٹ کا نام) *</label>
              <input type="text" id="billProdName" class="input" placeholder="e.g. Brake Shoe CD70, Mobil 1, etc." required>
            </div>
            <div style="width:100px">
              <label class="label">Quantity (تعداد) *</label>
              <input type="number" id="billProdQty" class="input" min="1" value="1" required>
            </div>
            <div style="width:130px">
              <label class="label">Unit Price (فی یونٹ قیمت) *</label>
              <input type="number" id="billProdPrice" class="input" min="0.01" step="any" placeholder="Rs" required>
            </div>
            <button class="btn btn-primary" id="addCartBtn" type="button" style="height:38px">+ Add to Bill</button>
          </div>
        </div>

        <div class="table-wrap" style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px">
          <table class="table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th class="num" style="width:110px">Quantity</th>
                <th class="num" style="width:120px">Unit Price (Rs)</th>
                <th class="num" style="width:120px">Total (Rs)</th>
                <th style="width:50px"></th>
              </tr>
            </thead>
            <tbody id="cartBody">
              <tr><td colspan="5" class="empty">No products added to this delivery bill yet.</td></tr>
            </tbody>
          </table>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.75rem;padding:.5rem .75rem;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
          <div><b>Total Delivered Units:</b> <span id="cartTotalUnits" style="font-weight:700">0 units</span></div>
          <div><b>Grand Total Amount:</b> <span id="cartGrandTotal" style="font-size:1.2rem;font-weight:800;color:#15803d">Rs 0</span></div>
        </div>

        <div style="margin-top:.75rem">
          <label class="label" for="billNotes">Notes / Remarks (optional)</label>
          <textarea id="billNotes" class="input" rows="2" placeholder="e.g. Delivered batch #12, partial delivery, payment pending…"></textarea>
        </div>
      `,
      foot: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-save style="font-weight:700">Submit Delivery Bill (بل جمع کروائیں)</button>
      `,
    });

    d.querySelector('#addCartBtn').addEventListener('click', () => addProductToCart(d));
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-save]').addEventListener('click', () => submitBill(d));
    d.querySelector('#billProdName').focus();
  }

  function addProductToCart(d) {
    const errBox = d.querySelector('#billErr');
    errBox.classList.add('hidden');
    const nameInput = d.querySelector('#billProdName');
    const qtyInput = d.querySelector('#billProdQty');
    const priceInput = d.querySelector('#billProdPrice');

    const name = nameInput.value.trim();
    const qty = parseInt(qtyInput.value) || 0;
    const price = parseFloat(priceInput.value) || 0;

    if (!name) {
      errBox.textContent = 'Please enter product name.';
      errBox.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    if (qty <= 0) {
      errBox.textContent = 'Quantity must be at least 1.';
      errBox.classList.remove('hidden');
      qtyInput.focus();
      return;
    }
    if (price <= 0) {
      errBox.textContent = 'Please enter a valid unit price.';
      errBox.classList.remove('hidden');
      priceInput.focus();
      return;
    }

    const lineTotal = Math.round(qty * price * 100) / 100;
    const existing = cartItems.find(c => c.item_name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.quantity += qty;
      existing.unit_price = price;
      existing.line_total = Math.round(existing.quantity * price * 100) / 100;
    } else {
      cartItems.push({
        key: Date.now() + Math.random(),
        product_id: null,
        item_name: name,
        quantity: qty,
        unit_price: price,
        line_total: lineTotal,
      });
    }

    nameInput.value = '';
    qtyInput.value = 1;
    priceInput.value = '';
    nameInput.focus();
    renderCart(d);
  }

  function renderCart(d) {
    const tbody = d.querySelector('#cartBody');
    if (!cartItems.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No products added to this delivery bill yet.</td></tr>';
      d.querySelector('#cartTotalUnits').textContent = '0 units';
      d.querySelector('#cartGrandTotal').textContent = 'Rs 0';
      return;
    }
    tbody.innerHTML = cartItems.map(it => `
      <tr>
        <td><b>${App.esc(it.item_name)}</b></td>
        <td class="num nowrap">
          <button class="btn btn-sm" data-dec="${it.key}" style="padding:2px 7px">−</button>
          <input type="number" min="1" value="${it.quantity}" data-qty="${it.key}" style="width:55px;text-align:center;padding:2px">
          <button class="btn btn-sm" data-inc="${it.key}" style="padding:2px 7px">+</button>
        </td>
        <td class="num">
          <input type="number" min="0.01" step="any" value="${it.unit_price}" data-price="${it.key}" style="width:85px;text-align:right;padding:2px">
        </td>
        <td class="num"><b>${App.money(it.line_total)}</b></td>
        <td class="actions">
          <button class="btn btn-sm btn-dark" data-remove="${it.key}" title="Remove">✕</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qty]').forEach(inp => inp.addEventListener('change', () => {
      const it = cartItems.find(c => String(c.key) === inp.dataset.qty);
      if (it) {
        it.quantity = Math.max(1, parseInt(inp.value) || 1);
        it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
        renderCart(d);
      }
    }));
    tbody.querySelectorAll('[data-price]').forEach(inp => inp.addEventListener('change', () => {
      const it = cartItems.find(c => String(c.key) === inp.dataset.price);
      if (it) {
        it.unit_price = Math.max(0, parseFloat(inp.value) || 0);
        it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
        renderCart(d);
      }
    }));
    tbody.querySelectorAll('[data-inc]').forEach(btn => btn.addEventListener('click', () => {
      const it = cartItems.find(c => String(c.key) === btn.dataset.inc);
      if (it) {
        it.quantity++;
        it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
        renderCart(d);
      }
    }));
    tbody.querySelectorAll('[data-dec]').forEach(btn => btn.addEventListener('click', () => {
      const it = cartItems.find(c => String(c.key) === btn.dataset.dec);
      if (it && it.quantity > 1) {
        it.quantity--;
        it.line_total = Math.round(it.quantity * it.unit_price * 100) / 100;
        renderCart(d);
      }
    }));
    tbody.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
      cartItems = cartItems.filter(c => String(c.key) !== btn.dataset.remove);
      renderCart(d);
    }));

    const totalUnits = cartItems.reduce((s, it) => s + (it.quantity || 0), 0);
    const grandTotal = cartItems.reduce((s, it) => s + (it.line_total || 0), 0);
    d.querySelector('#cartTotalUnits').textContent = totalUnits + ' units';
    d.querySelector('#cartGrandTotal').textContent = App.money(grandTotal);
  }

  async function submitBill(d) {
    const errBox = d.querySelector('#billErr');
    errBox.classList.add('hidden');
    if (!cartItems.length) { errBox.textContent = 'Please add at least one product.'; errBox.classList.remove('hidden'); return; }
    const notes = d.querySelector('#billNotes').value.trim() || null;
    const items = cartItems.map(it => ({
      product_id: it.product_id || null,
      item_name: it.item_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
    }));
    await App.busy(d.querySelector('[data-save]'), async () => {
      try {
        await App.api('/api/salesman/bills', { method: 'POST', body: { items, notes } });
        d.close();
        App.toast('Delivery bill submitted successfully! It is now visible in the Admin Panel.', 'success');
        cartItems = [];
        loadSummary();
        loadBills(true);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    });
  }

  init().catch(err => App.toast(err.message, 'error'));
})();
