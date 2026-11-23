(function () {
  const $ = (id) => document.getElementById(id);
  let alerts = [];

  async function load() {
    try {
      const d = await App.api('/api/dashboard');
      alerts = d.alerts;
      $('todayTotal').textContent = App.money(d.today.total);
      if ($('todayBalance')) $('todayBalance').textContent = App.money(d.today.balance_total || 0);
      $('todayCount').textContent = d.today.count;
      $('productCount').textContent = d.productCount;
      $('alertCount').textContent = d.alerts.length;

      // Populate Salesman Overview
      if (d.salesmenOverview) {
        const t = d.salesmenOverview.totals;
        if ($('smDashBillsCount')) $('smDashBillsCount').textContent = t.total_bills || 0;
        if ($('smDashBillsAmount')) $('smDashBillsAmount').textContent = App.money(t.total_bill_amount || 0);
        if ($('smDashCashPaid')) $('smDashCashPaid').textContent = App.money(t.total_cash || 0);
        if ($('smDashBankPaid')) $('smDashBankPaid').textContent = App.money(t.total_bank || 0);
        if ($('smDashTotalPaid')) $('smDashTotalPaid').textContent = App.money(t.total_paid || 0);
        if ($('smDashOutstanding')) $('smDashOutstanding').textContent = App.money(t.total_pending || 0);

        const smTable = $('smDashTableBody');
        if (smTable) {
          const list = d.salesmenOverview.salesmen || [];
          if (!list.length) {
            smTable.innerHTML = '<tr><td colspan="8" class="empty">No salesmen accounts created yet. <a href="/users">Add a salesman</a> to get started.</td></tr>';
          } else {
            smTable.innerHTML = list.map(s => `
              <tr>
                <td><b>${App.esc(s.name)}</b></td>
                <td class="num">${s.bill_count}</td>
                <td class="num">${App.money(s.total_bill_amount)}</td>
                <td class="num">${App.money(s.cash_paid)}</td>
                <td class="num">${App.money(s.bank_paid)}</td>
                <td class="num"><b>${App.money(s.total_paid)}</b></td>
                <td class="num" style="font-weight:700;color:${s.remaining_balance > 0 ? '#b91c1c' : '#15803d'}">${App.money(s.remaining_balance)}</td>
                <td class="actions">
                  <a href="/salesman-ledger?id=${s.id}" class="btn btn-sm btn-dark">Open Ledger →</a>
                </td>
              </tr>
            `).join('');
          }
        }
      }

      $('alertRows').innerHTML = d.alerts.length
        ? d.alerts
            .map(
              (p) => `<tr>
                <td><b>${App.esc(p.name)}</b>${p.part_number ? ` <span class="muted small" style="font-family:monospace">(${App.esc(p.part_number)})</span>` : ''}</td>
                <td class="num">${p.stock_qty}</td>
                <td class="num">${p.min_stock}</td>
                <td>${App.statusBadge(p.status)}</td>
                <td class="actions"><button class="btn btn-sm btn-success" data-restock="${p.id}">Restock</button></td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty">All products are well stocked.</td></tr>';

      $('recentRows').innerHTML = d.recentBills.length
        ? d.recentBills
            .map(
              (b) => {
                const hasBal = b.balance_due && Number(b.balance_due) > 0;
                const paidAmt = b.advance_paid !== null && b.advance_paid !== undefined
                  ? Number(b.advance_paid)
                  : (hasBal ? Math.max(0, Number(b.grand_total) - Number(b.balance_due)) : Number(b.grand_total));
                return `<tr>
                  <td><b>#${b.bill_number}</b></td>
                  <td class="nowrap">${App.dateTime(b.created_at)}</td>
                  <td>${App.esc(b.customer_name || 'Walk-in')}</td>
                  <td class="num">
                    <b>${App.money(b.grand_total)}</b>
                    ${hasBal
                      ? `<div class="small" style="color:#15803d;font-weight:600">Paid: ${App.money(paidAmt)}</div>
                         <div class="small" style="color:#dc2626;font-weight:700">Pending: ${App.money(b.balance_due)}</div>`
                      : `<div class="small" style="color:#15803d;font-weight:600">✓ All Paid</div>`}
                  </td>
                  <td class="actions">
                    ${hasBal ? `<button class="btn btn-sm btn-primary" data-pay-bill-id="${b.id}" style="background:#15803d;border-color:#15803d;font-weight:600">💰 Pay</button>` : ''}
                    <button class="btn btn-sm" data-bill="${b.id}">View</button>
                  </td>
                </tr>`;
              }
            )
            .join('')
        : '<tr><td colspan="5" class="empty">No bills yet.</td></tr>';
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-restock]');
    if (r) App.openRestock(alerts.find((p) => p.id === Number(r.dataset.restock)));
    const payBtn = e.target.closest('[data-pay-bill-id]');
    if (payBtn) {
      try {
        const { bill } = await App.api('/api/bills/' + payBtn.dataset.payBillId);
        App.openPayBalanceModal(bill, () => load());
      } catch (err) { App.toast(err.message, 'error'); }
      return;
    }
    const b = e.target.closest('[data-bill]');
    if (b) {
      try {
        const { bill } = await App.api('/api/bills/' + b.dataset.bill);
        App.showBill(bill, { onClose: () => load() });
      } catch (err) { App.toast(err.message, 'error'); }
    }
  });
  document.addEventListener('mj:stock-changed', load);

  App.init('dashboard').then(load);
})();
