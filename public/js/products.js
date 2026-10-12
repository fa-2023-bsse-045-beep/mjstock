(function () {
  const $ = (id) => document.getElementById(id);
  let products = [];

  async function load() {
    try {
      products = (await App.api('/api/products')).products;
      render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function updateCartBadge() {
    const btn = $('viewCartBtn');
    if (!btn) return;
    const { cart } = App.getCartData();
    const count = cart.reduce((s, it) => s + (it.qty || 0), 0);
    btn.textContent = count > 0 ? `🛒 View Cart (${count})` : '🛒 View Cart';
  }

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const list = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
    const { cart } = App.getCartData();
    const cartMap = new Map(cart.map((c) => [c.product_id, c.qty]));

    $('rows').innerHTML = list.length
      ? list
          .map(
            (p) => {
              const inCartQty = cartMap.get(p.id) || 0;
              const isOut = p.stock_qty <= 0;
              const cartBtnText = inCartQty > 0 ? `Add to Cart (${inCartQty})` : 'Add to Cart';
              return `<tr>
                <td><b>${App.esc(p.name)}</b></td>
                <td class="num">${App.money(p.price)}</td>
                <td class="num">${p.stock_qty}</td>
                <td class="num">${p.min_stock}</td>
                <td>${App.statusBadge(p.status)}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-primary" data-act="cart" data-id="${p.id}" ${isOut ? 'disabled title="Out of stock"' : ''}>${cartBtnText}</button>
                  <button class="btn btn-sm btn-success" data-act="restock" data-id="${p.id}">+ Stock</button>
                  <button class="btn btn-sm" data-act="edit" data-id="${p.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-act="delete" data-id="${p.id}">Delete</button>
                </td>
              </tr>`;
            }
          )
          .join('')
      : `<tr><td colspan="6" class="empty">${products.length ? 'No product matches your search.' : 'No products yet. Click “Add Product”.'}</td></tr>`;
    updateCartBadge();
  }

  const openForm = (product) => App.openProductForm(product);

  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = products.find((x) => x.id === Number(btn.dataset.id));
    if (!p) return;
    if (btn.dataset.act === 'cart') {
      if (App.addToCart(p)) render();
      return;
    }
    if (btn.dataset.act === 'edit') openForm(p);
    if (btn.dataset.act === 'restock') App.openRestock(p);
    if (btn.dataset.act === 'delete') {
      const ok = await App.confirm(`Delete “${p.name}”? Old bills will keep the item name, but its stock history will be removed.`, { okText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await App.api(`/api/products/${p.id}`, { method: 'DELETE' });
        App.toast('Product deleted', 'success');
        App.stockChanged();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    }
  });
  $('search').addEventListener('input', render);
  $('addBtn').addEventListener('click', () => openForm(null));
  document.addEventListener('mj:stock-changed', load);
  document.addEventListener('mj:cart-changed', render);

  App.init('products').then(load);
})();
