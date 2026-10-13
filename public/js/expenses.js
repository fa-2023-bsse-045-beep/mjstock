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
