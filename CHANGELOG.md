# Changelog

All notable changes to MediCore are documented here.

## 2.1.0 — Batch-based pharmacy stock — 2026-10-22

Pharmacy stock is now tracked batch by batch, exactly as it arrives. The medicine list stays familiar, but what a medicine record holds, how stock gets in, and how it goes out have all changed — please read the notes below before upgrading a working pharmacy.

**Purchase batches**
- A medicine record is now master data only: name, generic, company, unit, pack size, selling price and low-stock threshold. It no longer carries a quantity, a buy price or an expiry date of its own.
- Stock arrives only through purchase entries. Each entry records the date, quantity, per-unit purchase price, batch number, expiry date and supplier, and each batch is stored separately with its own price and expiry. Purchases are numbered PUR-1, PUR-2, … and are managed through `GET /api/purchases` and `POST /api/purchases`, with `DELETE /api/purchases/:id` for removing a batch that has no recorded sales.
- A purchase batch that already has recorded sales cannot be deleted — the API answers 400 — so the history behind every sale stays intact.

**Stock is computed, never entered**
- There is deliberately no manual stock editing anywhere. Purchases add stock, dispensing removes it, and the on-hand figure is computed from those movements — there is no quantity field to type over, in the screens or through the API.
- The old `POST /api/medicines/:id/restock` endpoint is removed. Opening stock and every later delivery are entered as purchase entries, so each unit on the shelf can be traced to the purchase that brought it in.

**FEFO dispensing, with a cost snapshot per sale**
- Dispensing allocates batches FEFO — earliest expiry first, with batches that have no expiry date used last — inside the same server transaction that records the sale.
- Each sale's batch usage is written per batch to the new `pharmacy_sale_allocations` table, so which batches supplied a sale is always on record.
- The sale's unit cost is snapshotted as the weighted average of the batches used, so later purchases at different prices never rewrite the cost or profit of a sale already made.

**Pharmacy expenses and profit**
- Running costs can now be recorded under Pharmacy as expenses — date, title, amount and an optional note — numbered EXP-1, EXP-2, … and managed through `GET /api/expenses`, `POST /api/expenses`, `PUT /api/expenses/:id` and `DELETE /api/expenses/:id`. The entries live in the new `expenses` table.
- Pharmacy profit — on the dashboard panel and in reports — is now calculated for the period as sales revenue − cost of goods sold − expenses, so the figure reflects what the pharmacy actually kept, not just its margin on medicines.

**Stock report and alerts**
- A new Stock Report (`GET /api/reports/stock`) shows, per medicine, the last purchase price, the sell price, the current stock quantity and the stock value — the sum over batches of remaining quantity × batch purchase price — with a total stock value for the whole pharmacy. As before, cost-derived figures follow the role rule: buy and cost data are returned only to Admin and Pharmacist accounts.
- Pharmacy alerts (`GET /api/pharmacy/alerts`) now cover batches that have expired or expire within 30 days, alongside medicines at or below their low-stock threshold.

**Schema and migration**
- New tables: `purchases`, `pharmacy_sale_allocations` and `expenses`. No new permissions: purchase and expense changes use the existing `pharmacy.write` permission (Admin and Pharmacist), and dispensing stays under `pharmacy.dispense`.
- Running `npm run db:init` applies the migration to an existing database: the new tables and columns are added, and the old stored stock columns on the medicine record are dropped, since stock is now computed from purchases and dispensing. Take a database backup before upgrading, as with any schema change.

## 2.0.0 — Server Edition — 2026-10-22

A full rewrite of where MediCore keeps its data and how it enforces its rules. The nine modules, the screens and the daily workflow will feel familiar to anyone who used the 1.x edition — what changed is everything underneath them.

**Client-server architecture**
- New backend in Node.js 20 and Express 4, serving the browser frontend from `public/` and a REST API under `/api`.
- All records now live in PostgreSQL 16 — patients, doctors, appointments, invoices, medicines, pharmacy sales, lab tests, lab orders, users, settings and the audit log — instead of in one browser's storage.
- Multi-user and multi-counter by design: reception, pharmacy and lab sign in at the same time and work on one shared, live database. Any device with a browser on the clinic network can be a counter.

**Accounts and security, enforced on the server**
- Sign-in issues a JSON Web Token (8-hour expiry by default, set with `JWT_EXPIRES_IN`). The API verifies it on every protected call.
- Passwords are hashed with bcrypt on the server. Checks that used to happen in the browser now happen where they belong — a modified browser cannot grant itself access.
- Role middleware guards every mutating API route, using the same four roles and permission matrix as 1.x: Admin, Receptionist, Pharmacist and Lab Technician. Pharmacy profit stays Admin-only, now enforced in API responses rather than by hiding figures on screen.
- Still no default accounts: the first visitor creates the Admin account on the setup screen, and the setup endpoint only works while zero users exist.
- The security audit trail (sign-ins, account creation and deletion, password resets) is now stored in the database, where it is shared across counters and survives any one device being replaced.
- No fallback signing secret: the server refuses to start until `JWT_SECRET` is a strong random value, sign-in attempts are rate-limited per address, and passwords must be at least 6 characters — enforced by the API, not just the screens.

**Transactions for money and stock**
- Billing totals, discounts and payments are calculated and written on the server inside database transactions.
- Dispensing decrements stock and records the sale — with its sell-price and buy-price snapshots — in the same transaction, so counters cannot oversell the last units and past profit is never rewritten by a later price change.
- Appointment token numbers are allocated per doctor per day on the server, so two reception desks booking at once cannot hand out the same token.

**Deployment and data**
- Docker Compose deployment: one command brings up the app and PostgreSQL 16, with a named volume for the data and a healthcheck on the database. A bare-server install (Node 20 + PostgreSQL) is also documented step by step.
- Configuration through `.env`: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`.
- Admin can download a full JSON export from Settings (`GET /api/export`).

**Deliberate differences from 1.3 — please read**
- **Data is no longer stored in the browser.** The frontend keeps no clinic records; clearing a browser loses nothing, and changing devices loses nothing.
- **There is no restore button inside the app.** In the single-file edition, backup and restore both lived in Settings because the browser was the database. In this edition, full backups are standard PostgreSQL dumps (`pg_dump`) restored with PostgreSQL tools, and the in-app JSON export is a snapshot for inspection and migration, not a restore file. See `HowToSetup.md`.
- **Demo data loads from SQL, not from a Settings button.** Run `npm run db:seed` to load the sample clinic, including the four demo accounts (`admin`, `reception`, `pharmacy`, `lab`). Delete the demo accounts before real use, as before.

Module coverage is unchanged from 1.3: Dashboard, Patients, Doctors, Appointments, Billing, Pharmacy, Laboratory, Reports and Settings, including search and filters across the lists, the 16 country currency presets, easy medicine entry and pharmacy profit tracking.

## 1.x — Single-file edition (summary)

The 1.x line shipped MediCore as one self-contained HTML file with records held in the browser. It is summarised here for continuity; the detail lives in that edition's own changelog.

- **1.0 — first release.** The nine modules arrived together: dashboard with stock and expiry alerts, patient registration with visit history, doctor directory, appointments with automatic per-doctor daily tokens and a queue status flow, billing with consultation fee, line items, percentage discount and partial payments, pharmacy stock with one-click dispensing, a lab catalogue with orders and printable results, collection reports, and settings for the clinic profile and currency. Demo data was built in.
- **1.1 — documentation and packaging.** A setup guide covering static hosting and Docker, container files, and the data model written out as SQL schema and seed files so teams could plan a move to a server setup.
- **1.2 — accounts and roles.** A sign-in screen, a first-run flow that created the initial Admin, and four roles with a permission check on every change a user could make. Admins gained user management in Settings: adding accounts, assigning roles and resetting passwords.
- **1.3 — hardening and day-to-day improvements.** Password storage moved to salted, iterated hashing in the browser build, sessions timed out after inactivity, and a local audit trail recorded sign-ins and account changes. The release also removed default accounts entirely — demo accounts only appeared when someone deliberately opened the demo, with a visible banner while they existed. Country presets set the currency from a country choice, search and filters were added across every list and to reports, medicine entry got faster with suggestions and restock handling, pharmacy gained buy prices with Admin-only profit reporting, and Settings gained a full backup download with a validated in-app restore.

The limits of that design were honest ones: records belonged to one browser on one device, and access control could only be enforced on that device. Version 2.0 is the answer for clinics that need shared data and server-enforced security.
