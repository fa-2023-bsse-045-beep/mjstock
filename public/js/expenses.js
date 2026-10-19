/* Admin: Monthly Records page (/expenses) */
(async function () {
  const user = await App.init('expenses');
  if (user.role !== 'owner') { location.href = '/my-expenses'; return; }

  // ── State ────────────────────────────────────────────────────────────
  const now   = new Date();
  let year    = now.getFullYear();
  let month   = now.getMonth() + 1;
  let offset  = 0;
  let hasMore = false;
  let q       = '';
  let cashierId = '';

  // ── DOM ──────────────────────────────────────────────────────────────
  const filterMonth   = document.getElementById('filterMonth');
  const filterYear    = document.getElementById('filterYear');
  const applyFilter   = document.getElementById('applyFilter');
  const searchQ       = document.getElementById('searchQ');
  const filterCashier = document.getElementById('filterCashier');
  const purposeRows   = document.getElementById('purposeRows');
  const cashierRows   = document.getElementById('cashierRows');
  const accountRows   = document.getElementById('accountRows');
  const expenseRows   = document.getElementById('expenseRows');
  const loadMoreWrap  = document.getElementById('loadMoreWrap');
  const loadMoreBtn   = document.getElementById('loadMoreBtn');
  const statIncome    = document.getElementById('statIncome');
  const statBillCount = document.getElementById('statBillCount');
  const statExpenses  = document.getElementById('statExpenses');
  const statExpCount  = document.getElementById('statExpCount');
  const statBalance   = document.getElementById('statBalance');
  const statBalanceTile = document.getElementById('statBalanceTile');
  const statCashInHand = document.getElementById('statCashInHand');
  const statCashInHandTile = document.getElementById('statCashInHandTile');
  const statCashInHandSub = document.getElementById('statCashInHandSub');
  const statDue       = document.getElementById('statDue');
  const statDueTile   = document.getElementById('statDueTile');
  const statDueSub    = document.getElementById('statDueSub');
  const pendingSection = document.getElementById('pendingSection');
  const pendingBadge  = document.getElementById('pendingBadge');
  const pendingBillRows = document.getElementById('pendingBillRows');

  // ── Init filter pickers ──────────────────────────────────────────────
  filterMonth.value = month;
  filterYear.value  = year;

  // ── Load cashier list for dropdown ──────────────────────────────────
  try {
    const { users } = await App.api('/api/users');
    users.filter((u) => u.role !== 'owner' || true).forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name + (u.role === 'owner' ? ' (owner)' : '');
      filterCashier.appendChild(opt);
    });
  } catch (_) {}

  // ── Fetch & render ──────────────────────────────────────────────────
  async function load(append = false) {
    if (!append) {
      offset = 0;
      expenseRows.innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
    }

    const params = new URLSearchParams({ year, month, offset });
    if (q)         params.set('q', q);
    if (cashierId) params.set('cashier_id', cashierId);

    let data;
    try {
      data = await App.api('/api/expenses?' + params);
    } catch (err) {
      expenseRows.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--out)">${App.esc(err.message)}</td></tr>`;
      return;
    }

    const { expenses, summary, byPurpose, byCashier, byAccount, hasMore: more } = data;
    hasMore = more;
    offset += expenses.length;

    // ── Summary stats ──────────────────────────────────────────────
    statIncome.textContent    = App.money(summary.total_income);
    statBillCount.textContent = `${summary.bill_count} bills (💵 Cash: ${App.money(summary.cash_income || 0)} · 💳 Online: ${App.money(summary.account_income || 0)})`;
    statExpenses.textContent  = App.money(summary.total_expenses);
    statExpCount.textContent  = summary.expense_count + ' entr' + (summary.expense_count !== 1 ? 'ies' : 'y');
    const bal = Number(summary.balance);
    statBalance.textContent   = App.money(bal);
    statBalanceTile.className = 'stat ' + (bal >= 0 ? 'good' : 'exp-stat');

    if (statCashInHand) {
      const cashInHand = Number(summary.cash_in_hand ?? (Number(summary.cash_income || 0) - Number(summary.total_expenses || 0)));
      statCashInHand.textContent = App.money(cashInHand);
      if (statCashInHandTile) {
        statCashInHandTile.className = 'stat ' + (cashInHand >= 0 ? 'good' : 'exp-stat');
      }
      if (statCashInHandSub) {
        statCashInHandSub.textContent = `Cash: ${App.money(summary.cash_income || 0)} − Exp: ${App.money(summary.total_expenses || 0)}`;
      }
    }

    if (statDue) {
      const due = Number(summary.total_due || 0);
      const pendingCnt = Number(summary.pending_count || 0);
      statDue.textContent = App.money(due);
      if (statDueSub) {
        const allTime = Number(summary.all_time_due || 0);
        statDueSub.textContent = `${pendingCnt} bill${pendingCnt !== 1 ? 's' : ''} · All-time due: ${App.money(allTime)}`;
      }
      if (statDueTile) {
        statDueTile.className = 'stat ' + (due > 0 ? 'warn' : 'good');
        statDueTile.style.borderLeftColor = due > 0 ? '#dc2626' : 'var(--ok)';
        statDue.style.color = due > 0 ? '#dc2626' : '#15803d';
      }
    }

    // ── Monthly Pending Due Bills Section ──────────────────────────
    if (pendingBillRows && pendingSection) {
      const pBills = data.pendingBills || [];
      if (pendingBadge) pendingBadge.textContent = pBills.length;
      if (!pBills.length) {
        pendingBillRows.innerHTML = '<tr><td colspan="8" class="empty" style="color:#15803d;padding:1.2rem">✓ All bills fully paid for this month! (اس مہینے کا کوئی بقایا نہیں ہے)</td></tr>';
      } else {
        pendingBillRows.innerHTML = pBills.map((b) => {
          const cust = App.esc(b.customer_name || 'Walk-in');
          const phone = b.customer_phone ? `<br><a href="tel:${App.esc(b.customer_phone)}" class="small muted" style="text-decoration:none">${App.esc(b.customer_phone)}</a>` : '';
          const veh = b.vehicle_reg_no ? `<span class="badge" style="background:#e0e7ff;color:#3730a3">${App.esc(b.vehicle_reg_no)}</span>` : '<span class="muted">—</span>';
          const bal = Number(b.balance_due) || 0;
          const grand = Number(b.grand_total) || 0;
          const paid = b.advance_paid !== null ? Number(b.advance_paid) : Math.max(0, grand - bal);
          return `
            <tr>
              <td><a href="#" data-view-bill="${b.id}" style="font-weight:700">#${App.esc(b.bill_number)}</a></td>
              <td class="nowrap small">${App.dateTime(b.created_at)}</td>
              <td><b>${cust}</b>${phone}</td>
              <td>${veh}</td>
              <td class="num"><b>${App.money(grand)}</b></td>
              <td class="num" style="color:#15803d">${App.money(paid)}</td>
              <td class="num" style="color:#dc2626;font-size:1.05rem"><b>${App.money(bal)}</b></td>
              <td class="actions">
                <button type="button" class="btn btn-sm btn-success" data-pay-bill="${b.id}" style="font-weight:700">
                  💰 Pay / Clear
                </button>
              </td>
            </tr>
          `;
        }).join('');

        pendingBillRows.querySelectorAll('[data-pay-bill]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const billId = Number(btn.dataset.payBill);
            const bill = pBills.find((x) => x.id === billId);
            if (bill) {
              App.openPayBalanceModal(bill, () => load());
            }
          });
        });

        pendingBillRows.querySelectorAll('[data-view-bill]').forEach((link) => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const billId = Number(link.dataset.viewBill);
            const bill = pBills.find((x) => x.id === billId);
            if (bill) {
              App.showBill(bill, { onClose: () => load() });
            }
          });
        });
      }
    }

    // ── Purpose breakdown ──────────────────────────────────────────
    purposeRows.innerHTML = byPurpose.length
      ? byPurpose.map((r, i) => `
          <tr>
            <td><span class="purpose-pill">${App.esc(r.purpose)}</span></td>
            <td class="num muted small">${r.count}</td>
            <td class="num"><b>${App.money(r.total)}</b></td>
          </tr>`).join('')
      : '<tr><td colspan="3" class="empty">No expenses this month.</td></tr>';

    // ── Cashier breakdown ──────────────────────────────────────────
    cashierRows.innerHTML = byCashier.length
      ? byCashier.map((r) => `
          <tr>
            <td>${App.esc(r.cashier_name)}</td>
            <td class="num muted small">${r.count}</td>
            <td class="num"><b>${App.money(r.total_expenses)}</b></td>
          </tr>`).join('')
      : '<tr><td colspan="3" class="empty">No expenses this month.</td></tr>';

    // ── Bank / Online Accounts breakdown ───────────────────────────
    if (accountRows) {
      accountRows.innerHTML = byAccount && byAccount.length
        ? byAccount.map((r) => `
            <tr>
              <td><span class="badge-account">💳 ${App.esc(r.account_name)}</span></td>
              <td class="num muted small">${r.count}</td>
              <td class="num"><b>${App.money(r.total)}</b></td>
            </tr>`).join('')
        : '<tr><td colspan="3" class="empty">No account payments this month.</td></tr>';
    }

    // ── Entries table ──────────────────────────────────────────────
    if (!append) expenseRows.innerHTML = '';
    if (!expenses.length && !append) {
      expenseRows.innerHTML = '<tr><td colspan="6" class="empty">No expense entries found.</td></tr>';
    } else {
      expenses.forEach((e, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="muted small">${App.esc(e.id)}</td>
          <td class="nowrap small">${App.dateTime(e.created_at)}</td>
          <td>${App.esc(e.cashier_name)}</td>
          <td><span class="purpose-pill">${App.esc(e.purpose)}</span></td>
          <td class="small muted">${e.notes ? App.esc(e.notes) : '<span class="muted">—</span>'}</td>
          <td class="num exp-amount"><b>${App.money(e.amount)}</b></td>`;
        expenseRows.appendChild(tr);
      });
    }

    loadMoreWrap.classList.toggle('hidden', !hasMore);
  }

  // ── Events ───────────────────────────────────────────────────────────
  applyFilter.addEventListener('click', () => {
    year  = Number(filterYear.value)  || year;
    month = Number(filterMonth.value) || month;
    load();
  });

  let searchTimer;
  searchQ.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { q = searchQ.value; load(); }, 350);
  });

  filterCashier.addEventListener('change', () => {
    cashierId = filterCashier.value;
    load();
  });

  loadMoreBtn.addEventListener('click', () => App.busy(loadMoreBtn, () => load(true)));

  // ── Initial load ─────────────────────────────────────────────────────
  load();
})();
