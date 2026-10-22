# MediCore Server Edition — Project Guide for Developers

This file is for anyone extending or maintaining the MediCore Server Edition codebase. It describes how the project is laid out, the conventions the existing code follows, and how to add work without breaking the security model. For installation and operations, see `HowToSetup.md`. For the user-facing feature list, see `README.md`.

## What MediCore is

A client-server clinic and hospital management system for small and mid-sized clinics: patients, doctors, appointments with per-doctor daily token numbers, billing, pharmacy, laboratory, reports and settings. The backend is Node.js 20 + Express 4 with PostgreSQL 16; the frontend is a single HTML file served by the app. Buyers receive the full source under a commercial single-buyer licence (see `README.md`).

The credit line in the app — on the sign-in screen and in the About area — reads "Developed by Arafat". Keep it intact in the app screens. Buyers set their own clinic name in Settings, and printed documents carry the buyer's clinic name only.

## Layout

```
server/
  index (entry point)      Starts the server, reads .env, listens on PORT
  app                      Builds the Express app: JSON parsing, static
                           serving of public/, route mounting under /api,
                           error handling
  db.js                    PostgreSQL connection pool (pg), configured
                           from DATABASE_URL; the only place that creates
                           the pool — routes query through it
  audit.js                 Writes audit-trail rows (sign-ins, user
                           management) used by the routes
  utils.js                 Small shared helpers (money rounding, number
                           coercion, blank checks)
  middleware/
    auth.js                PERMS matrix, JWT sign/verify helpers, and the
                           auth + permission middleware used by routes
  routes/
    One file per resource — auth, setup, patients, doctors,
    appointments, invoices (billing), medicines (medicine master
    records, dispensing and sales), purchases.js (pharmacy purchase
    batches), expenses.js (pharmacy expenses), reports.js (the stock
    report), lab (tests and orders), settings, users, audit (the
    audit-log read) and export. Each file exports an Express
    router. Apart from the stock report, the dashboard and reports
    are aggregated by the frontend from the API collections.

public/
  index.html               The whole frontend: markup, styles and script
                           in one file. It holds no data and makes no
                           decisions about permission — it renders what
                           the API returns and calls /api for everything.

database/
  schema.sql               All tables. Applied by `npm run db:init`.
  seed.sql                 Optional demo dataset, including the four demo
                           user accounts with bcrypt-hashed passwords.
                           Applied by `npm run db:seed`. Demo-only —
                           never a production starting point.
```

Configuration comes from `.env`: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`. Never hard-code any of them, and never commit a real `.env`.

## Data model notes

- **Medicines are master data only** — name, generic, company, unit, pack size, selling price and low-stock threshold. A medicine row carries no stock quantity, buy price or expiry date.
- **Purchases hold the stock that arrives.** Each row in `purchases` (IDs PUR-1, PUR-2, …) is one batch: date, medicine, quantity, per-unit purchase price, batch number, expiry date and supplier, stored separately from every other batch of the same medicine.
- **Stock is computed, never stored.** The on-hand figure is purchases in minus dispensing out. There is no column and no endpoint for setting stock directly.
- **`pharmacy_sale_allocations` records dispensing per batch.** Each allocation row links a pharmacy sale to a purchase batch and the quantity drawn from it, so every sale can be traced to the batches that supplied it.
- **Expenses are pharmacy running costs.** Each row in `expenses` (IDs EXP-1, EXP-2, …) holds a date, title, amount and optional note, and feeds the pharmacy profit figures: profit for a period is sales revenue − cost of goods sold − expenses.

## Conventions

- **CommonJS throughout the backend** — `require` / `module.exports`. Do not mix in ES module syntax.
- **Small route files.** One resource per file, handlers kept short. Shared logic (money rounding, date helpers) belongs in a shared place, not copied between routes.
- **Money that moves is calculated on the server.** Invoice totals, discounts, due amounts and pharmacy sale amounts are calculated in route handlers inside a database transaction — never trust a total sent by the browser. Round money values to two decimals at calculation and storage time, as the existing billing and pharmacy code does. Dashboard and report aggregates (collections, pharmacy profit) are presentation math: the frontend computes them from API data, and the server protects them by redacting cost data per role (see the profit note under Permissions).
- **Stock changes are transactional.** Dispensing allocates stock from purchase batches FEFO — earliest expiry first, batches without an expiry date last — writes one row per batch used to `pharmacy_sale_allocations`, and inserts the sale record in the same transaction, storing the sell-price snapshot and a unit-cost snapshot taken as the weighted average of the batches used. Billing payments update the invoice in a transaction in the same spirit. Follow that pattern for anything that moves money or stock. Stock is never written directly: there is no endpoint, route helper or admin action that sets an on-hand quantity — stock changes only through a purchase entry or a dispensing transaction. A purchase batch that already has recorded sales cannot be deleted (the API answers 400); do not add a path around that rule. Purchase and expense changes are guarded by the existing `pharmacy.write` permission, and there is no separate permission for them.
- **Every mutating route is permission-checked.** `POST`, `PUT`, `PATCH` and `DELETE` handlers run the auth middleware and then the permission middleware for their resource — no exceptions, including routes you think "only the frontend calls". The frontend hiding a button is presentation, not security.
- **Passwords only ever as bcrypt hashes**, hashed on the server. Plain passwords must never be stored, logged or returned by any route. User responses must never include the password hash.
- **Tokens:** sign-in returns a JWT (default expiry 8 hours, from `JWT_EXPIRES_IN`) signed with `JWT_SECRET`. There is no fallback secret — the server refuses to start when `JWT_SECRET` is missing or weak, and the sign-in route is rate-limited per address. The middleware verifies the token on each protected call and loads the live user record, so deleting an account or changing a role takes effect without waiting for the token to expire.
- **Frontend talks only to `/api`.** `public/index.html` keeps the token after sign-in, sends it with each call, and returns the user to the sign-in screen when the API answers 401. It stores no clinic records locally.
- **Escape user text** wherever the frontend renders it into markup, following the existing rendering helpers in `public/index.html`.
- **Printed documents** (invoices, lab reports) are rendered by the frontend from API data using the clinic name, address and phone from Settings. Keep the buyer clinic details as the only branding on printed output.

## Permissions — the PERMS matrix

`PERMS` lives in `server/middleware/auth.js` and is the single source of truth for who may change what. Permission names follow the pattern `<area>.write` for create/update/delete in an area, with separate names where an action deserves its own gate.

| Permission | Admin | Receptionist | Pharmacist | Lab Technician |
|---|:---:|:---:|:---:|:---:|
| `patients.write` | ✓ | ✓ | — | — |
| `doctors.write` | ✓ | — | — | — |
| `appointments.write` | ✓ | ✓ | — | — |
| `billing.write` | ✓ | ✓ | — | — |
| `pharmacy.write` | ✓ | — | ✓ | — |
| `pharmacy.dispense` | ✓ | — | ✓ | — |
| `lab.write` | ✓ | — | — | ✓ |
| `labOrders.create` | ✓ | ✓ | — | ✓ |
| `labOrders.write` | ✓ | — | — | ✓ |
| `settings.write` | ✓ | — | — | — |
| `users.manage` | ✓ | — | — | — |
| `data.manage` | ✓ | — | — | — |

Notes:

- `data.manage` covers the Admin-only data actions in the server edition, including the full JSON export (`GET /api/export`).
- Pharmacy profit is not a write permission — it is a read rule: profit figures (dashboard panel, reports overview) are shown only to Admin, and profit for a period is sales revenue − cost of goods sold − expenses. The underlying cost data follows the same discipline on the server: purchase prices and the cost-derived figures in the stock report are returned only to Admin and Pharmacist, and a sale's `unitCost` only to Admin — every other role receives `null` in those fields. Do not add cost or profit fields to responses for other roles.
- Reading is broader than writing: a signed-in user can view the areas their work touches. The matrix above governs changes. If you add a sensitive read (anything financial beyond a role's own work, or the audit trail), gate it explicitly and note it here.
- The setup route is the one deliberate exception to auth: `POST /api/setup/admin` runs only while the users table is empty, and must refuse once any user exists. Do not add other unauthenticated mutating routes.

## How to run locally

You need Node.js 20 and PostgreSQL 15 or 16 (or use the Docker Compose setup in `HowToSetup.md`, which is the quickest local route too).

```bash
cp .env.example .env     # set DATABASE_URL and a long JWT_SECRET
npm install
npm run db:init          # apply database/schema.sql
npm run db:seed          # optional: demo clinic + demo accounts
npm start
```

Open `http://localhost:3000`. Without the seed, the first screen is the Admin setup screen. With the seed, you can sign in with a demo account (see `README.md`). The demo set deliberately includes a low-stock medicine and an expired purchase batch so the dashboard alerts can be checked.

## How to add a resource

Worked example — adding, say, a new register alongside the existing ones:

1. **Schema first.** Add the table to `database/schema.sql`, following the existing tables' naming (plural table name, primary key, name snapshots on history records where a register entry can later be deleted — appointments, invoices and lab orders store `patient_name` / `doctor_name` / `test_name` columns alongside the IDs for exactly this reason; the API aliases them to camelCase). Check `npm run db:init` against a scratch database.
2. **Permission.** Decide which roles may change it and add the permission name to `PERMS` in `server/middleware/auth.js` (and to the table above). Reuse an existing permission if the resource plainly belongs to an existing area.
3. **Route file.** Add `server/routes/<resource>.js` exporting a router, following the nearest existing route file for structure: list and read endpoints, then mutating endpoints each guarded by auth + the permission from step 2. Validate input on the server. Do money or stock work inside a transaction.
4. **Mount it.** Register the router in the app under `/api/<resource>`.
5. **Frontend.** Add the section markup, nav entry and render function in `public/index.html`, following an existing module (Patients or Doctors are the cleanest patterns). Render only from API responses; mirror the permission in the UI by hiding controls the role cannot use, knowing the API check is the real gate.
6. **Test it** as each affected role — including at least one role that should be refused (see below).

## Testing notes

There is no test suite to hide behind in this project — verify changes by running the app and exercising the API directly. Useful checks with `curl`:

Sign in and keep the token (seeded demo Admin shown; on an unseeded install, create the Admin in the browser first):

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# Response contains a token — copy it for the calls below.
```

A protected read with the token:

```bash
curl -s http://localhost:3000/api/patients \
  -H "Authorization: Bearer <token>"
```

A protected write — this should succeed as Admin or Receptionist and return 403 as Pharmacist or Lab Technician, which is the check that matters:

```bash
curl -s -X POST http://localhost:3000/api/patients \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Patient","phone":"01000000000","age":30,"gender":"Female"}'
```

Also confirm, for any change you make:

- The same calls **without** a token return 401.
- An expired or altered token returns 401.
- `POST /api/setup/admin` refuses once any user exists.
- After dispensing, stock has decreased by exactly the dispensed quantity and the sale row carries its price/cost snapshots, with the quantity drawn from the earliest-expiry batches first — check the sale's allocations in `pharmacy_sale_allocations` against the batches' expiry dates, including that a batch with no expiry date is only used after every dated batch.
- Sign-ins and user-management actions you performed appear in the audit trail in Settings (as Admin).

## Deployment

Deployment, reverse proxy and HTTPS, the systemd unit for a bare install, updating, and backups (`pg_dump` plus the Settings JSON export) are all covered in `HowToSetup.md` — point operators there rather than copying instructions into code comments. Two rules worth repeating for developers: the database volume/data directory is the product's memory — never ship a change that reinitialises it — and a schema change is not done until `npm run db:init` applies it cleanly to a database that already holds data.
