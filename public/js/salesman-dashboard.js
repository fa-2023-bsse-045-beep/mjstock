/* salesman-dashboard.js — Salesman's dashboard (Deliveries view, payments received with TID, and total due) */
(function () {
  let billsList = [];

  async function init() {
    const user = await App.init('salesman-dashboard');
    if (user.role !== 'salesman' && user.role !== 'owner') {
      location.href = '/dashboard';
      return;
    }

    const btnRecord = document.getElementById('btnRecordPayment');
    if (btnRecord) btnRecord.addEventListener('click', () => openRecordPaymentModal());

    const btnRecordTable = document.getElementById('btnRecordPaymentTable');
    if (btnRecordTable) btnRecordTable.addEventListener('click', () => openRecordPaymentModal());

    await load();
  }

  async function load() {
    try {
      const data = await App.api('/api/salesman/dashboard');
      const s = data.summary || {};

      // Outstanding balance / Total Due
      if (document.getElementById('statTotalDue')) {
        document.getElementById('statTotalDue').textContent = 'PKR ' + App.money(s.pending || 0);
      }
      if (document.getElementById('statTotalPaid')) {
        document.getElementById('statTotalPaid').textContent = 'PKR ' + App.money(s.total_paid || 0);
      }
      if (document.getElementById('statTotalCash')) {
        document.getElementById('statTotalCash').textContent = 'PKR ' + App.money(s.total_cash || 0);
      }
      if (document.getElementById('statTotalBank')) {
        document.getElementById('statTotalBank').textContent = 'PKR ' + App.money(s.total_bank || 0);
      }
      if (document.getElementById('statBillCount')) {
        document.getElementById('statBillCount').textContent = s.bill_count || 0;
      }
      if (document.getElementById('statTotalUnits')) {
        document.getElementById('statTotalUnits').textContent = (s.total_products_delivered || 0) + ' units';
      }

      // Recent deliveries table
      const bt = document.getElementById('recentBillsBody');
      if (bt) {
        bt.innerHTML = data.recentBills && data.recentBills.length
          ? data.recentBills.map(b => {
              const hasBal = (b.remaining_balance || 0) > 0;
              let statusBadge = '';
              if (b.remaining_balance <= 0 && b.paid_amount > 0) {
                statusBadge = '<span class="badge badge-ok">✓ Paid</span>';
              } else if (b.paid_amount > 0) {
                statusBadge = '<span class="badge badge-low">Partial</span>';
              } else {
                statusBadge = '<span class="badge badge-out">Unpaid</span>';
              }
              return `
                <tr>
                  <td><b>#${App.esc(String(b.bill_number))}</b></td>
                  <td class="nowrap">${App.dateTime(b.created_at)}</td>
                  <td class="num" style="font-weight:700">${b.total_quantity || 0} units</td>
                  <td class="num"><b>${App.money(b.grand_total || 0)}</b></td>
                  <td class="num" style="color:#15803d;font-weight:600">${App.money(b.paid_amount || 0)}</td>
                  <td>${statusBadge}</td>
                  <td class="small muted">${App.esc(b.notes || '—')}</td>
                  <td class="actions">
                    <button class="btn btn-sm btn-dark" data-view-bill="${b.id}">View</button>
                  </td>
                </tr>`;
            }).join('')
          : '<tr><td colspan="8" class="empty">No product deliveries recorded yet. <a href="/my-sales">Create a delivery bill</a> to get started.</td></tr>';

        bt.querySelectorAll('[data-view-bill]').forEach(btn => {
          btn.addEventListener('click', () => viewBillModal(Number(btn.dataset.viewBill)));
        });
      }

      // Payments received list (Cash + Bank combined, ordered by date desc)
      const cashPayments = (data.recentCash || []).map(c => ({
        ...c,
        type: 'cash',
        date: c.payment_date,
        ref: 'CASH-' + c.id,
      }));
      const bankPayments = (data.recentBank || []).map(b => ({
        ...b,
        type: 'bank',
        date: b.transfer_date,
        ref: b.transfer_id,
      }));

      const allPayments = [...cashPayments, ...bankPayments].sort((a, b) => new Date(b.date) - new Date(a.date));

      const pt = document.getElementById('paymentsBody');
      if (pt) {
        pt.innerHTML = allPayments.length
          ? allPayments.map(p => {
              const isBank = p.type === 'bank';
              const typeBadge = isBank
                ? '<span class="badge-bank">🏦 Bank Transfer</span>'
                : '<span class="badge-cash">💵 Cash</span>';
              const refDisplay = isBank
                ? `<span class="tid-code" title="Transaction ID">${App.esc(p.transfer_id || p.ref)}</span>`
                : `<span class="small muted">${App.esc(p.ref)}</span>`;
              const bankDisplay = isBank
                ? App.esc(p.bank_account || 'Bank Account')
                : '—';
              const notesDisplay = isBank
                ? [p.proof_note ? `<b>Proof:</b> ${App.esc(p.proof_note)}` : '', p.notes ? App.esc(p.notes) : ''].filter(Boolean).join(' · ') || '—'
                : [p.received_by ? `<b>Recv:</b> ${App.esc(p.received_by)}` : '', p.notes ? App.esc(p.notes) : ''].filter(Boolean).join(' · ') || '—';
              const billDisplay = p.bill_number ? `<b>#${App.esc(String(p.bill_number))}</b>` : '<span class="muted">General</span>';

              return `
                <tr>
                  <td class="nowrap">${App.esc(p.date ? p.date.slice(0, 10) : '—')}</td>
                  <td>${typeBadge}</td>
                  <td>${refDisplay}</td>
                  <td>${bankDisplay}</td>
                  <td class="num" style="font-weight:700;color:#15803d">PKR ${App.money(p.amount)}</td>
                  <td>${billDisplay}</td>
                  <td class="small">${notesDisplay}</td>
                </tr>`;
            }).join('')
          : `<tr><td colspan="7" class="empty">No payments recorded yet. Click <b>+ Record Payment Received</b> to record payments received from MJ Autos.</td></tr>`;
      }
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

    // Fetch salesman's bills for dropdown
    try {
      const res = await App.api('/api/salesman/bills?offset=0');
      billsList = res.bills || [];
    } catch (_) {
      billsList = [];
    }

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
        await load();
      } catch (err) {
        if (err.message !== 'TID required') {
          errBox.textContent = err.message || 'Payment submission failed';
          errBox.classList.remove('hidden');
          App.toast(err.message, 'error');
        }
      }
    });
  }

  async function viewBillModal(id) {
    try {
      const { bill } = await App.api('/api/salesman/bills/' + id);
      const rows = (bill.items || []).map((it, i) => `
        <tr>
          <td>${i + 1}. <b>${App.esc(it.item_name)}</b></td>
          <td class="num" style="font-weight:700">${it.quantity}</td>
          <td class="num">${App.money(it.unit_price)}</td>
          <td class="num" style="font-weight:700">${App.money(it.line_total)}</td>
        </tr>`).join('');

      const totalQty = bill.total_quantity || (bill.items || []).reduce((s, it) => s + it.quantity, 0);

      const html = `
        <div style="margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;background:#f8fafc;padding:.75rem;border-radius:6px">
            <div>
              <div class="small muted">Delivery Bill #</div>
              <div style="font-size:1.3rem;font-weight:800">#${App.esc(String(bill.bill_number))}</div>
            </div>
            <div style="text-align:right">
              <div class="small muted">Delivery Date</div>
              <div><b>${App.dateTime(bill.created_at)}</b></div>
            </div>
          </div>
        </div>

        <table class="table" style="margin-top:.75rem">
          <thead>
            <tr>
              <th>Product Name</th>
              <th class="num">Quantity</th>
              <th class="num">Unit Price</th>
              <th class="num">Total Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#f1f5f9">
              <th colspan="3">Total Units Delivered:</th>
              <th class="num" style="font-weight:800;color:#1e293b">${totalQty} units</th>
            </tr>
            <tr style="background:#e2e8f0;font-size:1.05rem">
              <th colspan="3">Grand Total Bill:</th>
              <th class="num" style="font-weight:800;color:#15803d">${App.money(bill.grand_total)}</th>
            </tr>
          </tfoot>
        </table>

        ${bill.notes ? `<div style="margin-top:.75rem;background:#f8fafc;padding:.5rem;border-radius:4px;font-size:.85rem"><b>Notes:</b> ${App.esc(bill.notes)}</div>` : ''}
      `;

      App.dialog({
        title: `Delivery Bill #${bill.bill_number}`,
        body: html,
        foot: `
          <button class="btn btn-primary" id="btnPayThisBill" style="background:#15803d;border-color:#15803d">+ Record Payment for this Bill</button>
          <button class="btn btn-dark" data-close>Close</button>
        `,
      });

      const d = document.querySelector('dialog[open]');
      if (d) {
        d.querySelector('[data-close]').addEventListener('click', () => d.close());
        const payBtn = d.querySelector('#btnPayThisBill');
        if (payBtn) {
          payBtn.addEventListener('click', () => {
            d.close();
            openRecordPaymentModal(bill.id);
          });
        }
      }
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  init().catch(err => App.toast(err.message, 'error'));
})();
