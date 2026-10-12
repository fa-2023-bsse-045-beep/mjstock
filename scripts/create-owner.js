// Creates an owner account, or resets the password of an existing account and makes it an owner.
// Usage:
//   npm run create-owner                         (uses OWNER_NAME / OWNER_EMAIL / OWNER_PASSWORD from .env)
//   npm run create-owner -- you@mail.com "NewPassword123" "Your Name"
require('../src/env');
const { applySchema, query, pool } = require('../src/db');
const { hashPassword } = require('../src/auth');
const v = require('../src/validate');

async function main() {
  const [argEmail, argPassword, argName] = process.argv.slice(2);
  const email = v.email(argEmail || process.env.OWNER_EMAIL);
  const password = v.password(argPassword || process.env.OWNER_PASSWORD);
  const name = v.text(argName || process.env.OWNER_NAME || 'Owner', 'Name', { required: true, max: 100 });

  await applySchema();
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = 'owner', is_active = TRUE,
           token_version = users.token_version + 1
     RETURNING (xmax = 0) AS inserted`,
    [name, email, await hashPassword(password)]
  );
  console.log(rows[0].inserted ? `Owner account created: ${email}` : `Password reset; ${email} is now an active owner.`);
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
