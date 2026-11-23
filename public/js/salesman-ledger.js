/* salesman-ledger.js — Full account ledger for one salesman */
(function () {
  const params = new URLSearchParams(location.search);
  const salesmanId = Number(params.get('id'));

  async function init() {
    await App.init('salesman-payments');
    if (!salesmanId) { App.toast('No salesman ID provided', 'error'); return; }
    load();
    document.getElementById('printBtn').addEventListener('click', printLedger);
  }

  async function load() {
    try {
      const data = await App.api('/api/salesman/ledger/' + salesmanId);
      const { salesman, summary, ledger } = data;

      document.getElementById('ledgerTitle').textContent = `${salesman.name} — Account Ledger`;
      document.title = `${salesman.name} Ledger · MJ AUTOS`;

      // Summary cards
      if (document.getElementById('lTotalProducts')) document.getElementById('lTotalProducts').textContent = (summary.total_products_delivered || 0) + ' units';
      if (document.getElementById('lBillCount')) document.getElementById('lBillCount').textContent = summary.bill_count || 0;
      document.getElementById('lTotalBills').textContent = App.money(summary.total_bills || 0);
      document.getElementById('lCash').textContent       = App.money(summary.total_cash || 0);
      document.getElementById('lBank').textContent       = App.money(summary.total_bank || 0);
      document.getElementById('lPaid').textContent       = App.money(summary.total_paid || 0);
      document.getElementById('lPending').textContent    = App.money(summary.pending || 0);

      // Ledger rows
      const tbody = document.getElementById('ledgerBody');
      if (!ledger.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No transactions found for this salesman.</td></tr>';
        return;
      }

      tbody.innerHTML = ledger.map(row => {
        const isDebit  = row.debit  > 0;
        const isCredit = row.credit > 0;
        let typeBadge = '';
        if (row.type === 'bill') {
          typeBadge = `<span class="badge badge-out">Bill (Debit)</span>`;
        } else if (row.type === 'cash') {
          typeBadge = `<span class="badge badge-ok">Cash Payment</span>`;
        } else {
          typeBadge = `<span class="badge" style="background:#dbeafe;color:#1e40af">Bank Transfer</span>`;
        }

        return `
          <tr style="${isDebit ? 'background:#fffbfb' : ''}">
            <td class="nowrap">${App.dateTime(row.txn_date)}</td>
            <td>${typeBadge}</td>
            <td style="font-family:monospace;font-size:.9rem;font-weight:600">${App.esc(String(row.reference))}</td>
            <td class="small">${App.esc(row.description || '—')}</td>
            <td class="num" style="color:${isDebit?'#b91c1c':'#aaa'}">${isDebit ? App.money(row.debit) : '—'}</td>
            <td class="num" style="color:${isCredit?'#15803d':'#aaa'}">${isCredit ? App.money(row.credit) : '—'}</td>
            <td class="num" style="font-weight:700;color:${row.balance > 0 ? '#b91c1c' : '#15803d'}">${App.money(row.balance)}</td>
          </tr>`;
      }).join('');

      // Footer totals
      const totalDebit  = ledger.reduce((s, r) => s + r.debit,  0);
      const totalCredit = ledger.reduce((s, r) => s + r.credit, 0);
      const finalBal    = ledger.length ? ledger[ledger.length - 1].balance : 0;
      document.getElementById('ledgerFoot').innerHTML = `
        <tr style="font-weight:800;border-top:2px solid var(--line);background:#f8fafc">
          <td colspan="4" style="text-align:right">TOTALS:</td>
          <td class="num" style="color:#b91c1c">${App.money(totalDebit)}</td>
          <td class="num" style="color:#15803d">${App.money(totalCredit)}</td>
          <td class="num" style="font-size:1.05em;color:${finalBal > 0 ? '#b91c1c' : '#15803d'}">${App.money(finalBal)}</td>
        </tr>`;
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function printLedger() {
    const title = document.getElementById('ledgerTitle').textContent;
    const table = document.getElementById('ledgerCard').outerHTML;
    const stats = document.getElementById('ledgerStats').outerHTML;
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.innerHTML = `
      <div style="padding:10px">
        <h2 style="font-family:system-ui;margin:0 0 10px">${title}</h2>
        <div style="margin-bottom:12px;font-size:13px;color:#555">MJ AUTOS — Supplier &amp; Salesman Transaction Ledger</div>
        ${stats}
        <div style="margin-top:15px">${table}</div>
      </div>`;
    let s = document.getElementById('pageSizeStyle');
    if (!s) { s = document.createElement('style'); s.id = 'pageSizeStyle'; document.head.appendChild(s); }
    s.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    window.print();
  }

  init().catch(err => App.toast(err.message, 'error'));
})();
