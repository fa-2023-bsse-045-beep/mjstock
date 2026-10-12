const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { HttpError } = require('../validate');
const auth = require('../auth');

const router = express.Router();

// 10 failed attempts per IP per 15 minutes (successful logins don't count).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

router.post('/login', loginLimiter, async (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || email.length > 255 || password.length > 200) {
    throw new HttpError(400, 'Email and password are required');
  }

  const { rows } = await query(
    'SELECT id, name, email, role, password_hash, is_active, token_version FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  const ok = await auth.verifyPassword(password, user && user.password_hash);
  if (!user || !ok || !user.is_active) throw new HttpError(401, 'Invalid email or password');

  auth.issueSession(req, res, user);
  res.json({ user: auth.publicUser(user), redirect: user.role === 'owner' ? '/dashboard' : '/pos' });
});

router.post('/logout', (req, res) => {
  auth.clearSession(req, res);
  res.json({ ok: true });
});

router.get('/me', auth.requireApi(), (req, res) => {
  res.json({
    user: auth.publicUser(req.user),
    shop: {
      name: 'MJ AUTOS',
      address: process.env.SHOP_ADDRESS || '',
      phone: process.env.SHOP_PHONE || '',
    },
  });
});

module.exports = router;
