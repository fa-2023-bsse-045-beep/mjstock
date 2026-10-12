const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Return NUMERIC and BIGINT as JS numbers (money has 2 decimals, counts are small).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // Neon may need a few seconds to wake up
});
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

const query = (text, params) => pool.query(text, params);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
    throw err;
  } finally {
    client.release();
  }
}

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // Advisory lock so two app instances starting together don't race on CREATE TABLE.
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(sql);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727001)'); } catch (_) {}
    client.release();
  }
}

module.exports = { pool, query, withTransaction, applySchema };
