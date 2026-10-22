'use strict';

// Full data export (data.manage, Admin-only): every register in one
// JSON document, for backup or migration. Password hashes are never
// part of the export.

const express = require('express');
const { query } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { round2 } = require('../utils');

const router = express.Router();

// GET /api/export
router.get('/export', authRequired, requirePerm('data.manage'), async (req, res, next) => {
  try {
    const settingsResult = await query(
      'SELECT clinic_name AS "clinicName", address, phone, currency, country, ' +
      'currency_code AS "currencyCode" FROM settings WHERE id = 1'
    );
    const settings = settingsResult.rows[0] || {
      clinicName: 'MediCore Demo Clinic',
      address: '',
      phone: '',
      currency: '$',
      country: '',
      currencyCode: '',
    };

    const patients = await query(
      'SELECT id, name, age, gender, phone, address, blood, created_by AS "createdBy" ' +
      'FROM patients ORDER BY id'
    );
    const doctors = await query(
      'SELECT id, name, dept, qual, fee, days, "time" AS "time" FROM doctors ORDER BY id'
    );
    const appointments = await query(
      'SELECT id, patient_id AS "patientId", patient_name AS "patientName", ' +
      'doctor_id AS "doctorId", doctor_name AS "doctorName", date, token, status, ' +
      'created_by AS "createdBy" FROM appointments ORDER BY seq'
    );

    const invoiceResult = await query(
      'SELECT id, date, patient_id AS "patientId", patient_name AS "patientName", ' +
      'doctor_id AS "doctorId", doctor_name AS "doctorName", fee, discount_pct AS "discountPct", ' +
      'subtotal, discount, total, paid, created_by AS "createdBy" FROM invoices ORDER BY date, id'
    );
    const invoices = invoiceResult.rows;
    for (const invoice of invoices) {
      const items = await query(
        'SELECT item_desc AS "desc", qty, price FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
        [invoice.id]
      );
      invoice.items = items.rows;
      invoice.due = round2(Number(invoice.total) - Number(invoice.paid));
      invoice.status = Number(invoice.paid) >= Number(invoice.total)
        ? 'Paid'
        : Number(invoice.paid) > 0
          ? 'Partial'
          : 'Due';
    }

    const medicinesResult = await query(
      'SELECT id, name, generic, qty, price, cost_price AS "costPrice", expiry ' +
      'FROM medicines ORDER BY id'
    );
    const medicines = medicinesResult.rows.map((row) => ({ ...row, expiry: row.expiry || '' }));

    const pharmacySales = await query(
      'SELECT id, date, med_id AS "medId", name, qty, unit_price AS "unitPrice", ' +
      'unit_cost AS "unitCost", amount, created_by AS "createdBy" FROM pharmacy_sales ORDER BY id'
    );
    const labTests = await query('SELECT id, name, price FROM lab_tests ORDER BY id');
    const labOrders = await query(
      'SELECT id, date, patient_id AS "patientId", patient_name AS "patientName", ' +
      'test_id AS "testId", test_name AS "testName", price, status, result, ' +
      'created_by AS "createdBy" FROM lab_orders ORDER BY id'
    );
    const users = await query(
      'SELECT id, username, role, created_at AS "createdAt" FROM users ORDER BY id'
    );

    res.json({
      app: 'MediCore',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        settings,
        patients: patients.rows,
        doctors: doctors.rows,
        appointments: appointments.rows,
        invoices,
        medicines,
        pharmacySales: pharmacySales.rows,
        labTests: labTests.rows,
        labOrders: labOrders.rows,
        users: users.rows,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
