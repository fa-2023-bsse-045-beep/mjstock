// Loads .env.local (written by `neon link`: DATABASE_URL etc.) and then .env (your own settings).
// Real environment variables (Render/Vercel dashboards) always win over both files.
const path = require('path');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: [path.join(root, '.env.local'), path.join(root, '.env')], quiet: true });
