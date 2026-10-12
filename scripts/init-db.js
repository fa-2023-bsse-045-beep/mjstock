// Creates all tables (and the first owner, if OWNER_EMAIL/OWNER_PASSWORD are set).  Usage: npm run init-db
require('../src/env');
const { setup } = require('../src/setup');
const { pool } = require('../src/db');

setup()
  .then(() => console.log('Database tables are ready.'))
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
