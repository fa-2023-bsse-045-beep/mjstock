(function () {
  const $ = (id) => document.getElementById(id);
  const CART_KEY = 'mj_cart_v1';

  let products = [];
  let byId = new Map();
  let cart = []; // { key, product_id|null, name, price, qty }
  let manualSeq = Date.now();

  const cents = (n) => Math.round(Number(n) * 100);

  // ---------- Persistence (survives an accidental page refresh) ----------
  function saveCart() {
    sessionStorage.setItem(CART_KEY, JSON.stringify({ cart, customer: $('customer').value, discount: $('discount').value, type: $('discountType').value }));
  }
  function loadCart() {
    try {
      const s = JSON.parse(sessionStorage.getItem(CART_KEY) || 'null');
      if (!s) return;
      cart = Array.isArray(s.cart) ? s.cart : [];
      $('customer').value = s.customer || '';
      $('discount').value = s.discount || '';
      $('discountType').value = s.type === 'percent' ? 'percent' : 'amount';
    } catch (_) { cart = []; }
  }

  // ---------- Products ----------
  async function loadProducts() {
    try {
      const data = await App.api('/api/products');
      products = data.products;
      byId = new Map(products.map((p) => [p.id, p]));
      // Keep cart prices/names in sync and drop products that were deleted.
      cart = cart.filter((it) => !it.product_id || byId.has(it.product_id));
      cart.forEach((it) => {
        if (it.product_id) { const p = byId.get(it.product_id); it.price = p.price; it.name = p.name; it.part_number = p.part_number || ''; }
      });
      renderProducts();
      renderCart();
    } catch (err) {
      $('productGrid').innerHTML = `<div class="form-error">${App.esc(err.message)}</div>`;
    }
  }

  function filtered() {
    const q = $('search').value.trim().toLowerCase();
    if (!q) return products;
    const words = q.split(/\s+/);
    return products.filter((p) =>
      words.every((w) => p.name.toLowerCase().includes(w) || (p.part_number && p.part_number.toLowerCase().includes(w)))
    );
  }

  function renderProducts() {
    const list = filtered();
    const grid = $('productGrid');
    const isOwner = App.user.role === 'owner';
    const q = $('search').value.trim();
    // Owner-only tile to create a product without leaving the billing screen.
    const addCard = isOwner
      ? `<button type="button" class="product-card add-card" data-add-product>
          <span class="add-plus">+</span><span class="pname">${q && !list.length ? `Add “${App.esc(q)}”` : 'Add Product'}</span>
        </button>`
      : '';
    if (!products.length) {
      grid.innerHTML = addCard + `<div class="muted">No products yet.${isOwner ? ' Click “Add Product” to create your first one.' : ''}</div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = addCard + `<div class="muted">No product matches your search.${isOwner ? ' Add it as a new product, or use' : ' Use'} “Add manual item” below.</div>`;
      return;
    }
    const inCart = new Set(cart.filter((c) => c.product_id).map((c) => c.product_id));
    grid.innerHTML = addCard + list
      .map((p) => {
        const cls = ['product-card', p.status === 'out' ? 'is-out' : '', p.status === 'low' ? 'is-low' : '', inCart.has(p.id) ? 'in-cart' : ''].join(' ');
        const badge = p.status === 'out' ? '<span class="badge badge-out">Out of stock</span>' : p.status === 'low' ? '<span class="badge badge-low">Low stock</span>' : '';
        return `<button type="button" class="${cls}" data-id="${p.id}" ${p.status === 'out' ? 'aria-disabled="true"' : ''}>
            <span class="pname">${App.esc(p.name)}</span>
            ${p.part_number ? `<span class="ppart"># ${App.esc(p.part_number)}</span>` : ''}
            <span class="pstock"><span>Stock: ${p.stock_qty}</span>${badge}</span>
            <span class="pprice">${App.money(p.price)}</span>
          </button>`;
      })
      .join('');
  }

  // ---------- Cart ----------
  function cartQtyFor(productId) {
    return cart.filter((c) => c.product_id === productId).reduce((s, c) => s + c.qty, 0);
  }

  function addProduct(p) {
    if (!p) return;
    if (p.stock_qty <= 0) return App.toast(`${p.name} is OUT OF STOCK`, 'error');
    const existing = cart.find((c) => c.product_id === p.id);
    if (cartQtyFor(p.id) + 1 > p.stock_qty) return App.toast(`Only ${p.stock_qty} ${p.name} in stock`, 'warn');
    if (existing) existing.qty += 1;
    else cart.push({ key: 'p' + p.id, product_id: p.id, name: p.name, part_number: p.part_number || '', price: p.price, qty: 1 });
    changed();
  }

  function setQty(key, qty) {
    const it = cart.find((c) => c.key === key);
    if (!it) return;
    qty = Math.floor(Number(qty));
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > 100000) qty = 100000;
    if (it.product_id) {
      const p = byId.get(it.product_id);
      if (p && qty > p.stock_qty) {
        App.toast(`Only ${p.stock_qty} ${p.name} in stock`, 'warn');
        qty = Math.max(1, p.stock_qty);
      }
    }
    it.qty = qty;
    changed();
  }

  function removeItem(key) {
    cart = cart.filter((c) => c.key !== key);
    changed();
  }

  function totals() {
    const subtotalC = cart.reduce((s, c) => s + cents(c.price) * c.qty, 0);
    const val = Number($('discount').value) || 0;
    let discountC = $('discountType').value === 'percent' ? Math.round((subtotalC * Math.min(Math.max(val, 0), 100)) / 100) : cents(Math.max(val, 0));
    discountC = Math.min(discountC, subtotalC);
    return { subtotal: subtotalC / 100, discount: discountC / 100, grand: (subtotalC - discountC) / 100 };
  }

  function renderCart() {
    const box = $('cartItems');
    if (!cart.length) {
      box.innerHTML = '<div class="cart-empty">Cart is empty.<br><span class="small">Click a product to add it.</span></div>';
    } else {
      box.innerHTML = cart
        .map((c) => {
          const p = c.product_id ? byId.get(c.product_id) : null;
          const partNo = (p && p.part_number) || c.part_number || '';
          const warn = p && c.qty > p.stock_qty ? `<div class="small" style="color:var(--out)">Only ${p.stock_qty} in stock!</div>` : '';
          return `<div class="cart-item" data-key="${App.esc(c.key)}">
              <div>
                <div class="ci-name">${App.esc(c.name)}</div>
                <div class="ci-sub">${partNo ? `<span class="part-badge">${App.esc(partNo)}</span> ` : ''}${App.money(c.price)} × ${c.qty}${c.product_id ? '' : ' · manual'}</div>
                ${warn}
              </div>
              <div class="ci-total">${App.money((cents(c.price) * c.qty) / 100)}</div>
              <div class="qty">
                <button type="button" class="btn" data-act="dec" aria-label="Decrease">−</button>
                <input type="number" min="1" step="1" value="${c.qty}" data-act="qty" aria-label="Quantity">
                <button type="button" class="btn" data-act="inc" aria-label="Increase">+</button>
              </div>
              <div class="right"><button type="button" class="btn btn-sm btn-danger" data-act="remove">Remove</button></div>
            </div>`;
        })
        .join('');
    }
    const t = totals();
    const count = cart.reduce((s, c) => s + c.qty, 0);
    $('cartCount').textContent = count ? `(${count} item${count === 1 ? '' : 's'})` : '';
    $('subtotal').textContent = App.money(t.subtotal);
    $('discountShow').textContent = '- ' + App.money(t.discount);
    $('grandTotal').textContent = App.money(t.grand);
    $('mbCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
    $('mbTotal').textContent = App.money(t.grand);
    $('generateBill').disabled = cart.length === 0;
  }

  function changed() {
    renderCart();
    renderProducts();
    saveCart();
  }

  function setPaymentMethod(method) {
    const isCash = method === 'cash';
    if ($('payCash')) $('payCash').checked = isCash;
    if ($('payAccount')) $('payAccount').checked = !isCash;
    if ($('lblCash')) $('lblCash').classList.toggle('active-cash', isCash);
    if ($('lblAccount')) $('lblAccount').classList.toggle('active-account', !isCash);
    if ($('accountBox')) $('accountBox').classList.toggle('hidden', isCash);
    if (isCash) {
      if ($('paymentAccount')) $('paymentAccount').value = '';
    } else {
      if ($('paymentAccount')) setTimeout(() => $('paymentAccount').focus(), 50);
    }
  }

  function resetCart() {
    cart = [];
    $('customer').value = '';
    $('discount').value = '';
    $('discountType').value = 'amount';
    setPaymentMethod('cash');
    changed();
  }

  // ---------- Generate bill ----------
  async function generateBill() {
    if (!cart.length) return;
    for (const c of cart) {
      const p = c.product_id ? byId.get(c.product_id) : null;
      if (p && cartQtyFor(p.id) > p.stock_qty) return App.toast(`Only ${p.stock_qty} ${p.name} in stock. Reduce the quantity.`, 'error');
    }
    const isAccount = $('payAccount') && $('payAccount').checked;
    const paymentMethod = isAccount ? 'account' : 'cash';
    const paymentAccount = isAccount ? ($('paymentAccount').value.trim()) : null;
    if (isAccount && !paymentAccount) {
      return App.toast('Please specify which account was used (e.g. JazzCash, EasyPaisa, Bank)', 'error');
    }
    const body = {
      customer_name: $('customer').value.trim(),
      discount_type: $('discountType').value,
      discount_value: $('discount').value || 0,
      payment_method: paymentMethod,
      payment_account: paymentAccount,
      items: cart.map((c) =>
        c.product_id
          ? { product_id: c.product_id, quantity: c.qty }
          : { name: c.name, part_number: c.part_number || null, price: c.price, quantity: c.qty }
      ),
    };
    await App.busy($('generateBill'), async () => {
      try {
        const { bill, alerts } = await App.api('/api/bills', { method: 'POST', body });
        resetCart();
        App.showBill(bill, { title: `Bill #${bill.bill_number} saved`, onClose: () => $('search').focus() });
        alerts.forEach((a) =>
          App.toast(a.status === 'out' ? `${a.name} is OUT OF STOCK` : `${a.name} is low: only ${a.stock_qty} left`, a.status === 'out' ? 'error' : 'warn', 7000)
        );
        App.refreshAlerts();
        loadProducts();
      } catch (err) {
        App.toast(err.message, 'error', 7000);
        if (err.status === 409) loadProducts();
      }
    });
  }

  // ---------- Events ----------
  $('productGrid').addEventListener('click', (e) => {
    if (e.target.closest('[data-add-product]')) {
      const q = $('search').value.trim();
      return App.openProductForm(null, {
        name: filtered().length ? '' : q,
        // New product goes straight into the cart (if it has stock), so billing can continue.
        onSaved: async (p) => {
          $('search').value = '';
          await loadProducts();
          if (p.stock_qty > 0) addProduct(byId.get(p.id));
        },
      });
    }
    const card = e.target.closest('.product-card');
    if (card) addProduct(byId.get(Number(card.dataset.id)));
  });

  $('search').addEventListener('input', renderProducts);
  $('search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const list = filtered().filter((p) => p.status !== 'out');
    if (list.length === 1 || (list.length && $('search').value.trim())) {
      addProduct(list[0]);
      $('search').select();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      $('search').focus();
    }
  });

  $('cartItems').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.closest('.cart-item').dataset.key;
    const it = cart.find((c) => c.key === key);
    if (!it) return;
    if (btn.dataset.act === 'inc') setQty(key, it.qty + 1);
    if (btn.dataset.act === 'dec') (it.qty <= 1 ? removeItem(key) : setQty(key, it.qty - 1));
    if (btn.dataset.act === 'remove') removeItem(key);
  });
  $('cartItems').addEventListener('change', (e) => {
    if (e.target.dataset.act === 'qty') setQty(e.target.closest('.cart-item').dataset.key, e.target.value);
  });

  $('manualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('mName').value.trim();
    const partNo = $('mPartNo') ? $('mPartNo').value.trim() : '';
    const price = Number($('mPrice').value);
    const qty = Math.floor(Number($('mQty').value));
    if (!name) return App.toast('Enter the item name', 'error');
    if (name.length > 150) return App.toast('Item name is too long', 'error');
    if ($('mPrice').value === '' || !Number.isFinite(price) || price < 0 || price > 10000000) return App.toast('Enter a valid price', 'error');
    if (!Number.isFinite(qty) || qty < 1 || qty > 100000) return App.toast('Enter a valid quantity', 'error');
    cart.push({ key: 'm' + manualSeq++, product_id: null, name, part_number: partNo, price: Math.round(price * 100) / 100, qty });
    $('mName').value = '';
    if ($('mPartNo')) $('mPartNo').value = '';
    $('mPrice').value = '';
    $('mQty').value = '1';
    $('mName').focus();
    changed();
  });

  $('clearCart').addEventListener('click', async () => {
    if (cart.length && !(await App.confirm('Clear the cart for the next customer?', { okText: 'Clear Cart', danger: true }))) return;
    resetCart();
  });
  ['customer', 'discount', 'discountType'].forEach((id) => $(id).addEventListener('input', () => { renderCart(); saveCart(); }));
  if ($('payCash')) $('payCash').addEventListener('change', () => setPaymentMethod('cash'));
  if ($('payAccount')) $('payAccount').addEventListener('change', () => setPaymentMethod('account'));
  document.querySelectorAll('.quick-acc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ($('paymentAccount')) {
        $('paymentAccount').value = btn.dataset.acc;
        $('paymentAccount').focus();
      }
    });
  });
  $('generateBill').addEventListener('click', generateBill);
  document.addEventListener('mj:stock-changed', loadProducts);

  App.init('pos').then(() => {
    loadCart();
    renderCart();
    loadProducts();
    setInterval(loadProducts, 60000); // pick up stock changes from other counters
  });
})();
