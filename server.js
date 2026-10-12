const app = require('./src/app');
const { ensureReady } = require('./src/setup');

const PORT = Number(process.env.PORT) || 3000;

ensureReady()
  .then(() => console.log('[setup] Database ready'))
  .catch((err) => console.error('[setup] Database setup failed (will retry on first request):', err.message));

app.listen(PORT, () => {
  console.log(`MJ AUTOS POS running at http://localhost:${PORT}`);
});
