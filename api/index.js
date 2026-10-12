// Vercel serverless entry point: every request is routed here (see vercel.json).
let app;
let initError = null;

try {
  app = require('../src/app');
} catch (err) {
  initError = err;
  console.error('[Serverless Init Error]:', err);
}

module.exports = (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Configuration Required · MJ AUTOS</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 32px; max-width: 580px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h2 { color: #f43f5e; margin-top: 0; display: flex; align-items: center; gap: 8px; }
          code { background: #0f172a; color: #38bdf8; padding: 3px 6px; border-radius: 4px; font-size: 0.9em; }
          ol { line-height: 1.8; padding-left: 20px; color: #cbd5e1; }
          .err { background: #2e1017; border: 1px solid #9f1239; color: #fda4af; padding: 14px; border-radius: 8px; font-family: monospace; font-size: 13px; margin: 18px 0; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>⚠️ Vercel Environment Variables Missing</h2>
          <p>The app could not start because required settings are missing in Vercel:</p>
          <div class="err">${initError.message}</div>
          <p><b>Please add these variables in your Vercel Project Settings:</b></p>
          <ol>
            <li>Open <a href="https://vercel.com/dashboard" style="color:#38bdf8" target="_blank">Vercel Dashboard</a> &rarr; <b>Settings</b> &rarr; <b>Environment Variables</b></li>
            <li>Add <code>DATABASE_URL</code> (Neon PostgreSQL URL)</li>
            <li>Add <code>JWT_SECRET</code> (at least 32 characters)</li>
            <li>Go to <b>Deployments</b> and click <b>Redeploy</b></li>
          </ol>
        </div>
      </body>
      </html>
    `);
  }
  return app(req, res);
};
