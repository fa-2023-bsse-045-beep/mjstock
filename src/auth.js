const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('./db');
const { HttpError } = require('./validate');

const COOKIE_NAME = 'mj_session';
const SESSION_MS = (Number(process.env.SESSION_HOURS) || 12) * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  return s;
}

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

// Used when the email doesn't exist, so a failed login takes the same time either way.
let dummyHash;
async function verifyPassword(plain, hash) {
  if (!hash) {
    dummyHash = dummyHash || (await bcrypt.hash('no-such-user-placeholder', BCRYPT_ROUNDS));
    await bcrypt.compare(plain, dummyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || process.env.NODE_ENV === 'production',
    path: '/',
  };
}

function issueSession(req, res, user) {
  const token = jwt.sign({ sub: String(user.id), tv: user.token_version }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: Math.floor(SESSION_MS / 1000),
  });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: SESSION_MS });
}

function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Reads the session cookie and loads the user (null if not logged in / disabled / password changed).
async function loadUser(req) {
  if (req.user !== undefined) return req.user;
  req.user = null;
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  } catch (_) {
    return null;
  }
  const { rows } = await query(
    'SELECT id, name, email, role, token_version FROM users WHERE id = $1 AND is_active = TRUE',
    [Number(payload.sub)]
  );
  const user = rows[0];
  if (user && user.token_version === payload.tv) req.user = user;
  return req.user;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// API guard: 401 if not logged in, 403 if wrong role.
function requireApi(...roles) {
  return async (req, res, next) => {
    const user = await loadUser(req);
    if (!user) return next(new HttpError(401, 'Please log in'));
    if (roles.length && !roles.includes(user.role)) return next(new HttpError(403, 'You do not have permission to do this'));
    next();
  };
}

// Page guard: redirect to /login if not logged in, to /pos if wrong role.
function requirePage(...roles) {
  return async (req, res, next) => {
    const user = await loadUser(req);
    if (!user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (roles.length && !roles.includes(user.role)) return res.redirect('/pos');
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, issueSession, clearSession, loadUser,
  publicUser, requireApi, requirePage, jwtSecret,
};
