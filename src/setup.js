const { query, applySchema } = require('./db');
const { hashPassword } = require('./auth');
const v = require('./validate');

// Creates tables (if missing) and the first owner account from .env (if no owner exists yet).
async function setup() {
  await applySchema();

  const { rows } = await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'owner'");
  if (rows[0].n > 0) return;

  const { OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME } = process.env;
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.warn('[setup] No owner account yet. Set OWNER_EMAIL and OWNER_PASSWORD in .env, or run: npm run create-owner');
    return;
  }
  const email = v.email(OWNER_EMAIL);
  const password = v.password(OWNER_PASSWORD);
  const name = v.text(OWNER_NAME || 'Owner', 'Name', { required: true, max: 100 });
  await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (email) DO NOTHING`,
    [name, email, await hashPassword(password)]
  );
  console.log(`[setup] Owner account created for ${email}. You can now remove OWNER_PASSWORD from .env.`);
}

let ready = null;
function ensureReady() {
  if (!ready) {
    ready = setup().catch((err) => {
      ready = null; // retry on the next request
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureReady, setup };
