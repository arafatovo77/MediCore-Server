-- ============================================================================
-- MediCore Server Edition - PostgreSQL schema
--
-- This schema is the server-side data model for MediCore. All records are
-- stored in PostgreSQL and reached through the REST API; the application
-- never keeps clinic data in the browser.
--
-- Conventions: every record id is a text key handed out by the counters
-- table (P-1001..., D-101..., INV-5001..., ...), money is NUMERIC(12,2),
-- dates are DATE ('YYYY-MM-DD'), and appointments / invoices / lab orders
-- keep snapshot name columns (patient_name, doctor_name, test_name) next
-- to the foreign keys, so history stays readable after a register entry
-- is deleted.
--
-- Passwords are stored only as bcrypt hashes (password_hash). Roles:
--   Admin          - everything, incl. user management and settings
--   Receptionist   - patients / appointments / billing writes, lab-order creation
--   Pharmacist     - medicines write + dispensing only
--   Lab Technician - lab tests write, lab order creation, lab orders write
-- ============================================================================

-- Clinic profile shown in the app and on printed invoices/reports.
-- Single-row table: the only valid row has id = 1.
CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  clinic_name   TEXT NOT NULL DEFAULT 'MediCore Demo Clinic',
  address       TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  currency      TEXT NOT NULL DEFAULT '$',
  country       TEXT NOT NULL DEFAULT '',
  currency_code TEXT NOT NULL DEFAULT ''
);

-- ID generators. "value" is the NEXT numeric suffix to hand out for the
-- family: patient | doctor | appt | invoice | med | test | order |
-- dispense | user | purchase | expense.
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Starting points for a fresh install (the demo seed sets its own values).
INSERT INTO counters (name, value) VALUES
  ('patient',  1001),
  ('doctor',   101),
  ('appt',     1),
  ('invoice',  5001),
  ('med',      1),
  ('test',     1),
  ('order',    1),
  ('dispense', 1),
  ('user',     1),
  ('purchase', 1),
  ('expense',  1)
ON CONFLICT (name) DO NOTHING;

-- User accounts (ids "U-1", "U-2", ...). Passwords are bcrypt hashes,
-- verified on the server at login time. No plain passwords are stored.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL
                CHECK (role IN ('Admin','Receptionist','Pharmacist','Lab Technician')),
  created_at    DATE DEFAULT CURRENT_DATE
);

-- Patients register (ids "P-1001", "P-1002", ...)
CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  age        INTEGER DEFAULT 0,
  gender     TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  blood      TEXT DEFAULT '',
  created_by TEXT DEFAULT ''
);

-- Doctor directory (ids "D-101", "D-102", ...)
CREATE TABLE IF NOT EXISTS doctors (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  dept  TEXT DEFAULT '',
  qual  TEXT DEFAULT '',
  fee   NUMERIC(12,2) NOT NULL DEFAULT 0,
  days  TEXT DEFAULT '',
  "time" TEXT DEFAULT ''
);

-- Appointments (ids "A-1", "A-2", ...)
-- "token" is the per-doctor, per-day queue number assigned at booking
-- time; "seq" is the insertion sequence used for ordering.
CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  seq         BIGSERIAL,
  patient_id  TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT DEFAULT '',
  doctor_id   TEXT REFERENCES doctors(id) ON DELETE SET NULL,
  doctor_name TEXT DEFAULT '',
  date        DATE NOT NULL,
  token       INTEGER DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'Waiting'
              CHECK (status IN ('Waiting','In Consultation','Done','Cancelled')),
  created_by  TEXT DEFAULT ''
);

-- Invoices (ids "INV-5001", "INV-5002", ...)
-- subtotal = fee + SUM(items.qty * items.price); discount = subtotal *
-- discount_pct / 100; total = subtotal - discount; due = total - paid.
-- Status (Paid / Partial / Due) is derived by the API, not stored.
-- patient_id is NULL for walk-in patients typed by name.
CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  date         DATE NOT NULL,
  patient_id   TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  doctor_id    TEXT REFERENCES doctors(id) ON DELETE SET NULL,
  doctor_name  TEXT DEFAULT '',
  fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by   TEXT DEFAULT ''
);

-- Invoice line items. Deleted automatically with their invoice.
CREATE TABLE IF NOT EXISTS invoice_items (
  id         BIGSERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_desc  TEXT DEFAULT '',
  qty        NUMERIC(12,2) NOT NULL DEFAULT 1,
  price      NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Pharmacy medicines (ids "M-1", "M-2", ...)
-- This is the medicine master only: stock is computed from purchases
-- and sales, never stored here -- stock(medicine) = SUM(purchases.qty)
-- - SUM(pharmacy_sale_allocations.qty) over that medicine's purchases.
-- low_stock is the per-medicine low-stock threshold (default 10): a
-- medicine is low on stock when its computed stock <= low_stock.
CREATE TABLE IF NOT EXISTS medicines (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  generic   TEXT DEFAULT '',
  company   TEXT DEFAULT '',
  unit      TEXT DEFAULT '',
  pack_size TEXT DEFAULT '',
  price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  low_stock INTEGER NOT NULL DEFAULT 10
);

-- Upgrade path from v2.0.0, where medicines carried qty / cost_price /
-- expiry directly: add the new master columns and drop the old ones,
-- so db:init also works on a v2.0.0 database.
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS company TEXT DEFAULT '';
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT '';
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS pack_size TEXT DEFAULT '';
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS low_stock INTEGER NOT NULL DEFAULT 10;
ALTER TABLE medicines DROP COLUMN IF EXISTS qty;
ALTER TABLE medicines DROP COLUMN IF EXISTS cost_price;
ALTER TABLE medicines DROP COLUMN IF EXISTS expiry;

-- Pharmacy purchases / stock batches (ids "PUR-1", "PUR-2", ...)
-- One row per purchase batch of a medicine. medicine_name is a snapshot
-- of the medicine name at purchase time. The batch's remaining stock is
-- qty - SUM(pharmacy_sale_allocations.qty) over this purchase.
CREATE TABLE IF NOT EXISTS purchases (
  id             TEXT PRIMARY KEY,
  medicine_id    TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  medicine_name  TEXT DEFAULT '',
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  qty            INTEGER NOT NULL,
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  batch_no       TEXT DEFAULT '',
  expiry_date    DATE,
  supplier       TEXT DEFAULT '',
  created_by     TEXT DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pharmacy sales / dispense log (ids "S-1", "S-2", ...)
-- One row per dispense action; amount = qty * unit_price at time of sale.
-- unit_price / unit_cost are snapshotted at the moment of sale, so the
-- pharmacy profit (unit_price - unit_cost) * qty stays correct even if
-- prices change later. unit_cost is the weighted-average (FEFO) cost of
-- the batches the sale was allocated from, kept at NUMERIC(12,4) so the
-- average does not lose precision.
CREATE TABLE IF NOT EXISTS pharmacy_sales (
  id         TEXT PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  med_id     TEXT REFERENCES medicines(id) ON DELETE SET NULL,
  name       TEXT DEFAULT '',
  qty        INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) DEFAULT NULL,
  unit_cost  NUMERIC(12,4) DEFAULT NULL,
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by TEXT DEFAULT ''
);

-- Upgrade path from v2.0.0: widen unit_cost to four decimal places.
ALTER TABLE pharmacy_sales ALTER COLUMN unit_cost TYPE NUMERIC(12,4);

-- Pharmacy sale allocations: which purchase batches a sale drew from.
-- Dispensing allocates FEFO (earliest expiry first) and writes one row
-- per batch touched; unit_cost is that batch's purchase_price.
CREATE TABLE IF NOT EXISTS pharmacy_sale_allocations (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     TEXT NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL,
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Expenses register (ids "EXP-1", "EXP-2", ...)
CREATE TABLE IF NOT EXISTS expenses (
  id         TEXT PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  title      TEXT NOT NULL,
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  note       TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Laboratory test catalogue (ids "LT-1", "LT-2", ...)
CREATE TABLE IF NOT EXISTS lab_tests (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Laboratory orders (ids "LO-1", "LO-2", ...)
-- price and test_name are snapshots of the catalogue row at order time.
CREATE TABLE IF NOT EXISTS lab_orders (
  id           TEXT PRIMARY KEY,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  patient_id   TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT DEFAULT '',
  test_id      TEXT REFERENCES lab_tests(id) ON DELETE SET NULL,
  test_name    TEXT DEFAULT '',
  price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'Pending'
               CHECK (status IN ('Pending','Completed')),
  result       TEXT DEFAULT '',
  created_by   TEXT DEFAULT ''
);

-- Audit trail: sign-ins, account changes and other notable actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id     BIGSERIAL PRIMARY KEY,
  ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor  TEXT DEFAULT '',
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT ''
);

-- Indexes for the common lookups.
CREATE INDEX IF NOT EXISTS idx_appointments_date   ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, date);
CREATE INDEX IF NOT EXISTS idx_invoices_date       ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_patient    ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_sales_date          ON pharmacy_sales(date);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient  ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_purchases_medicine  ON purchases(medicine_id);
CREATE INDEX IF NOT EXISTS idx_purchases_expiry    ON purchases(expiry_date);
CREATE INDEX IF NOT EXISTS idx_allocations_purchase ON pharmacy_sale_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_allocations_sale    ON pharmacy_sale_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date       ON expenses(date);
