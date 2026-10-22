-- ============================================================================
-- MediCore Server Edition - demo dataset (PostgreSQL)
--
-- Demo data for evaluation only. These rows reproduce the standard
-- MediCore demo set: 5 doctors, 8 patients, 7 appointments for today,
-- 8 medicines, 6 lab tests, 2 lab orders, 2 invoices and 2 pharmacy
-- sales, plus the demo settings and the counter values that follow
-- from them. Appointments, lab orders, invoices and sales are stamped
-- with CURRENT_DATE, so run this seed on the day you want the demo to
-- appear "live".
--
-- The seed also creates four demo user accounts (admin, reception,
-- pharmacy, lab). Their passwords are stored as bcrypt hashes of the
-- documented demo passwords:
--   admin / admin123 - reception / reception123
--   pharmacy / pharma123 - lab / labtech123
-- Demo accounts are for evaluation only - delete them before real use.
--
-- Run schema.sql first (node server/initdb.js --seed does both).
-- ============================================================================

-- Settings
INSERT INTO settings (id, clinic_name, address, phone, currency, country, currency_code) VALUES
  (1, 'MediCore Demo Clinic', '123 Wellness Avenue', '+1 555 010 2233', '$', '', '')
ON CONFLICT (id) DO NOTHING;

-- Doctors (D-101 ... D-105)
INSERT INTO doctors (id, name, dept, qual, fee, days, "time") VALUES
  ('D-101', 'Dr. Sarah Ahmed',  'General Medicine', 'MBBS, FCPS', 30.00, 'Mon – Sat', '9 AM – 1 PM'),
  ('D-102', 'Dr. James Carter', 'Cardiology',       'MD, FACC',   60.00, 'Sun – Thu', '4 PM – 8 PM'),
  ('D-103', 'Dr. Priya Nair',   'Pediatrics',       'MBBS, DCH',  35.00, 'Mon – Fri', '10 AM – 2 PM'),
  ('D-104', 'Dr. Michael Ross', 'Orthopedics',      'MS (Ortho)', 55.00, 'Tue – Sat', '11 AM – 3 PM'),
  ('D-105', 'Dr. Elena Petrova','Dermatology',      'MD (Derm)',  45.00, 'Mon – Thu', '3 PM – 7 PM')
ON CONFLICT (id) DO NOTHING;

-- Patients (P-1001 ... P-1008)
INSERT INTO patients (id, name, age, gender, phone, address, blood) VALUES
  ('P-1001', 'Ayesha Rahman', 28, 'Female', '+1 555 100 2001', '12 Rosewood Lane', 'B+'),
  ('P-1002', 'Daniel Kim',    45, 'Male',   '+1 555 100 2002', '48 Harbor Street', 'O+'),
  ('P-1003', 'Maria Garcia',  33, 'Female', '+1 555 100 2003', '9 Sunset Blvd',    'A-'),
  ('P-1004', 'John Miller',   61, 'Male',   '+1 555 100 2004', '77 Maple Drive',   'AB+'),
  ('P-1005', 'Fatima Noor',   24, 'Female', '+1 555 100 2005', '3 Garden Court',   'O-'),
  ('P-1006', 'Peter Novak',   52, 'Male',   '+1 555 100 2006', '210 River Road',   'A+'),
  ('P-1007', 'Lucy Chen',      8, 'Female', '+1 555 100 2007', '5 Cherry Close',   'B-'),
  ('P-1008', 'Omar Haddad',   39, 'Male',   '+1 555 100 2008', '66 Cedar Avenue',  'AB-')
ON CONFLICT (id) DO NOTHING;

-- Medicines (M-1 ... M-8) - Ibuprofen is deliberately low-stock (8) and
-- Cough Relief Syrup deliberately expired (2025-08-31).
INSERT INTO medicines (id, name, generic, qty, price, cost_price, expiry) VALUES
  ('M-1', 'Paracetamol 500mg',       'Acetaminophen',    240, 0.10, 0.07, '2027-03-31'),
  ('M-2', 'Amoxicillin 250mg',        'Amoxicillin',      120, 0.35, 0.25, '2026-12-15'),
  ('M-3', 'Ibuprofen 400mg',          'Ibuprofen',          8, 0.15, 0.11, '2027-01-31'),
  ('M-4', 'Cetirizine 10mg',          'Cetirizine HCl',   180, 0.08, 0.06, '2027-06-30'),
  ('M-5', 'Omeprazole 20mg',          'Omeprazole',        95, 0.22, 0.16, '2026-11-30'),
  ('M-6', 'Vitamin D3 1000 IU',       'Cholecalciferol',  150, 0.30, 0.22, '2027-09-30'),
  ('M-7', 'Cough Relief Syrup 100ml', 'Dextromethorphan',  40, 2.50, 1.80, '2025-08-31'),
  ('M-8', 'Antiseptic Cream 30g',     'Chlorhexidine',     60, 1.80, 1.30, '2027-02-28')
ON CONFLICT (id) DO NOTHING;

-- Lab test catalogue (LT-1 ... LT-6)
INSERT INTO lab_tests (id, name, price) VALUES
  ('LT-1', 'Complete Blood Count (CBC)', 12.00),
  ('LT-2', 'Fasting Blood Sugar',         6.00),
  ('LT-3', 'ECG',                        15.00),
  ('LT-4', 'Chest X-Ray',                25.00),
  ('LT-5', 'Urine Routine Examination',   8.00),
  ('LT-6', 'Lipid Profile',              20.00)
ON CONFLICT (id) DO NOTHING;

-- Appointments (A-1 ... A-7), all today, tokens per doctor per day.
INSERT INTO appointments (id, patient_id, patient_name, doctor_id, doctor_name, date, token, status) VALUES
  ('A-1', 'P-1001', 'Ayesha Rahman', 'D-101', 'Dr. Sarah Ahmed',  CURRENT_DATE, 1, 'Done'),
  ('A-2', 'P-1002', 'Daniel Kim',    'D-102', 'Dr. James Carter', CURRENT_DATE, 1, 'In Consultation'),
  ('A-3', 'P-1003', 'Maria Garcia',  'D-101', 'Dr. Sarah Ahmed',  CURRENT_DATE, 2, 'Waiting'),
  ('A-4', 'P-1004', 'John Miller',   'D-104', 'Dr. Michael Ross', CURRENT_DATE, 1, 'Waiting'),
  ('A-5', 'P-1005', 'Fatima Noor',   'D-105', 'Dr. Elena Petrova',CURRENT_DATE, 1, 'Done'),
  ('A-6', 'P-1007', 'Lucy Chen',     'D-103', 'Dr. Priya Nair',   CURRENT_DATE, 1, 'Waiting'),
  ('A-7', 'P-1006', 'Peter Novak',   'D-102', 'Dr. James Carter', CURRENT_DATE, 2, 'Waiting')
ON CONFLICT (id) DO NOTHING;

-- Invoices (INV-5001 fully paid; INV-5002 at 10% discount, part paid)
INSERT INTO invoices (id, date, patient_id, patient_name, doctor_id, doctor_name, fee, discount_pct, subtotal, discount, total, paid) VALUES
  ('INV-5001', CURRENT_DATE, 'P-1001', 'Ayesha Rahman', 'D-101', 'Dr. Sarah Ahmed',  30.00,  0, 48.00, 0.00, 48.00, 48.00),
  ('INV-5002', CURRENT_DATE, 'P-1002', 'Daniel Kim',    'D-102', 'Dr. James Carter', 60.00, 10, 75.00, 7.50, 67.50, 30.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_items (invoice_id, item_desc, qty, price) VALUES
  ('INV-5001', 'Complete Blood Count (CBC)', 1, 12.00),
  ('INV-5001', 'Fasting Blood Sugar',        1,  6.00),
  ('INV-5002', 'ECG',                        1, 15.00);

-- Lab orders (LO-1 completed, LO-2 pending)
INSERT INTO lab_orders (id, date, patient_id, patient_name, test_id, test_name, price, status, result) VALUES
  ('LO-1', CURRENT_DATE, 'P-1001', 'Ayesha Rahman', 'LT-1', 'Complete Blood Count (CBC)', 12.00, 'Completed', 'Within normal range'),
  ('LO-2', CURRENT_DATE, 'P-1002', 'Daniel Kim',    'LT-3', 'ECG',                        15.00, 'Pending',   '')
ON CONFLICT (id) DO NOTHING;

-- Pharmacy sales (S-1, S-2) - revenue today 2.80, profit today 0.80.
INSERT INTO pharmacy_sales (id, date, med_id, name, qty, unit_price, unit_cost, amount) VALUES
  ('S-1', CURRENT_DATE, 'M-1', 'Paracetamol 500mg', 20, 0.10, 0.07, 2.00),
  ('S-2', CURRENT_DATE, 'M-4', 'Cetirizine 10mg',   10, 0.08, 0.06, 0.80)
ON CONFLICT (id) DO NOTHING;

-- Demo user accounts (U-1 ... U-4) - evaluation only, delete before
-- real use. password_hash is a bcrypt hash of the demo password noted
-- in the header above. The demo accounts are inserted ONLY when the
-- users table is completely empty: if an Admin was already created
-- through the setup screen, the seed leaves accounts untouched (the
-- demo clinic data above still loads), so a half-seeded set of demo
-- logins can never appear.
INSERT INTO users (id, username, password_hash, role, created_at)
SELECT v.id, v.username, v.password_hash, v.role, CURRENT_DATE
FROM (VALUES
  ('U-1', 'admin',     '$2a$10$JK5T7u1YKfA1aQ1J4BYDdOQ9T6ayE2XYxHnHz2uoIgaEqsKmWi8fS', 'Admin'),
  ('U-2', 'reception', '$2a$10$DW7pyys7apUAG7qwJxMR2Oy7u7FqgLzb3pLzI9S9Epkshk.OeaT7e', 'Receptionist'),
  ('U-3', 'pharmacy',  '$2a$10$WT54zl8h8OgnrwZ.2jc68Op/8NAG9fi4Qn2Imnbm/GhfgKaznjtWW', 'Pharmacist'),
  ('U-4', 'lab',       '$2a$10$z1RB0CXblIYMG09xYj.RRuwd2fD0/Ld.hYJCAR9P3EogDcbfPzDuC', 'Lab Technician')
) AS v(id, username, password_hash, role)
WHERE NOT EXISTS (SELECT 1 FROM users);

-- Counters after the demo data (the next ID each family hands out).
INSERT INTO counters (name, value) VALUES
  ('patient',  1009),
  ('doctor',   106),
  ('appt',     8),
  ('invoice',  5003),
  ('med',      9),
  ('test',     7),
  ('order',    3),
  ('dispense', 3),
  ('user',     5)
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
