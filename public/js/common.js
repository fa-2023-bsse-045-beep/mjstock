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
    { href: '/dashboard',   label: 'Dashboard',        key: 'dashboard',    owner: true  },
    { href: '/pos',         label: 'New Bill',          key: 'pos'                        },
    { href: '/products',    label: 'Products',          key: 'products',     owner: true  },
    { href: '/stock',       label: 'Stock Report',      key: 'stock',        owner: true  },
    { href: '/bills',       label: 'Bill History',      key: 'bills',        owner: true  },
    { href: '/expenses',    label: 'Monthly Records',   key: 'expenses',     owner: true  },
    { href: '/my-expenses', label: 'My Expenses',       key: 'my-expenses',  cashier: true },
    { href: '/users',       label: 'Users',             key: 'users',        owner: true  },
  ];
  const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  function renderHeader(active) {
    const header = document.getElementById('appHeader');
    header.className = 'app-header';
    const links = NAV.filter((n) => {
        if (n.owner   && App.user.role !== 'owner')   return false;
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
      try { await App.api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
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
          <img src="/logo.jpg" alt="MJ AUTOS" class="bill-logo">
          <p class="shop">${App.esc(shop.name || 'MJ AUTOS')}</p>
          <div class="sub">Auto Parts &amp; Accessories</div>
          ${shop.address ? `<div class="sub">${App.esc(shop.address)}</div>` : ''}
          <div class="bill-contacts">
            <span>Hafiz Qamar Raza: <b>03008498742</b></span>
            <span class="contact-sep">·</span>
            <span>Ch Ahsan: <b>03083412615</b></span>
          </div>
        </div>
        <div class="bill-meta">
          <div>Bill No: <b>#${bill.bill_number}</b></div>
          <div class="r">${App.dateTime(bill.created_at)}</div>
          <div>Customer: <b>${App.esc(bill.customer_name || 'Walk-in customer')}</b></div>
          <div class="r">Cashier: ${App.esc(bill.cashier_name || '-')}</div>
          <div>Payment: <b>${bill.payment_method === 'account' ? '💳 ' + App.esc(bill.payment_account || 'Account') : '💵 Cash'}</b></div>
          <div class="r"></div>
        </div>
        <table class="bill-table">
          <thead><tr><th>Item</th><th class="n">Price</th><th class="n">Qty</th><th class="n">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="bill-totals">
          <div class="line"><span>Subtotal</span><span>${App.money(bill.subtotal)}</span></div>
          ${Number(bill.discount) > 0 ? `<div class="line"><span>Discount</span><span>- ${App.money(bill.discount)}</span></div>` : ''}
          <div class="line grand-line"><span>GRAND TOTAL</span><span>${App.money(bill.grand_total)}</span></div>
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
    const d = App.dialog({
      title: title || `Bill #${bill.bill_number}`,
      wide: true,
      body: App.billHtml(bill),
      foot: `
        <button class="btn ${last === 'A4' ? 'btn-primary' : 'btn-dark'}" data-print="A4">Print A4</button>
        <button class="btn ${last === '80mm' ? 'btn-primary' : 'btn-dark'}" data-print="80mm">Print Receipt (80mm)</button>
        <button class="btn" data-close>Close</button>`,
      onClose,
    });
    d.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => App.printBill(bill, b.dataset.print)));
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.querySelector(`[data-print="${last}"]`).focus();
    return d;
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
    } catch (_) {}
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
