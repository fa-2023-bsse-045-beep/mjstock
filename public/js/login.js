(function () {
  const form = document.getElementById('loginForm');
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }

  // Only allow redirects back to our own pages.
  function nextUrl(fallback) {
    const next = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) && !next.startsWith('/login') ? next : fallback;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) return showError('Enter your email and password.');

    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'MJAutos' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      location.href = nextUrl(data.redirect);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Network error. Check your connection.' : err.message);
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });
})();
