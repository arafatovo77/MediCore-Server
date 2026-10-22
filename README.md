# MediCore — Clinic & Hospital Management System (Server Edition)

MediCore Server Edition is a complete management system for small and mid-sized clinics and hospitals, built as a proper client-server application. A Node.js and Express backend serves a browser frontend and a REST API, and every record is stored centrally in PostgreSQL — so reception, pharmacy and lab counters all work on the same live data at the same time, from any device with a browser on the clinic network.

We built this edition for clinics that have outgrown a single desk register — paper books, spreadsheets, or a single-device app — and need shared data, enforced logins and reliable backups without paying a monthly subscription or handing patient records to a third-party cloud. You install it on your own server, you set your own clinic name, and your data stays in your own database.

## Modules & Features

**Dashboard**
- Today's appointment count, total patients, doctor count and today's revenue (invoice payments plus pharmacy sales)
- Pharmacy profit panel — profit today, this month and all time, calculated as sales revenue minus cost of goods sold and pharmacy expenses — visible to Admin only
- Automatic alerts for batches that have expired or expire within 30 days, and for medicines at or below their low-stock threshold
- Recent appointments at a glance

**Patients**
- Registration with auto-generated IDs (P-1001, P-1002, …), age, gender, phone, address and blood group
- Search by name, phone or ID
- Per-patient visit history: appointments, invoices and lab orders in one view

**Doctors**
- Doctor directory with department, qualification, consultation fee, available days and hours
- Add, edit and delete doctors (Admin)

**Appointments**
- Book by selecting an existing patient or quick-adding a new one (name and phone)
- Automatic serial / token number per doctor per day
- Daily queue view with doctor and status filters, and a status flow: Waiting → In Consultation → Done / Cancelled

**Billing**
- Invoices combining a doctor's consultation fee (auto-filled) with any number of service or lab line items (quantity × price)
- Percentage discount, partial payments and automatic due tracking (Paid / Partial / Due)
- Receive payments against outstanding dues; all totals are calculated on the server
- Clean, printable invoice carrying your clinic's name, address and phone

**Pharmacy**
- Batch-based stock: a medicine record is master data only — name, generic, company, unit, pack size, selling price and low-stock threshold
- Stock arrives only through purchase entries (date, quantity, per-unit purchase price, batch number, expiry date and supplier); each batch is stored separately with its own price and expiry
- No manual stock editing anywhere — this is a product guarantee: purchases add stock, dispensing removes it, and the on-hand figure is computed from those movements, so the stock on screen always matches the purchases and sales on record
- Dispensing allocates batches FEFO — earliest expiry first, with batches that have no expiry date used last — on the server in the same transaction that records the sale, so two counters cannot sell the same last units twice. The batches used for each sale are recorded, and the sale's unit cost is stored as the weighted average of those batches, so later price changes never rewrite past figures
- Pharmacy expenses (date, title, amount and note) can be recorded under Pharmacy
- Pharmacy profit for a period is sales revenue − cost of goods sold − expenses; profit figures are visible to Admin only
- Alerts for batches that have expired or expire within 30 days, and for medicines at or below their low-stock threshold, highlighted in the pharmacy list and on the dashboard

**Laboratory**
- Test catalogue with prices; order tests for any patient
- Result workflow: Pending → Completed, with the result value recorded
- Printable lab report on your clinic's letterhead

**Reports**
- Daily and monthly collections (invoice payments plus pharmacy sales)
- Appointments by doctor, and top medicines by quantity and sales value
- Stock Report: per medicine, the last purchase price, the sell price, the current stock quantity and the stock value (the sum over batches of remaining quantity × batch purchase price), with a total stock value for the pharmacy. Cost-derived figures are shown only to Admin and Pharmacist accounts, as with all buy and cost data
- Period filter (All time / Today / Last 7 days / This month) with a period overview, including the period's pharmacy profit (sales revenue − cost of goods sold − expenses) for Admin

**Settings**
- Clinic name, address and phone — shown in the app and on every printed invoice and lab report. You set your own clinic name after install; printed documents carry your name, not ours
- Country presets for currency: pick from 16 countries and MediCore fills in the currency symbol and ISO code (for example Bangladesh → ৳ / BDT, India → ₹ / INR, United States → $ / USD). The symbol stays editable if you need a custom one
- User account management (Admin only): create accounts, assign roles, reset passwords
- Security audit trail: sign-ins and user-management actions are recorded in the database and viewable by Admin
- Data export (Admin only): download a full JSON export of your records from Settings

Search and filters are available across the lists — patients, doctors, appointments, invoices, medicines, lab tests and lab orders — so any record can be found in seconds.

## Architecture

```
  Browser (any device on the clinic network)
      │
      │  HTTPS / HTTP — pages + JSON calls to /api
      ▼
  Express app  (Node.js 20, server/)
      │  serves public/index.html
      │  REST API with JWT check + role check
      │  on every mutating route
      ▼
  PostgreSQL 16
      patients · doctors · appointments · invoices
      medicines · purchases · pharmacy sales · pharmacy sale allocations
      expenses · lab tests · lab orders
      users · settings · audit log
```

**Folder layout**

```
server/          Backend — entry point, Express app, database pool,
                 auth middleware and one route file per resource
public/          Frontend — index.html, served by the app, talks to /api
database/        schema.sql (tables) and seed.sql (optional demo data)
README.md        This file
HowToSetup.md    Step-by-step install guide (Docker and bare server)
AGENTS.md        Guide for developers extending the code
CHANGELOG.md     Release history
```

Because the data lives on the server, this edition is multi-user and multi-counter by design: the reception desk, the pharmacy and the lab sign in at the same time and see each other's work immediately. There is no sync step and no single "main" device to protect.

One data note matters for the pharmacy: stock is not stored as a number on the medicine record. Medicines hold master data only; purchase batches hold what arrived, at what price and with what expiry, and pharmacy sale allocations record which batches each sale drew from. The on-hand figure is computed from those movements, and stock value is the sum over batches of remaining quantity × batch purchase price.

## Security Model

- **No default accounts.** The package ships with zero users. On first run, the first visitor creates the Admin account on the setup screen. The setup endpoint (`POST /api/setup/admin`) works only while zero users exist and is closed after that.
- **Passwords hashed on the server.** Passwords are hashed with bcrypt on the server before storage. Plain passwords are never stored, and password checks never happen in the browser.
- **Signed sessions with an expiry.** Sign-in returns a JSON Web Token (JWT), 8 hours by default (`JWT_EXPIRES_IN`). Expired tokens are rejected by the API. There is no default signing secret: the server refuses to start until `JWT_SECRET` holds a strong random value, and sign-in attempts are rate-limited per address to slow down password guessing.
- **Buy prices stay in the pharmacy.** Purchase and buy prices — including the cost-derived figures in the Stock Report — are returned only to Admin and Pharmacist accounts; pharmacy profit figures are Admin-only, and every other role receives no cost data at all.
- **Role check on every mutating route.** Each create, update, delete, dispense, payment and settings route runs role middleware on the server. Hiding a button in the frontend is never the only protection — the API itself refuses work a role is not allowed to do.
- **Money and stock move on the server.** Invoice totals, discounts and payments are calculated and written inside server-side transactions, and pharmacy stock is never written directly by anyone — it changes only through a recorded purchase or a dispensing transaction — so a tampered or out-of-date browser cannot invent a total or a stock level.
- **Audit trail.** Sign-ins and user-management actions (account created, deleted, password reset) are written to an audit log in the database, viewable by Admin in Settings.
- **Your server, your responsibility.** Run it behind HTTPS (see `HowToSetup.md`), keep `JWT_SECRET` long and private, and take regular database backups. MediCore gives you enforced access control; the security of the server it runs on is yours.

### Roles

| Role | Can change |
|---|---|
| **Admin** | Everything — patients, doctors, appointments, billing, pharmacy, lab, settings, user accounts and data export |
| **Receptionist** | Patients, appointments, billing (invoices and payments), and creating lab orders |
| **Pharmacist** | Medicines, purchase entries and pharmacy expenses, and dispensing |
| **Lab Technician** | Lab test catalogue, lab orders and result entry, and creating lab orders |

Everyone signed in can view the areas their work touches. Settings, user accounts and export are Admin-only, and pharmacy profit is Admin-only.

## Quick Start (Docker Compose)

You need a machine with Docker and the Compose plugin. Full instructions, including a bare-server install without Docker, are in `HowToSetup.md`.

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and a long, random JWT_SECRET.
# Compose reads .env and passes both values to the services, so the
# app and the database always share the same password (see HowToSetup.md).

docker compose up -d
```

Then open:

```
http://localhost:3000
```

The first screen asks you to create the Admin account. Create it, sign in, go to **Settings**, fill in your clinic name, address and phone, pick your country for the currency, and add accounts for your staff. That is the whole setup.

Useful commands:

```bash
npm run db:init   # Apply the database schema (bare installs; the Docker
                  # image applies it automatically on every start)
npm run db:seed   # Also load the demo data (optional, see below)
```

With Docker, run the seed inside the app container: `docker compose exec app npm run db:seed`.

## Demo Data

`database/seed.sql` loads a complete sample clinic — sample patients, doctors, appointments, sample medicines, a lab catalogue, lab orders and invoices — so you can evaluate every module before entering real records. Load it with `npm run db:seed`. The demo medicine stock arrives as purchase batches, as all stock does, so the pharmacy screens, alerts and Stock Report work on demo data the same way they work on your own records.

The seed also creates four demo accounts:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `reception` | `reception123` | Receptionist |
| `pharmacy` | `pharma123` | Pharmacist |
| `lab` | `labtech123` | Lab Technician |

The passwords are stored in the seed as bcrypt hashes. These accounts are for evaluation and training only — **delete them before using MediCore with real patient data.**

## Backups and Export

- **Full backup:** use a standard PostgreSQL dump (`pg_dump`) — that is the complete, restorable backup of your database. See `HowToSetup.md` for the command and a sensible routine.
- **Data export:** an Admin can download a full JSON export from **Settings** (`GET /api/export`). This is handy for inspection and migration.
- **Please note:** the server edition has no in-app restore. Restoring means restoring a PostgreSQL dump with standard PostgreSQL tools, as covered in `HowToSetup.md`. (One-click restore inside the app was a feature of the single-file edition, where the data lived in the browser.)

## Tech Notes

- Node.js 20, Express 4, PostgreSQL 16; passwords with bcrypt; sessions with JWT
- Frontend is a single HTML file in `public/`, served by the app — no build step, no separate frontend deployment
- Responsive layout: full sidebar on desktop, compact navigation on phones and tablets
- Printing uses a dedicated print layout, so invoices and lab reports come out clean on A4/Letter

## Licence

Commercial **single-buyer licence**: the purchaser may use and modify MediCore for one clinic/hospital organisation (including its own branches under the same ownership). Redistribution, resale or sublicensing of the source, modified or not, is not included in this licence. The software is provided "as is", without warranty; it is a management aid and does not replace professional, legal or clinical record-keeping obligations.

---

MediCore Server Edition v2.1.0 · Developed by Arafat
