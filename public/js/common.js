/* Shared helpers for every logged-in page: API calls, header + bell, toasts, dialogs, restock, bill print. */
(function () {
  const App = (window.App = {});
  App.user = null;
  App.shop = { name: 'MJ AUTOS', address: '', phone: '' };

  // ---------- Basics ----------
  App.esc = (v) =>
    String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  App.money = (n) => {
    const x = Number(n) || 0;
    const frac = Math.round(x * 100) % 100 !== 0;
    return 'Rs ' + x.toLocaleString('en-PK', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
  };
  App.dateTime = (s) => new Date(s).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  App.time = (s) => new Date(s).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  App.dateLabel = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  App.statusBadge = (status) =>
    ({ ok: '<span class="badge badge-ok">OK</span>', low: '<span class="badge badge-low">Low stock</span>', out: '<span class="badge badge-out">Out of stock</span>' }[status] || '');

  App.api = async function (url, { method = 'GET', body } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'MJAutos' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (_) {
      throw new Error('Network error. Check your internet connection.');
    }
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Session expired. Please log in again.');
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  // ---------- Toasts ----------
  App.toast = function (message, type = 'info', ms = 4500) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      if (box.showPopover) box.popover = 'manual'; // top layer, so toasts show above open dialogs
      document.body.appendChild(box);
    }
    // Re-opening the popover moves it above any dialog opened since the last toast.
    if (box.showPopover) {
      if (box.matches(':popover-open')) box.hidePopover();
      box.showPopover();
    }
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  // ---------- Dialogs ----------
  // Returns the <dialog>. Content is HTML you build with App.esc() for any user data.
  App.dialog = function ({ title, body, foot = '', wide = false, onClose }) {
    const d = document.createElement('dialog');
    d.className = 'modal' + (wide ? ' wide' : '');
    d.innerHTML = `
      <div class="modal-head"><h2>${App.esc(title)}</h2><button type="button" class="modal-close" aria-label="Close">&times;</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
    document.body.appendChild(d);
    d.querySelector('.modal-close').addEventListener('click', () => d.close());
    d.addEventListener('close', () => {
      d.remove();
      if (onClose) onClose();
    });
    d.showModal();
    return d;
  };

  App.confirm = function (message, { okText = 'Yes', danger = false } = {}) {
    return new Promise((resolve) => {
      let answer = false;
      const d = App.dialog({
        title: 'Please confirm',
        body: `<p style="margin:0">${App.esc(message)}</p>`,
        foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn-primary' : 'btn-dark'}" data-yes>${App.esc(okText)}</button>`,
        onClose: () => resolve(answer),
      });
      d.querySelector('[data-no]').addEventListener('click', () => d.close());
      d.querySelector('[data-yes]').addEventListener('click', () => { answer = true; d.close(); });
      d.querySelector('[data-yes]').focus();
    });
  };

  // Disable a button while an async action runs.
  App.busy = async function (btn, fn) {
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Please wait…';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
  };

  // ---------- Header, nav, bell ----------
  const NAV = [
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard', owner: true },
    { href: '/pos', label: 'New Bill', key: 'pos' },
    { href: '/products', label: 'Products', key: 'products', owner: true },
    { href: '/stock', label: 'Stock Report', key: 'stock', owner: true },
    { href: '/bills', label: 'Bill History', key: 'bills', owner: true },
    { href: '/expenses', label: 'Monthly Records', key: 'expenses', owner: true },
    { href: '/my-expenses', label: 'My Expenses', key: 'my-expenses', cashier: true },
    { href: '/users', label: 'Users', key: 'users', owner: true },
  ];
  const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  function renderHeader(active) {
    const header = document.getElementById('appHeader');
    header.className = 'app-header';
    const links = NAV.filter((n) => {
      if (n.owner && App.user.role !== 'owner') return false;
      if (n.cashier && App.user.role !== 'cashier') return false;
      return true;
    })
      .map((n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.label}</a>`)
      .join('');
    header.innerHTML = `
      <div class="hdr-inner">
        <a class="brand" href="/"><img src="/logo.jpg" alt="MJ AUTOS" class="brand-logo"> MJ <span>AUTOS</span></a>
        <nav class="nav" id="mainNav">${links}</nav>
        <div class="hdr-right">
          <div class="bell-wrap">
            <button class="bell" id="bellBtn" aria-label="Stock alerts" aria-expanded="false">${BELL_SVG}<span class="bell-count hidden" id="bellCount">0</span></button>
            <div class="bell-panel hidden" id="bellPanel">
              <h3>Low / Out of stock</h3>
              <div class="bell-list" id="bellList"><div class="bell-empty">Loading…</div></div>
            </div>
          </div>
          <span class="who"><b>${App.esc(App.user.name)}</b> · ${App.esc(App.user.role)}</span>
          <button class="btn btn-sm btn-ghost" id="logoutBtn">Logout</button>
          <button class="nav-toggle" id="navToggle" aria-label="Menu">&#9776;</button>
        </div>
      </div>`;

    document.getElementById('navToggle').addEventListener('click', () => document.getElementById('mainNav').classList.toggle('open'));
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      try { await App.api('/api/auth/logout', { method: 'POST' }); } catch (_) { }
      location.href = '/login';
    });

    const bellBtn = document.getElementById('bellBtn');
    const panel = document.getElementById('bellPanel');
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle('hidden') === false;
      bellBtn.setAttribute('aria-expanded', String(open));
      if (open) App.refreshAlerts();
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target)) panel.classList.add('hidden');
    });
  }

  App.alerts = [];
  App.refreshAlerts = async function () {
    try {
      const { products } = await App.api('/api/products/alerts');
      App.alerts = products;
    } catch (_) {
      return;
    }
    const count = document.getElementById('bellCount');
    const list = document.getElementById('bellList');
    if (!count) return;
    count.textContent = App.alerts.length > 99 ? '99+' : String(App.alerts.length);
    count.classList.toggle('hidden', App.alerts.length === 0);
    const isOwner = App.user.role === 'owner';
    list.innerHTML = App.alerts.length
      ? App.alerts
        .map((p) => {
          const tag = isOwner ? 'button' : 'div';
          return `<${tag} class="bell-item" data-id="${p.id}" ${isOwner ? 'title="Click to restock"' : ''}>
                <span><b>${App.esc(p.name)}</b>${p.part_number ? ` <span class="muted small" style="font-family:monospace">(${App.esc(p.part_number)})</span>` : ''}<br><span class="small muted">Stock ${p.stock_qty} · Min ${p.min_stock}</span></span>
                ${App.statusBadge(p.status)}
              </${tag}>`;
        })
        .join('')
      : '<div class="bell-empty">All products are well stocked.</div>';
    if (isOwner) {
      list.querySelectorAll('button.bell-item').forEach((b) =>
        b.addEventListener('click', () => {
          document.getElementById('bellPanel').classList.add('hidden');
          App.openRestock(App.alerts.find((p) => p.id === Number(b.dataset.id)));
        })
      );
    }
  };

  // Call from every page. Resolves with the logged-in user.
  App.init = async function (activePage) {
    const me = await App.api('/api/auth/me');
    App.user = me.user;
    App.shop = me.shop;
    renderHeader(activePage);
    App.refreshAlerts();
    setInterval(App.refreshAlerts, 60000);
    return App.user;
  };

  // Pages listen for this to reload their data after stock changes.
  App.stockChanged = () => {
    App.refreshAlerts();
    document.dispatchEvent(new CustomEvent('mj:stock-changed'));
  };

  // ---------- Restock (owner) ----------
  App.openRestock = function (product) {
    if (!product) return;
    const d = App.dialog({
      title: 'Restock: ' + product.name + (product.part_number ? ` (#${product.part_number})` : ''),
      body: `
        <div class="form-error hidden"></div>
        <p class="muted" style="margin-top:0">Current stock: <b>${product.stock_qty}</b> · Minimum level: <b>${product.min_stock}</b></p>
        <form id="restockForm">
          <div class="field"><label for="rsQty">Add quantity (+)</label>
            <input id="rsQty" type="number" min="1" max="100000" step="1" required placeholder="e.g. 20"></div>
          <div class="field"><label for="rsNote">Note (optional)</label>
            <input id="rsNote" maxlength="200" placeholder="e.g. Supplier invoice #123"></div>
        </form>`,
      foot: '<button class="btn" data-cancel>Cancel</button><button class="btn btn-success" data-save>Add stock</button>',
    });
    const qty = d.querySelector('#rsQty');
    const errBox = d.querySelector('.form-error');
    qty.focus();
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    const save = async () => {
      const btn = d.querySelector('[data-save]');
      errBox.classList.add('hidden');
      await App.busy(btn, async () => {
        try {
          const { product: p } = await App.api(`/api/products/${product.id}/restock`, {
            method: 'POST',
            body: { quantity: qty.value, note: d.querySelector('#rsNote').value },
          });
          d.close();
          App.toast(`${p.name}: stock is now ${p.stock_qty}`, 'success');
          App.stockChanged();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      });
    };
    d.querySelector('[data-save]').addEventListener('click', save);
    d.querySelector('#restockForm').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  };

  // Add (product = null) or edit a product. opts.name pre-fills the name; opts.onSaved(product) runs after saving.
  App.openProductForm = function (product, opts = {}) {
    const p = product || { name: opts.name || '', part_number: opts.part_number || '', price: '', stock_qty: 0, min_stock: 5 };
    const d = App.dialog({
      title: product ? 'Edit product' : 'Add product',
      body: `
        <div class="form-error hidden"></div>
        <form id="productForm" novalidate>
          <div class="row">
            <div class="field" style="flex:2"><label for="pName">Product name</label><input id="pName" maxlength="150" required value="${App.esc(p.name)}"></div>
            <div class="field" style="flex:1"><label for="pPartNo">Part number (optional)</label><input id="pPartNo" maxlength="100" placeholder="e.g. 90915-YZZE1" value="${App.esc(p.part_number || '')}"></div>
          </div>
          <div class="row">
            <div class="field"><label for="pPrice">Price (Rs)</label><input id="pPrice" type="number" min="0" step="0.01" required value="${App.esc(p.price)}"></div>
            <div class="field"><label for="pStock">Current stock</label><input id="pStock" type="number" min="0" step="1" required value="${App.esc(p.stock_qty)}"></div>
            <div class="field"><label for="pMin">Minimum stock (alert level)</label><input id="pMin" type="number" min="0" step="1" required value="${App.esc(p.min_stock)}"></div>
          </div>
          ${product ? '<div class="small muted">Changing “Current stock” here is saved as a stock adjustment. Use “+ Stock” for new deliveries.</div>' : ''}
        </form>`,
      foot: '<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    const errBox = d.querySelector('.form-error');
    d.querySelector(opts.name ? '#pPrice' : '#pName').focus();
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    const save = () =>
      App.busy(d.querySelector('[data-save]'), async () => {
        errBox.classList.add('hidden');
        const body = {
          name: d.querySelector('#pName').value,
          part_number: d.querySelector('#pPartNo').value,
          price: d.querySelector('#pPrice').value,
          stock_qty: d.querySelector('#pStock').value,
          min_stock: d.querySelector('#pMin').value,
        };
        try {
          const { product: saved } = await App.api(product ? `/api/products/${product.id}` : '/api/products', { method: product ? 'PUT' : 'POST', body });
          d.close();
          App.toast(product ? 'Product updated' : 'Product added', 'success');
          App.stockChanged();
          if (opts.onSaved) opts.onSaved(saved);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      });
    d.querySelector('[data-save]').addEventListener('click', save);
    d.querySelector('#productForm').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  };

  // ---------- Bill view + print ----------
  App.billHtml = function (bill) {
    const shop = App.shop;
    const rows = bill.items
      .map(
        (it, i) => `<tr>
          <td>${i + 1}. <b>${App.esc(it.item_name)}</b>${it.part_number ? `<br><small class="muted" style="font-family:monospace;font-size:0.8rem">Part: ${App.esc(it.part_number)}</small>` : ''}</td>
          <td class="n">${App.money(it.price)}</td>
          <td class="n">${it.quantity}</td>
          <td class="n">${App.money(it.line_total)}</td>
        </tr>`
      )
      .join('');
    return `
      <div class="bill-paper">
        <div class="bill-head">
          <div class="bill-header-row">
            <img src="/logo.jpg" alt="MJ AUTOS" class="bill-logo">
            <div class="bill-header-info">
              <p class="shop">${App.esc(shop.name || 'MJ AUTOS')}</p>
              <div class="sub">Auto Parts &amp; Repairing</div>
              ${shop.address ? `<div class="sub address">${App.esc(shop.address)}</div>` : ''}
              <div class="bill-contacts">
                <span>Hafiz Qamar: <b>03008498742</b></span>
                <span class="contact-sep">·</span>
                <span>Ch Ahsan: <b>03083412615</b></span>
              </div>
            </div>
          </div>
        </div>
        <div class="bill-meta">
          <div>Bill No: <b>#${bill.bill_number}</b></div>
          <div class="r">${App.dateTime(bill.created_at)}</div>
          <div>Customer: <b>${App.esc(bill.customer_name || 'Walk-in customer')}</b></div>
          <div class="r ${bill.customer_phone ? '' : 'meta-empty-opt'}">Phone: <b>${App.esc(bill.customer_phone || '-')}</b></div>
          <div class="${bill.vehicle_reg_no ? '' : 'meta-empty-opt'}">Reg No: <b>${App.esc(bill.vehicle_reg_no || '-')}</b></div>
          <div class="r">Cashier: ${App.esc(bill.cashier_name || '-')}</div>
          <div class="${bill.current_mileage ? '' : 'meta-empty-opt'}">Current Mileage: <b>${App.esc(bill.current_mileage || '-')}</b></div>
          <div class="r ${bill.next_mileage ? '' : 'meta-empty-opt'}">Next Mileage: <b>${App.esc(bill.next_mileage || '-')}</b></div>
          <div>Payment: <b>${bill.payment_method === 'account' ? '💳 ' + App.esc(bill.payment_account || 'Account') : '💵 Cash'}</b></div>
          <div class="r">Status: <b>${(bill.advance_paid !== null && bill.advance_paid !== undefined && Number(bill.balance_due) > 0)
            ? `<span style="color:#b91c1c;font-weight:700">⚠️ Pending: ${App.money(bill.balance_due)}</span>`
            : '<span style="color:#15803d;font-weight:700">✓ All Paid (مکمل ادا)</span>'}</b></div>
        </div>
        <table class="bill-table">
          <thead><tr><th>Item</th><th class="n">Price</th><th class="n">Qty</th><th class="n">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="bill-totals">
          <div class="line"><span>Subtotal</span><span>${App.money(bill.subtotal)}</span></div>
          ${Number(bill.discount) > 0 ? `<div class="line"><span>Discount</span><span>- ${App.money(bill.discount)}</span></div>` : ''}
          <div class="line grand-line"><span>GRAND TOTAL</span><span>${App.money(bill.grand_total)}</span></div>
          ${(bill.advance_paid !== null && bill.advance_paid !== undefined) ? `
          <div class="line bill-adv-line" style="font-weight:600;padding-top:4px">
            <span>Amount Paid (ادا شدہ رقم)</span>
            <span style="color:#15803d">${App.money(bill.advance_paid)}</span>
          </div>
          <div class="line bill-bal-line" style="font-weight:700;font-size:1.05em;border-top:1px dashed #000;margin-top:4px;padding-top:4px;color:${Number(bill.balance_due) > 0 ? '#b91c1c' : '#15803d'}">
            <span>${Number(bill.balance_due) > 0 ? 'Remaining Balance (بقایا رقم)' : 'Payment Status'}</span>
            <span>${Number(bill.balance_due) > 0 ? `⚠️ ${App.money(bill.balance_due)}` : '✓ ALL PAID (مکمل ادا شدہ)'}</span>
          </div>` : `
          <div class="line bill-adv-line" style="font-weight:600;padding-top:4px">
            <span>Amount Paid (ادا شدہ رقم)</span>
            <span style="color:#15803d">${App.money(bill.grand_total)}</span>
          </div>
          <div class="line bill-bal-line" style="font-weight:700;font-size:1.05em;border-top:1px dashed #000;margin-top:4px;padding-top:4px;color:#15803d">
            <span>Payment Status</span>
            <span>✓ ALL PAID (مکمل ادا شدہ)</span>
          </div>`}
        </div>
        <div class="bill-thanks">Thank you for shopping at MJ AUTOS!<small>Please visit again.</small></div>
      </div>`;
  };

  App.printBill = function (bill, size) {
    localStorage.setItem('mj_print_size', size);
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = App.billHtml(bill);
    document.body.classList.toggle('print-80', size === '80mm');

    let pageCss;
    if (size === '80mm') {
      // Measure the receipt at 72mm width so the "page" is exactly as long as the bill.
      Object.assign(area.style, { display: 'block', position: 'absolute', left: '-10000px', top: '0' });
      const paper = area.querySelector('.bill-paper');
      Object.assign(paper.style, { width: '72mm', fontSize: '11px' });
      const heightMm = Math.ceil((paper.offsetHeight * 25.4) / 96) + 12;
      area.removeAttribute('style');
      paper.removeAttribute('style');
      pageCss = `@page { size: 80mm ${heightMm}mm; margin: 4mm 4mm; }`;
    } else {
      pageCss = '@page { size: A4; margin: 15mm; }';
    }
    let style = document.getElementById('pageSizeStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pageSizeStyle';
      document.head.appendChild(style);
    }
    style.textContent = pageCss;
    window.print();
  };

  App.showBill = function (bill, { onClose, title } = {}) {
    const last = localStorage.getItem('mj_print_size') || '80mm';
    const isOwner = App.user && App.user.role === 'owner';
    const hasPendingBalance = bill.balance_due !== null && bill.balance_due !== undefined && Number(bill.balance_due) > 0;
    const d = App.dialog({
      title: title || `Bill #${bill.bill_number}`,
      wide: true,
      body: App.billHtml(bill),
      foot: `
        ${hasPendingBalance ? `<button type="button" class="btn btn-primary" data-pay-bill style="background:#15803d;border-color:#15803d;margin-right:auto;font-weight:600">💰 Receive Payment / All Paid (بقایا وصول کریں)</button>` : ''}
        ${isOwner ? `<button type="button" class="btn ${hasPendingBalance ? '' : 'btn-primary'}" data-edit-bill ${hasPendingBalance ? '' : 'style="margin-right:auto"'}>✏️ Edit Bill</button>` : ''}
        <button class="btn ${last === 'A4' ? 'btn-primary' : 'btn-dark'}" data-print="A4">Print A4</button>
        <button class="btn ${last === '80mm' ? 'btn-primary' : 'btn-dark'}" data-print="80mm">Print Receipt (80mm)</button>
        <button class="btn" data-close>Close</button>`,
      onClose,
    });
    const payBtn = d.querySelector('[data-pay-bill]');
    if (payBtn) {
      payBtn.addEventListener('click', () => {
        d.close();
        App.openPayBalanceModal(bill, (updated) => App.showBill(updated, { onClose }));
      });
    }
    if (isOwner) {
      const editBtn = d.querySelector('[data-edit-bill]');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          d.close();
          App.openEditBill(bill, (updated) => App.showBill(updated, { onClose }));
        });
      }
    }
    d.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => App.printBill(bill, b.dataset.print)));
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.querySelector(`[data-print="${last}"]`).focus();
    return d;
  };

  // ---------- Receive Payment / Clear Balance Modal ----------
  App.openPayBalanceModal = function (bill, onSaved) {
    if (!bill) return;
    const grandTotal = Number(bill.grand_total) || 0;
    const balanceDue = bill.balance_due !== null && bill.balance_due !== undefined ? Number(bill.balance_due) : 0;
    const alreadyPaid = bill.advance_paid !== null && bill.advance_paid !== undefined
      ? Number(bill.advance_paid)
      : (bill.balance_due !== null ? Math.max(0, grandTotal - balanceDue) : grandTotal);

    if (balanceDue <= 0) {
      App.toast('This bill is already fully paid! (پہلے ہی تمام ادا شدہ ہے)', 'info');
      return;
    }

    const d = App.dialog({
      title: `💰 Receive Payment · Bill #${bill.bill_number}`,
      body: `
        <div class="form-error hidden" id="payModalErr"></div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.95rem">
            <span class="muted">Customer:</span>
            <b>${App.esc(bill.customer_name || 'Walk-in customer')}${bill.vehicle_reg_no ? ` <span class="badge" style="background:#e0e7ff;color:#3730a3">${App.esc(bill.vehicle_reg_no)}</span>` : ''}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="muted">Grand Total (کل بل):</span>
            <b>${App.money(grandTotal)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#15803d">
            <span>Already Paid (ادا شدہ):</span>
            <b>${App.money(alreadyPaid)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;color:#b91c1c;font-size:1.15rem;font-weight:800">
            <span>Remaining Balance (بقایا):</span>
            <span>${App.money(balanceDue)}</span>
          </div>
        </div>

        <div class="field">
          <label for="payNowInput" style="font-weight:700">Amount to Receive (وصول ہونے والی رقم)</label>
          <div style="display:flex;gap:6px">
            <input type="number" id="payNowInput" min="0.01" max="${balanceDue}" step="any" value="${balanceDue}" style="font-size:1.1rem;font-weight:700;flex:1">
            <button type="button" class="btn btn-primary" id="btnPayFullNow" style="white-space:nowrap;font-size:0.85rem">
              ✓ Full (All Paid)
            </button>
          </div>
          <div class="small muted" style="margin-top:4px">Enter payment amount. Click <b>Full (All Paid)</b> to clear all remaining balance.</div>
        </div>

        <div class="field" style="margin-top:12px">
          <label style="font-weight:600">Payment Method (ادائیگی کا طریقہ)</label>
          <div style="display:flex;gap:8px;margin-top:4px">
            <label class="pay-option active-cash" id="lblPayNowCash" style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;margin:0;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer">
              <input type="radio" name="payNowMethod" value="cash" checked> 💵 Cash
            </label>
            <label class="pay-option" id="lblPayNowAccount" style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;margin:0;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer">
              <input type="radio" name="payNowMethod" value="account"> 💳 Account / Online
            </label>
          </div>
        </div>

        <div class="field hidden" id="payNowAccountWrap" style="margin-top:8px">
          <label for="payNowAccountInput" style="font-size:0.8rem;color:var(--muted)">Account / Bank Name</label>
          <input id="payNowAccountInput" placeholder="e.g. JazzCash, EasyPaisa, Meezan Bank" maxlength="100">
          <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
            <button type="button" class="quick-acc-btn" data-acc="JazzCash">JazzCash</button>
            <button type="button" class="quick-acc-btn" data-acc="EasyPaisa">EasyPaisa</button>
            <button type="button" class="quick-acc-btn" data-acc="Meezan Bank">Meezan Bank</button>
            <button type="button" class="quick-acc-btn" data-acc="Bank Transfer">Bank Transfer</button>
          </div>
        </div>
      `,
      foot: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-confirm-pay style="font-weight:700">💰 Confirm Payment (وصول کریں)</button>
      `,
    });

    const errBox = d.querySelector('#payModalErr');
    const inputAmount = d.querySelector('#payNowInput');
    const btnFull = d.querySelector('#btnPayFullNow');
    const radCash = d.querySelector('input[name="payNowMethod"][value="cash"]');
    const radAcc = d.querySelector('input[name="payNowMethod"][value="account"]');
    const lblCash = d.querySelector('#lblPayNowCash');
    const lblAcc = d.querySelector('#lblPayNowAccount');
    const accWrap = d.querySelector('#payNowAccountWrap');
    const accInput = d.querySelector('#payNowAccountInput');

    btnFull.addEventListener('click', () => {
      inputAmount.value = balanceDue;
      inputAmount.focus();
    });

    const setMethod = (isCash) => {
      radCash.checked = isCash;
      radAcc.checked = !isCash;
      lblCash.classList.toggle('active-cash', isCash);
      lblAcc.classList.toggle('active-account', !isCash);
      accWrap.classList.toggle('hidden', isCash);
      if (!isCash) setTimeout(() => accInput.focus(), 50);
    };

    radCash.addEventListener('change', () => setMethod(true));
    radAcc.addEventListener('change', () => setMethod(false));
    lblCash.addEventListener('click', () => setMethod(true));
    lblAcc.addEventListener('click', () => setMethod(false));

    d.querySelectorAll('.quick-acc-btn').forEach((b) => {
      b.addEventListener('click', () => {
        accInput.value = b.dataset.acc;
        accInput.focus();
      });
    });

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());

    const submitPayment = async () => {
      errBox.classList.add('hidden');
      const amt = Number(inputAmount.value);
      if (!Number.isFinite(amt) || amt <= 0) {
        errBox.textContent = 'Please enter a valid amount greater than 0.';
        errBox.classList.remove('hidden');
        return;
      }
      if (amt > balanceDue) {
        errBox.textContent = `Amount cannot exceed remaining balance (${App.money(balanceDue)}).`;
        errBox.classList.remove('hidden');
        return;
      }
      const isAccount = radAcc.checked;
      const paymentAccount = isAccount ? accInput.value.trim() : null;
      if (isAccount && !paymentAccount) {
        errBox.textContent = 'Please specify the account name (e.g. JazzCash, Bank).';
        errBox.classList.remove('hidden');
        return;
      }

      const markAllPaid = Math.abs(amt - balanceDue) < 0.001;

      await App.busy(d.querySelector('[data-confirm-pay]'), async () => {
        try {
          const res = await App.api(`/api/bills/${bill.id}/pay`, {
            method: 'POST',
            body: {
              amount: amt,
              mark_all_paid: markAllPaid,
              payment_method: isAccount ? 'account' : 'cash',
              payment_account: paymentAccount,
            },
          });
          d.close();
          App.toast(res.message || 'Payment recorded successfully', 'success');
          if (onSaved) onSaved(res.bill);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      });
    };

    d.querySelector('[data-confirm-pay]').addEventListener('click', submitPayment);
    inputAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPayment(); } });
    setTimeout(() => inputAmount.focus(), 80);
    return d;
  };

  // ---------- Edit Bill (owner) ----------
  App.openEditBill = async function (bill, onSaved) {
    if (!bill) return;

    let productsList = [];
    try {
      const res = await App.api('/api/products');
      productsList = res.products || [];
    } catch (_) { }

    let editItems = (bill.items || []).map((it, idx) => ({
      key: 'item_' + Date.now() + '_' + idx,
      product_id: it.product_id || null,
      name: it.item_name || it.name || 'Item',
      part_number: it.part_number || '',
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
    }));

    let curCustomer = bill.customer_name || '';
    let curCustomerPhone = bill.customer_phone || '';
    let curVehicleReg = bill.vehicle_reg_no || '';
    let curCurrentMileage = bill.current_mileage || '';
    let curNextMileage = bill.next_mileage || '';
    let curPaymentMethod = bill.payment_method || 'cash';
    let curPaymentAccount = bill.payment_account || '';
    let curDiscountType = 'amount';
    let curDiscountValue = Number(bill.discount) || 0;
    let curAdvancePaid = (bill.advance_paid !== null && bill.advance_paid !== undefined) ? bill.advance_paid : '';

    const renderItemsHtml = () => {
      if (!editItems.length) {
        return '<tr><td colspan="5" class="empty">No items on this bill. Add an item below.</td></tr>';
      }
      return editItems.map((it) => {
        const lineTotal = (Math.round(it.price * 100) * it.quantity) / 100;
        return `
          <tr data-key="${it.key}">
            <td>
              <b>${App.esc(it.name)}</b>
              ${it.part_number ? ` <span class="muted small" style="font-family:monospace">(${App.esc(it.part_number)})</span>` : ''}
              ${!it.product_id ? ' <span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:.7rem">Manual</span>' : ''}
            </td>
            <td style="width:110px">
              <input type="number" min="0" step="any" class="edit-price-input" data-price-key="${it.key}" value="${it.price}">
            </td>
            <td style="width:130px">
              <div class="edit-qty-group">
                <button type="button" class="edit-qty-btn" data-qty-dec="${it.key}">−</button>
                <input type="number" min="1" max="100000" class="edit-qty-input" data-qty-key="${it.key}" value="${it.quantity}">
                <button type="button" class="edit-qty-btn" data-qty-inc="${it.key}">+</button>
              </div>
            </td>
            <td class="num nowrap" data-total-key="${it.key}">
              <b>${App.money(lineTotal)}</b>
            </td>
            <td class="actions" style="width:40px">
              <button type="button" class="btn btn-sm btn-danger" data-remove-key="${it.key}" title="Remove item" style="padding:0 7px;font-size:1rem;line-height:24px">&times;</button>
            </td>
          </tr>
        `;
      }).join('');
    };

    const productOptionsHtml = productsList.map((p) => {
      const part = p.part_number ? ` [${p.part_number}]` : '';
      return `<option value="${p.id}" data-price="${p.price}" data-name="${App.esc(p.name)}" data-part="${App.esc(p.part_number || '')}">${App.esc(p.name)}${part} · Stock: ${p.stock_qty} · Rs. ${p.price}</option>`;
    }).join('');

    const bodyHtml = `
      <div class="form-error hidden" id="editBillError"></div>
      <div class="edit-bill-meta">
        <div>
          <b>Bill #${bill.bill_number}</b> · Cashier: <b>${App.esc(bill.cashier_name || 'Owner')}</b>
        </div>
        <div class="muted small">
          Created: ${App.time(bill.created_at)}
        </div>
      </div>

      <div class="row" style="margin-bottom:.5rem;gap:.5rem">
        <div class="field" style="flex:1">
          <label for="editCustomerName">Customer Name</label>
          <input id="editCustomerName" maxlength="100" placeholder="Walk-in customer" value="${App.esc(curCustomer)}">
        </div>
        <div class="field" style="flex:1">
          <label for="editCustomerPhone">Phone Num</label>
          <input id="editCustomerPhone" maxlength="50" placeholder="03xxxxxxxxx" value="${App.esc(curCustomerPhone)}">
        </div>
      </div>

      <div class="row" style="margin-bottom:.5rem;gap:.5rem">
        <div class="field" style="flex:1">
          <label for="editVehicleReg">Registration No</label>
          <input id="editVehicleReg" maxlength="50" placeholder="e.g. LEA-1234" style="text-transform:uppercase" value="${App.esc(curVehicleReg)}">
        </div>
        <div class="field" style="flex:1">
          <label for="editCurrentMileage">Current Mileage</label>
          <input id="editCurrentMileage" maxlength="50" placeholder="e.g. 45,000 km" value="${App.esc(curCurrentMileage)}">
        </div>
        <div class="field" style="flex:1">
          <label for="editNextMileage">Next Mileage</label>
          <input id="editNextMileage" maxlength="50" placeholder="e.g. 50,000 km" value="${App.esc(curNextMileage)}">
        </div>
      </div>

      <div class="row" style="margin-bottom:.5rem">
        <div class="field" style="flex:1">
          <label>Payment Method</label>
          <div style="display:flex;gap:.5rem;margin-top:.2rem">
            <label class="pay-option ${curPaymentMethod === 'cash' ? 'active-cash' : ''}" style="flex:1;display:flex;align-items:center;gap:.35rem;padding:.45rem .6rem;margin:0;border:1px solid #cfd4dd;border-radius:8px;cursor:pointer">
              <input type="radio" name="editPayMethod" value="cash" ${curPaymentMethod === 'cash' ? 'checked' : ''}> Cash
            </label>
            <label class="pay-option ${curPaymentMethod === 'account' ? 'active-account' : ''}" style="flex:1;display:flex;align-items:center;gap:.35rem;padding:.45rem .6rem;margin:0;border:1px solid #cfd4dd;border-radius:8px;cursor:pointer">
              <input type="radio" name="editPayMethod" value="account" ${curPaymentMethod === 'account' ? 'checked' : ''}> Account
            </label>
          </div>
        </div>
      </div>

      <div class="field ${curPaymentMethod === 'account' ? '' : 'hidden'}" id="editAccountWrap" style="margin-bottom:.75rem">
        <label for="editPaymentAccount">Account / Bank / Wallet Name</label>
        <input id="editPaymentAccount" maxlength="100" placeholder="e.g. JazzCash, EasyPaisa, HBL" value="${App.esc(curPaymentAccount)}">
        <div style="display:flex;gap:.35rem;margin-top:.35rem;flex-wrap:wrap">
          <button type="button" class="quick-acc-btn" data-acc="JazzCash">JazzCash</button>
          <button type="button" class="quick-acc-btn" data-acc="EasyPaisa">EasyPaisa</button>
          <button type="button" class="quick-acc-btn" data-acc="HBL">HBL</button>
          <button type="button" class="quick-acc-btn" data-acc="Meezan Bank">Meezan Bank</button>
        </div>
      </div>

      <div style="background:#f8fafc;padding:.65rem;border-radius:var(--radius);border:1px solid var(--line);margin:.6rem 0">
        <div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:2;min-width:180px">
            <label for="editProductSelect" style="margin-bottom:.2rem">Add Product from Catalog</label>
            <select id="editProductSelect">
              <option value="">-- Choose a product to add --</option>
              ${productOptionsHtml}
            </select>
          </div>
          <button type="button" class="btn btn-dark" id="editAddProductBtn">+ Add Product</button>
          <button type="button" class="btn" id="editAddManualBtn">+ Manual Item</button>
        </div>
      </div>

      <div class="table-wrap" style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px">
        <table class="edit-items-table">
          <thead>
            <tr>
              <th>Item / Part #</th>
              <th>Price (Rs.)</th>
              <th>Quantity</th>
              <th class="num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="editItemsTbody">
            ${renderItemsHtml()}
          </tbody>
        </table>
      </div>

      <div class="row" style="margin-top:.8rem;align-items:flex-start">
        <div class="field" style="flex:1">
          <label>Discount</label>
          <div class="discount-row">
            <select id="editDiscountType" style="width:85px">
              <option value="amount" ${curDiscountType === 'amount' ? 'selected' : ''}>Rs.</option>
              <option value="percent" ${curDiscountType === 'percent' ? 'selected' : ''}>%</option>
            </select>
            <input type="number" id="editDiscountVal" min="0" step="any" placeholder="0" value="${curDiscountValue}">
          </div>
        </div>

        <div class="field" style="flex:1">
          <label for="editAdvanceVal">Advance Paid</label>
          <input type="number" id="editAdvanceVal" min="0" step="any" placeholder="Leave empty for full payment" value="${curAdvancePaid}">
          <div class="small muted" style="margin-top:2px">Customer advance / payment amount</div>
        </div>

        <div style="flex:1;min-width:200px">
          <div class="edit-totals-card">
            <div class="edit-totals-row">
              <span class="muted">Subtotal:</span>
              <span id="editSubtotalDisplay">…</span>
            </div>
            <div class="edit-totals-row">
              <span class="muted">Discount:</span>
              <span id="editDiscountDisplay" style="color:var(--brand)">…</span>
            </div>
            <div class="edit-totals-row grand">
              <span>Grand Total:</span>
              <span id="editGrandDisplay">…</span>
            </div>
            <div class="edit-totals-row" id="editAdvRow" style="display:none;margin-top:.3rem;padding-top:.3rem;border-top:1px dashed var(--line)">
              <span class="muted">Advance Paid:</span>
              <span id="editAdvanceDisplay" style="font-weight:600">…</span>
            </div>
            <div class="edit-totals-row" id="editBalRow" style="display:none;font-weight:700">
              <span>Remaining Balance:</span>
              <span id="editBalanceDisplay" style="color:#dc2626">…</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const footHtml = `
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="button" class="btn btn-primary" data-save-bill>Save Changes</button>
    `;

    const d = App.dialog({
      title: `Edit Bill #${bill.bill_number}`,
      wide: true,
      body: bodyHtml,
      foot: footHtml,
    });

    const tbody = d.querySelector('#editItemsTbody');
    const errBox = d.querySelector('#editBillError');

    const calcTotals = () => {
      const subtotal = editItems.reduce((s, it) => s + (Math.round(it.price * 100) * it.quantity), 0) / 100;
      const dVal = Math.max(0, Number(d.querySelector('#editDiscountVal').value) || 0);
      const dType = d.querySelector('#editDiscountType').value;
      let discount = dType === 'percent' ? Math.round((subtotal * Math.min(dVal, 100)) / 100) : dVal;
      discount = Math.min(discount, subtotal);
      const grand = Math.max(0, subtotal - discount);

      const advStr = d.querySelector('#editAdvanceVal').value.trim();
      const hasAdvance = advStr !== '';
      let advance = hasAdvance ? Math.max(0, Number(advStr) || 0) : null;
      let balance = null;
      if (hasAdvance) {
        if (advance > grand) advance = grand;
        balance = Math.max(0, Math.round((grand - advance) * 100) / 100);
      }
      return { subtotal, discount, grand, hasAdvance, advance, balance };
    };

    const updateTotalsUi = () => {
      const t = calcTotals();
      d.querySelector('#editSubtotalDisplay').textContent = App.money(t.subtotal);
      d.querySelector('#editDiscountDisplay').textContent = '- ' + App.money(t.discount);
      d.querySelector('#editGrandDisplay').textContent = App.money(t.grand);

      const advRow = d.querySelector('#editAdvRow');
      const balRow = d.querySelector('#editBalRow');
      if (t.hasAdvance) {
        advRow.style.display = 'flex';
        balRow.style.display = 'flex';
        d.querySelector('#editAdvanceDisplay').textContent = App.money(t.advance);
        d.querySelector('#editBalanceDisplay').textContent = App.money(t.balance);
        d.querySelector('#editBalanceDisplay').style.color = t.balance > 0 ? '#dc2626' : '#15803d';
      } else {
        advRow.style.display = 'none';
        balRow.style.display = 'none';
      }
    };

    const rerenderItems = () => {
      tbody.innerHTML = renderItemsHtml();
      updateTotalsUi();
    };

    updateTotalsUi();

    d.querySelectorAll('input[name="editPayMethod"]').forEach((r) => {
      r.addEventListener('change', () => {
        const isAccount = r.value === 'account';
        d.querySelector('#editAccountWrap').classList.toggle('hidden', !isAccount);
        d.querySelectorAll('.pay-option').forEach((el) => {
          el.classList.remove('active-cash', 'active-account');
        });
        if (isAccount) r.closest('.pay-option').classList.add('active-account');
        else r.closest('.pay-option').classList.add('active-cash');
      });
    });

    d.querySelectorAll('.quick-acc-btn').forEach((b) => {
      b.addEventListener('click', () => {
        d.querySelector('#editPaymentAccount').value = b.dataset.acc;
      });
    });

    d.querySelector('#editAddProductBtn').addEventListener('click', () => {
      const select = d.querySelector('#editProductSelect');
      const opt = select.selectedOptions[0];
      if (!opt || !opt.value) return App.toast('Please choose a product from the list', 'warn');
      const productId = Number(opt.value);
      const existing = editItems.find((x) => x.product_id === productId);
      if (existing) {
        existing.quantity += 1;
      } else {
        editItems.push({
          key: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2),
          product_id: productId,
          name: opt.dataset.name,
          part_number: opt.dataset.part || '',
          price: Number(opt.dataset.price) || 0,
          quantity: 1,
        });
      }
      select.value = '';
      rerenderItems();
    });

    d.querySelector('#editAddManualBtn').addEventListener('click', () => {
      const mName = prompt('Enter manual item name:');
      if (!mName || !mName.trim()) return;
      const mPriceStr = prompt('Enter unit price (Rs.):', '0');
      if (mPriceStr === null) return;
      const mPrice = Math.max(0, Number(mPriceStr) || 0);
      editItems.push({
        key: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        product_id: null,
        name: mName.trim(),
        part_number: '',
        price: mPrice,
        quantity: 1,
      });
      rerenderItems();
    });

    tbody.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-qty-inc]');
      if (inc) {
        const item = editItems.find((x) => x.key === inc.dataset.qtyInc);
        if (item) { item.quantity += 1; rerenderItems(); }
        return;
      }
      const dec = e.target.closest('[data-qty-dec]');
      if (dec) {
        const item = editItems.find((x) => x.key === dec.dataset.qtyDec);
        if (item) {
          if (item.quantity > 1) {
            item.quantity -= 1;
            rerenderItems();
          } else {
            if (confirm(`Remove “${item.name}” from bill?`)) {
              editItems = editItems.filter((x) => x.key !== item.key);
              rerenderItems();
            }
          }
        }
        return;
      }
      const rem = e.target.closest('[data-remove-key]');
      if (rem) {
        const item = editItems.find((x) => x.key === rem.dataset.removeKey);
        if (item) {
          editItems = editItems.filter((x) => x.key !== item.key);
          rerenderItems();
        }
      }
    });

    tbody.addEventListener('input', (e) => {
      const pInput = e.target.closest('[data-price-key]');
      if (pInput) {
        const item = editItems.find((x) => x.key === pInput.dataset.priceKey);
        if (item) {
          item.price = Math.max(0, Number(pInput.value) || 0);
          const lineTotal = (Math.round(item.price * 100) * item.quantity) / 100;
          const totCell = tbody.querySelector(`[data-total-key="${item.key}"]`);
          if (totCell) totCell.innerHTML = `<b>${App.money(lineTotal)}</b>`;
          updateTotalsUi();
        }
        return;
      }
      const qInput = e.target.closest('[data-qty-key]');
      if (qInput) {
        const item = editItems.find((x) => x.key === qInput.dataset.qtyKey);
        if (item) {
          item.quantity = Math.max(1, Math.floor(Number(qInput.value) || 1));
          const lineTotal = (Math.round(item.price * 100) * item.quantity) / 100;
          const totCell = tbody.querySelector(`[data-total-key="${item.key}"]`);
          if (totCell) totCell.innerHTML = `<b>${App.money(lineTotal)}</b>`;
          updateTotalsUi();
        }
      }
    });

    d.querySelector('#editDiscountType').addEventListener('change', updateTotalsUi);
    d.querySelector('#editDiscountVal').addEventListener('input', updateTotalsUi);
    d.querySelector('#editAdvanceVal').addEventListener('input', updateTotalsUi);

    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());

    d.querySelector('[data-save-bill]').addEventListener('click', async () => {
      errBox.classList.add('hidden');
      if (!editItems.length) {
        errBox.textContent = 'Bill must have at least one item.';
        errBox.classList.remove('hidden');
        return;
      }

      const payMethod = d.querySelector('input[name="editPayMethod"]:checked')?.value || 'cash';
      const payAccount = d.querySelector('#editPaymentAccount')?.value.trim() || '';
      if (payMethod === 'account' && !payAccount) {
        errBox.textContent = 'Please enter Account / Bank name for Account payment.';
        errBox.classList.remove('hidden');
        d.querySelector('#editPaymentAccount').focus();
        return;
      }

      const customerName = d.querySelector('#editCustomerName').value.trim();
      const discountType = d.querySelector('#editDiscountType').value;
      const discountValue = Math.max(0, Number(d.querySelector('#editDiscountVal').value) || 0);
      const advStr = d.querySelector('#editAdvanceVal').value.trim();
      const advancePaid = advStr !== '' ? Math.max(0, Number(advStr) || 0) : null;
      const t = calcTotals();
      if (advancePaid !== null && advancePaid > t.grand) {
        errBox.textContent = `Advance amount (${App.money(advancePaid)}) cannot be greater than Grand Total (${App.money(t.grand)}).`;
        errBox.classList.remove('hidden');
        return;
      }

      const payload = {
        customer_name: customerName,
        customer_phone: d.querySelector('#editCustomerPhone') ? d.querySelector('#editCustomerPhone').value.trim() : null,
        vehicle_reg_no: d.querySelector('#editVehicleReg') ? d.querySelector('#editVehicleReg').value.trim() : null,
        current_mileage: d.querySelector('#editCurrentMileage') ? d.querySelector('#editCurrentMileage').value.trim() : null,
        next_mileage: d.querySelector('#editNextMileage') ? d.querySelector('#editNextMileage').value.trim() : null,
        payment_method: payMethod,
        payment_account: payMethod === 'account' ? payAccount : null,
        discount_type: discountType,
        discount_value: discountValue,
        advance_paid: advancePaid,
        items: editItems.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          part_number: it.part_number || null,
          price: it.price,
          quantity: it.quantity,
        })),
      };

      const btn = d.querySelector('[data-save-bill]');
      await App.busy(btn, async () => {
        try {
          const res = await App.api('/api/bills/' + bill.id, {
            method: 'PUT',
            body: payload,
          });
          d.close();
          App.toast(`Bill #${bill.bill_number} updated successfully`, 'success');
          App.stockChanged();
          if (onSaved) onSaved(res.bill);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
          App.toast(err.message, 'error');
        }
      });
    });
  };
  // ---------- Cart Helpers ----------
  App.CART_KEY = 'mj_cart_v1';
  App.getCartData = function () {
    try {
      const s = JSON.parse(sessionStorage.getItem(App.CART_KEY) || 'null');
      if (s && typeof s === 'object') {
        return {
          cart: Array.isArray(s.cart) ? s.cart : [],
          customer: s.customer || '',
          discount: s.discount || '',
          type: s.type || 'amount',
        };
      }
    } catch (_) { }
    return { cart: [], customer: '', discount: '', type: 'amount' };
  };

  App.saveCartData = function (data) {
    sessionStorage.setItem(App.CART_KEY, JSON.stringify(data));
  };

  App.addToCart = function (p) {
    if (!p) return false;
    if (p.stock_qty <= 0) {
      App.toast(`${p.name} is OUT OF STOCK`, 'error');
      return false;
    }
    const data = App.getCartData();
    const existing = data.cart.find((c) => c.product_id === p.id);
    const inCartQty = existing ? existing.qty : 0;
    if (inCartQty + 1 > p.stock_qty) {
      App.toast(`Only ${p.stock_qty} ${p.name} in stock`, 'warn');
      return false;
    }
    if (existing) {
      existing.qty += 1;
      existing.price = p.price;
      existing.name = p.name;
      existing.part_number = p.part_number || '';
    } else {
      data.cart.push({ key: 'p' + p.id, product_id: p.id, name: p.name, part_number: p.part_number || '', price: p.price, qty: 1 });
    }
    App.saveCartData(data);
    const totalQty = existing ? existing.qty : 1;
    App.toast(`Added “${p.name}” to cart (${totalQty} in cart)`, 'success');
    document.dispatchEvent(new CustomEvent('mj:cart-changed', { detail: { data, product: p } }));
    return true;
  };
})();
