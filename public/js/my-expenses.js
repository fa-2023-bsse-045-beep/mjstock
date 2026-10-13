/* Cashier: My Expenses page (/my-expenses) */
(async function () {
  await App.init('my-expenses');

  // ── State ────────────────────────────────────────────────────────────
  const now   = new Date();
  let year    = now.getFullYear();
  let month   = now.getMonth() + 1;
  let offset  = 0;
  let hasMore = false;

  // ── DOM ──────────────────────────────────────────────────────────────
  const filterMonth   = document.getElementById('filterMonth');
  const filterYear    = document.getElementById('filterYear');
  const applyFilter   = document.getElementById('applyFilter');
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

  const expenseForm   = document.getElementById('expenseForm');
  const expAmount     = document.getElementById('expAmount');
  const expPurpose    = document.getElementById('expPurpose');
  const expNotes      = document.getElementById('expNotes');
  const submitBtn     = document.getElementById('submitBtn');
  const formError     = document.getElementById('formError');

  // ── Init pickers ─────────────────────────────────────────────────────
  filterMonth.value = month;
  filterYear.value  = year;

  // ── Fetch & render ──────────────────────────────────────────────────
  async function load(append = false) {
    if (!append) {
      offset = 0;
      expenseRows.innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
    }

    const params = new URLSearchParams({ year, month, offset });
    let data;
    try {
      data = await App.api('/api/expenses/my?' + params);
    } catch (err) {
      expenseRows.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--out)">${App.esc(err.message)}</td></tr>`;
      return;
    }

    const { expenses, summary, hasMore: more } = data;
    hasMore = more;
    offset += expenses.length;

    // ── Summary ────────────────────────────────────────────────────
    statIncome.textContent    = App.money(summary.total_income);
    statBillCount.textContent = `${summary.bill_count} bills (💵 Cash: ${App.money(summary.cash_income || 0)} · 💳 Online: ${App.money(summary.account_income || 0)})`;
    statExpenses.textContent  = App.money(summary.total_expenses);
    statExpCount.textContent  = summary.count + ' entr' + (summary.count !== 1 ? 'ies' : 'y');
    const bal = Number(summary.balance);
    statBalance.textContent   = App.money(bal);
    statBalanceTile.className = 'stat ' + (bal >= 0 ? 'good' : 'exp-stat');

    if (statCashInHand) {
      const cashInHand = Number(summary.cash_balance ?? (Number(summary.cash_income || 0) - Number(summary.total_expenses || 0)));
      statCashInHand.textContent = App.money(cashInHand);
      if (statCashInHandTile) {
        statCashInHandTile.className = 'stat ' + (cashInHand >= 0 ? 'good' : 'exp-stat');
      }
      if (statCashInHandSub) {
        statCashInHandSub.textContent = `Cash: ${App.money(summary.cash_income || 0)} − Exp: ${App.money(summary.total_expenses || 0)}`;
      }
    }

    // ── Entries table ──────────────────────────────────────────────
    if (!append) expenseRows.innerHTML = '';
    if (!expenses.length && !append) {
      expenseRows.innerHTML = '<tr><td colspan="5" class="empty">No expense entries for this month.</td></tr>';
    } else {
      expenses.forEach((e) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="muted small">${App.esc(e.id)}</td>
          <td class="nowrap small">${App.dateTime(e.created_at)}</td>
          <td><span class="purpose-pill">${App.esc(e.purpose)}</span></td>
          <td class="small muted">${e.notes ? App.esc(e.notes) : '<span class="muted">—</span>'}</td>
          <td class="num exp-amount"><b>${App.money(e.amount)}</b></td>`;
        expenseRows.appendChild(tr);
      });
    }

    loadMoreWrap.classList.toggle('hidden', !hasMore);
  }

  // ── Submit new expense ───────────────────────────────────────────────
  async function submit() {
    formError.classList.add('hidden');
    const amount  = expAmount.value.trim();
    const purpose = expPurpose.value.trim();
    const notes   = expNotes.value.trim();

    if (!amount || Number(amount) <= 0) {
      formError.textContent = 'Please enter a valid amount greater than 0.';
      formError.classList.remove('hidden');
      expAmount.focus();
      return;
    }
    if (!purpose) {
      formError.textContent = 'Purpose is required.';
      formError.classList.remove('hidden');
      expPurpose.focus();
      return;
    }

    try {
      await App.busy(submitBtn, () =>
        App.api('/api/expenses', { method: 'POST', body: { amount, purpose, notes: notes || null } })
      );
      App.toast('Expense entry added successfully.', 'success');
      expAmount.value  = '';
      expPurpose.value = '';
      expNotes.value   = '';
      // Reload current month
      year  = now.getFullYear();
      month = now.getMonth() + 1;
      filterMonth.value = month;
      filterYear.value  = year;
      load();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    }
  }

  // ── Events ───────────────────────────────────────────────────────────
  applyFilter.addEventListener('click', () => {
    year  = Number(filterYear.value)  || year;
    month = Number(filterMonth.value) || month;
    load();
  });

  expenseForm.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  loadMoreBtn.addEventListener('click',  () => App.busy(loadMoreBtn, () => load(true)));

  // ── Initial load ─────────────────────────────────────────────────────
  load();
})();
