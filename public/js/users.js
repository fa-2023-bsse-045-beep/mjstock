(function () {
  const $ = (id) => document.getElementById(id);
  let users = [];

  async function load() {
    try {
      users = (await App.api('/api/users')).users;
      render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function render() {
    $('rows').innerHTML = users
      .map((u) => {
        const editable = u.role === 'cashier' && u.id !== App.user.id;
        return `<tr>
          <td><b>${App.esc(u.name)}</b>${u.id === App.user.id ? ' <span class="small muted">(you)</span>' : ''}</td>
          <td>${App.esc(u.email)}</td>
          <td><span class="badge badge-role">${App.esc(u.role)}</span></td>
          <td>${u.is_active ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-out">Disabled</span>'}</td>
          <td class="actions">${
            editable
              ? `<button class="btn btn-sm" data-act="password" data-id="${u.id}">Reset password</button>
                 <button class="btn btn-sm" data-act="toggle" data-id="${u.id}">${u.is_active ? 'Disable' : 'Enable'}</button>
                 <button class="btn btn-sm btn-danger" data-act="delete" data-id="${u.id}">Delete</button>`
              : ''
          }</td>
        </tr>`;
      })
      .join('');
  }

  function resetPassword(u) {
    const d = App.dialog({
      title: 'Reset password: ' + u.name,
      body: `<div class="form-error hidden"></div>
        <form id="pwForm"><div class="field"><label for="newPw">New password (8–72 characters)</label>
        <input id="newPw" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></div></form>
        <p class="small muted">They will be logged out and must use the new password.</p>`,
      foot: '<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save password</button>',
    });
    const errBox = d.querySelector('.form-error');
    d.querySelector('#newPw').focus();
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    const save = () =>
      App.busy(d.querySelector('[data-save]'), async () => {
        try {
          await App.api(`/api/users/${u.id}/password`, { method: 'POST', body: { password: d.querySelector('#newPw').value } });
          d.close();
          App.toast('Password updated', 'success');
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      });
    d.querySelector('[data-save]').addEventListener('click', save);
    d.querySelector('#pwForm').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const u = users.find((x) => x.id === Number(btn.dataset.id));
    if (!u) return;
    try {
      if (btn.dataset.act === 'password') return resetPassword(u);
      if (btn.dataset.act === 'toggle') {
        await App.api(`/api/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } });
        App.toast(`${u.name} ${u.is_active ? 'disabled' : 'enabled'}`, 'success');
      }
      if (btn.dataset.act === 'delete') {
        if (!(await App.confirm(`Delete ${u.name}? Their old bills will be kept.`, { okText: 'Delete', danger: true }))) return;
        await App.api(`/api/users/${u.id}`, { method: 'DELETE' });
        App.toast('User deleted', 'success');
      }
      load();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  });

  $('userForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const errBox = $('formError');
    errBox.classList.add('hidden');
    App.busy($('addBtn'), async () => {
      try {
        await App.api('/api/users', {
          method: 'POST',
          body: { name: $('uName').value, email: $('uEmail').value, password: $('uPass').value },
        });
        $('userForm').reset();
        App.toast('Cashier account created', 'success');
        load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    });
  });

  App.init('users').then(load);
})();
