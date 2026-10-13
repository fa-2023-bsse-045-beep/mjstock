require('./env');

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { HttpError } = require('./validate');
const { ensureReady } = require('./setup');
const { requirePage, loadUser, jwtSecret } = require('./auth');

jwtSecret(); // fail fast if JWT_SECRET is missing/weak

const app = express();
const VIEWS = path.join(__dirname, '..', 'views');

app.set('trust proxy', 1); // behind Render/Vercel proxy: correct client IP for rate limiting + secure cookies
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      // Only force HTTPS sub-requests in production; on http://localhost it would break CSS/JS loading.
      directives: { upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null },
    },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, maxAge: '1h' }));

// Make sure tables + first owner exist before handling anything that touches the DB.
app.use(async (req, res, next) => {
  try {
    await ensureReady();
    next();
  } catch (err) {
    next(err);
  }
});

// CSRF protection: state-changing API calls must carry a custom header, which other sites cannot send.
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'MJAutos') {
    return next(new HttpError(403, 'Invalid request origin'));
  }
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

// ---------- Pages (every page except /login requires a session) ----------
const page = (file) => (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(VIEWS, file));
};

app.get('/login', async (req, res, next) => {
  const user = await loadUser(req);
  if (user) return res.redirect(user.role === 'owner' ? '/dashboard' : '/pos');
  page('login.html')(req, res, next);
});

app.get('/', requirePage(), (req, res) => res.redirect(req.user.role === 'owner' ? '/dashboard' : '/pos'));
app.get('/pos', requirePage(), page('pos.html'));
app.get('/dashboard', requirePage('owner'), page('dashboard.html'));
app.get('/products', requirePage('owner'), page('products.html'));
app.get('/bills', requirePage('owner'), page('bills.html'));
app.get('/stock', requirePage('owner'), page('stock.html'));
app.get('/users', requirePage('owner'), page('users.html'));
app.get('/expenses', requirePage('owner'), page('expenses.html'));
app.get('/my-expenses', requirePage(), page('my-expenses.html'));

app.use((req, res) => {
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type('text').send('Not found'); // missing file
  res.redirect('/');
});

// ---------- Errors ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.type === 'entity.parse.failed') message = 'Invalid JSON';
  if (err.code === '23505') { status = 409; message = 'This already exists (duplicate name or email)'; }
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    message = 'Something went wrong on the server. Please try again.';
  }
  if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

module.exports = app;
