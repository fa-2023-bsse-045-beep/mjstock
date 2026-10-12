# MJ AUTOS — POS / Billing & Stock

A billing (point-of-sale) and stock app for the MJ AUTOS auto parts shop. Only staff use it: the customer says what they need, and the shopkeeper enters it.

- **Stack:** Node.js + Express, plain HTML/CSS/JS, PostgreSQL on **Neon** (`pg` driver)
- **Login:** a `users` table in Neon, bcrypt-hashed passwords, and a signed session in an httpOnly cookie (JWT)
- **Roles:** `owner` can do everything. `cashier` can only create and print bills.
- **Currency:** PKR (Rs)

> **Why not Neon Auth?** This app needs closed, staff-only accounts: no public sign-up, the owner creates cashiers, and there are owner/cashier roles. A small `users` table in the same Neon database does this simply and keeps everything in one place. The spec allowed this fallback.

---

## Features

| Area | What it does |
|---|---|
| New Bill (POS) | Product grid with search. Click a product to add it (`/` focuses search, Enter adds the top match). Manual items (name, price, qty) don't affect stock. +/− quantity, remove, Clear Cart. Optional customer name and discount (Rs or %). Big grand total. |
| Bill | Saved in Neon with an auto-increasing bill number (starts at 1001). Shows shop name, number, date/time, customer, items, subtotal, discount, grand total and a thank-you message. |
| Print | **A4** or **80mm thermal receipt**. Only the bill is printed; buttons and other UI are hidden. The receipt page height fits the bill. |
| Stock | Making a bill reduces stock, saves the bill and logs `stock_movements` in **one transaction** (all or nothing). Products are row-locked, so two counters can't oversell. Deleting a bill gives the stock back. |
| Oversell guard | **OUT OF STOCK** products can't be added. Quantities above stock are blocked, both in the browser and again on the server. |
| Alerts | **LOW STOCK** (orange) and **OUT OF STOCK** (red) badges. Toasts appear after a sale ("Brake Pads is low: only 2 left"). The header bell has a count badge and a list, and the owner can click an item to restock it. The dashboard has a "Low Stock / Out of Stock items" card. |
| Owner pages | Dashboard, Products (add/edit/delete/restock), Stock Report (filter OK/Low/Out, per-product movement history, CSV export), Bill History (search by number or customer, filter by date, today's total, reopen/reprint, delete), Users (create cashiers, reset password, disable, delete). |
| Optional | Low-stock alerts to the owner by **email (Resend)** and/or **WhatsApp (CallMeBot)**, at most once per product per day. |
| Security | Every page and API route needs a login. Login is rate-limited (10 failures per 15 min per IP). All inputs are validated on the server. Prices for stock items always come from the database. CSRF protection uses a custom header plus SameSite cookies. Helmet sets the security headers and CSP. Disabling a user or resetting their password logs them out immediately. |

---

## 1. Create the Neon database

1. Go to <https://console.neon.tech> and sign up or log in.
2. Click **New Project**. Name it `mj-autos` and pick the region closest to you (for Pakistan, **AWS Asia Pacific (Singapore)** or **Mumbai** if offered). Click **Create**.
3. On the project dashboard click **Connect**. Choose the `neondatabase` database (or the default `neondb`), turn **Connection pooling ON**, and copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   This is your `DATABASE_URL`. Keep it secret.

**Shortcut with the Neon CLI:** `npm i -g neon@latest && neon login && neon link --project-id <your-project-id> --branch production -y` writes `DATABASE_URL` into `.env.local`. The app reads `.env.local` first and then `.env`, so you don't need to copy the URL by hand.

You don't need to create any tables by hand. The app creates them on first start from [schema.sql](schema.sql). You can also paste that file into Neon's **SQL Editor** and run it yourself.

## 2. Set up the `.env` file

You need **Node.js 18 or newer** (<https://nodejs.org>).

```bash
cd "Mj Autos Shop"
npm install
copy .env.example .env        # Windows   (macOS/Linux: cp .env.example .env)
```

Open `.env` and fill in:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The Neon connection string from step 1 |
| `JWT_SECRET` | A long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` | The first owner account (password 8–72 characters) |
| `SHOP_ADDRESS`, `SHOP_PHONE` | Optional. Printed on the bill. |
| `SHOP_TIMEZONE` | Default `Asia/Karachi`. Used for "today's sales". |

Never commit `.env`. It's already in `.gitignore`, and secrets are only ever read on the server.

## 3. Create the first owner account

**Option A (automatic):** with `OWNER_EMAIL` and `OWNER_PASSWORD` set, the app creates the owner on first start if no owner exists yet.

**Option B (script):**
```bash
npm run create-owner
# or with arguments:
npm run create-owner -- owner@mjautos.pk "StrongPassword123" "Owner Name"
```
Running the script again for the same email **resets that password**. Use this if you forget it.

After the first login, delete `OWNER_PASSWORD` from `.env`. It isn't needed any more.

## 4. Run locally

```bash
npm start          # or: npm run dev   (auto-restarts when you edit files)
```
Open <http://localhost:3000> and log in as the owner. Then:

1. **Products → + Add Product**: add your parts with price, current stock and minimum stock (the alert level).
2. **Users → Add cashier**: create accounts for your staff.
3. **New Bill**: start billing.

Optional: `npm run init-db` only creates the tables and the owner, without starting the server.

## 5. Deploy

### Option A — Render (recommended, simplest)

1. Push this folder to a **private** GitHub repository (`.env` is ignored automatically).
2. On <https://render.com>, go to **New → Web Service** and connect the repo.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
4. Under **Environment**, add `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, plus the optional variables (`OWNER_*` only for the first start, then `SHOP_*` and the alert keys).
5. Click **Deploy** and open the `https://….onrender.com` URL.

The free Render plan sleeps after inactivity, so the first page load can take ~30 s. A paid "Starter" instance stays awake.

### Option B — Vercel

The repo includes [vercel.json](vercel.json) and [api/index.js](api/index.js), so the whole Express app runs as one serverless function.

1. Install the CLI with `npm i -g vercel`, then run `vercel` in this folder (or import the GitHub repo on <https://vercel.com>).
2. In **Project → Settings → Environment Variables**, add the same variables as above, including `NODE_ENV=production`.
3. Run `vercel --prod`.

Notes for Vercel: the login rate limiter keeps its counts in memory per serverless instance, so it's weaker there than on Render. Optional alerts are sent before the bill response returns, so bills may take a moment longer when an alert fires.

---

## Optional: low-stock alerts by email / WhatsApp

Alerts are sent when a sale makes a product low or out of stock, **once per product per day**. If sending fails, the next sale tries again.

**Email (Resend):**
1. Create an account at <https://resend.com>, verify your domain (or use their test sender), and create an API key.
2. Set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (for example `MJ AUTOS <alerts@yourdomain.com>`) and `ALERT_EMAIL_TO` (the owner's email; separate several with commas).

**WhatsApp (CallMeBot, free for personal use):**
1. Follow <https://www.callmebot.com/blog/free-api-whatsapp-messages/>. You send a WhatsApp message to their number and get an API key back.
2. Set `CALLMEBOT_PHONE` (for example `+923001234567`) and `CALLMEBOT_APIKEY`.

Leave these empty to turn the alerts off. In-app toasts, the bell and the dashboard always work.

---

## Printing tips

- **80mm thermal printer:** click **Print Receipt (80mm)**. In the print dialog, select the thermal printer, set margins to *None/Default*, and turn off "Headers and footers".
- **A4:** click **Print A4**.
- The app remembers your last choice and highlights it.

## Project structure

```
server.js            local / Render entry point
api/index.js         Vercel entry point
schema.sql           all tables (auto-applied on start)
src/app.js           Express app, security, page routing
src/auth.js          sessions, password hashing, role guards
src/db.js            Neon connection pool + transactions
src/routes/*.js      API: auth, products, bills, stock, users, dashboard
src/notify.js        optional email / WhatsApp alerts
scripts/             create-owner, init-db
views/*.html         pages (served only after login)
public/css, js       styles and browser scripts
```

## Database tables

`users`, `products`, `bills` (with `bill_number` from a sequence), `bill_items` (`product_id` is NULL for manual items), `stock_movements` (`reason` = sale / restock / adjustment), and `stock_alert_log` (stops duplicate daily email/WhatsApp alerts). See [schema.sql](schema.sql).
