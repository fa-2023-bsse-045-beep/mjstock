const express = require('express');
const { query } = require('../db');
const v = require('../validate');
const { requireApi, hashPassword } = require('../auth');

const router = express.Router();
router.use(requireApi('owner'));

const FIELDS = 'id, name, email, role, is_active, created_at';

router.get('/', async (req, res) => {
  const { rows } = await query(`SELECT ${FIELDS} FROM users ORDER BY role DESC, LOWER(name)`);
  res.json({ users: rows });
});

// Owner creates cashier accounts (there is no public sign-up).
router.post('/', async (req, res) => {
  const body = req.body || {};
  const name = v.text(body.name, 'Name', { required: true, max: 100 });
  const email = v.email(body.email);
  const password = v.password(body.password);
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'cashier') RETURNING ${FIELDS}`,
      [name, email, await hashPassword(password)]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw new v.HttpError(409, 'A user with this email already exists');
    throw err;
  }
});

async function getCashier(idParam, currentUser) {
  const id = v.id(idParam);
  if (id === currentUser.id) throw new v.HttpError(400, 'You cannot change your own account here');
  const { rows } = await query('SELECT id, role FROM users WHERE id = $1', [id]);
  if (!rows.length) throw new v.HttpError(404, 'User not found');
  if (rows[0].role !== 'cashier') throw new v.HttpError(403, 'Owner accounts can only be changed with the create-owner script');
  return id;
}

// Enable/disable a cashier. Disabling logs them out immediately (token_version bump).
router.patch('/:id', async (req, res) => {
  const id = await getCashier(req.params.id, req.user);
  if (typeof (req.body && req.body.is_active) !== 'boolean') throw new v.HttpError(400, 'is_active must be true or false');
  const { rows } = await query(
    `UPDATE users SET is_active = $1, token_version = token_version + 1 WHERE id = $2 RETURNING ${FIELDS}`,
    [req.body.is_active, id]
  );
  res.json({ user: rows[0] });
});

router.post('/:id/password', async (req, res) => {
  const id = await getCashier(req.params.id, req.user);
  const password = v.password(req.body && req.body.password);
  await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [
    await hashPassword(password), id,
  ]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = await getCashier(req.params.id, req.user);
  await query('DELETE FROM users WHERE id = $1', [id]); // their old bills keep working (created_by -> NULL)
  res.json({ ok: true });
});

module.exports = router;
