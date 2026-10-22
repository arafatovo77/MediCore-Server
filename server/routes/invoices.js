'use strict';

// Billing: invoices with line items. All totals are computed on the
// server - subtotal = fee + SUM(qty * price), discount = subtotal *
// discountPct / 100, total = subtotal - discount - each step rounded
// to two decimals. Status and due are derived, never stored.

const express = require('express');
const { pool, query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { round2, toNumber, isBlank, LIMITS, inRange, isMoney } = require('../utils');

const router = express.Router();

const SELECT_INVOICE =
  'SELECT id, date, patient_id AS "patientId", patient_name AS "patientName", ' +
  'doctor_id AS "doctorId", doctor_name AS "doctorName", fee, discount_pct AS "discountPct", ' +
  'subtotal, discount, total, paid, created_by AS "createdBy" FROM invoices';

function invoiceStatus(invoice) {
  if (Number(invoice.paid) >= Number(invoice.total)) return 'Paid';
  if (Number(invoice.paid) > 0) return 'Partial';
  return 'Due';
}

async function attachItems(runner, invoices) {
  for (const invoice of invoices) {
    const items = await runner.query(
      'SELECT item_desc AS "desc", qty, price FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [invoice.id]
    );
    invoice.items = items.rows;
    invoice.due = round2(Number(invoice.total) - Number(invoice.paid));
    invoice.status = invoiceStatus(invoice);
  }
  return invoices;
}

async function loadInvoice(runner, id) {
  const result = await runner.query(SELECT_INVOICE + ' WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  const list = await attachItems(runner, result.rows);
  return list[0];
}

// GET /api/invoices
router.get('/invoices', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_INVOICE + ' ORDER BY date, id');
    res.json(await attachItems({ query }, result.rows));
  } catch (err) {
    return next(err);
  }
});

// POST /api/invoices (billing.write) - invoice + items in one transaction.
router.post('/invoices', authRequired, requirePerm('billing.write'), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    const body = req.body || {};
    if (isBlank(body.patientName)) {
      return res.status(400).json({ error: 'Patient name is required' });
    }
    if (isBlank(body.date)) {
      return res.status(400).json({ error: 'Invoice date is required' });
    }
    const fee = toNumber(body.fee, 0);
    const discountPct = toNumber(body.discountPct, 0);
    const items = Array.isArray(body.items) ? body.items : [];
    const cleanItems = items.map((item) => ({
      desc: item && item.desc !== undefined ? String(item.desc) : '',
      qty: toNumber(item && item.qty, 1),
      price: toNumber(item && item.price, 0),
    }));
    // Range-check every number before it reaches the totals below.
    if (!isMoney(fee)) {
      return res.status(400).json({ error: 'Fee must be 0 or more' });
    }
    if (!inRange(discountPct, 0, 100)) {
      return res.status(400).json({ error: 'Discount must be between 0 and 100 percent' });
    }
    for (const item of cleanItems) {
      if (!(item.qty > 0) || item.qty > LIMITS.quantity) {
        return res.status(400).json({ error: 'Item quantity must be greater than zero' });
      }
      if (!isMoney(item.price)) {
        return res.status(400).json({ error: 'Item price must be 0 or more' });
      }
    }

    const itemsTotal = cleanItems.reduce((sum, item) => sum + item.qty * item.price, 0);
    const subtotal = round2(fee + itemsTotal);
    const discount = round2((subtotal * discountPct) / 100);
    const total = round2(subtotal - discount);
    const paid = body.paid !== undefined ? toNumber(body.paid, 0) : 0;
    if (!isMoney(paid)) {
      return res.status(400).json({ error: 'Paid amount must be 0 or more' });
    }

    await client.query('BEGIN');
    const id = 'INV-' + (await nextId(client, 'invoice'));
    await client.query(
      `INSERT INTO invoices
         (id, date, patient_id, patient_name, doctor_id, doctor_name, fee,
          discount_pct, subtotal, discount, total, paid, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        String(body.date),
        body.patientId ? String(body.patientId) : null,
        String(body.patientName),
        body.doctorId ? String(body.doctorId) : null,
        body.doctorName ? String(body.doctorName) : '',
        fee,
        discountPct,
        subtotal,
        discount,
        total,
        paid,
        req.user.username,
      ]
    );
    for (const item of cleanItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, item_desc, qty, price) VALUES ($1, $2, $3, $4)',
        [id, item.desc, item.qty, item.price]
      );
    }
    await client.query('COMMIT');
    return res.status(201).json(await loadInvoice({ query }, id));
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* no transaction open */ }
    }
    return next(err);
  } finally {
    if (client) client.release();
  }
});

// POST /api/invoices/:id/payment (billing.write) {amount}
router.post('/invoices/:id/payment', authRequired, requirePerm('billing.write'), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    const amount = toNumber(req.body && req.body.amount, NaN);
    if (!isMoney(amount) || amount <= 0) {
      return res.status(400).json({ error: 'A positive payment amount is required' });
    }
    await client.query('BEGIN');
    const found = await client.query('SELECT id, paid FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const newPaid = round2(Number(found.rows[0].paid) + amount);
    await client.query('UPDATE invoices SET paid = $2 WHERE id = $1', [req.params.id, newPaid]);
    await client.query('COMMIT');
    return res.json(await loadInvoice({ query }, req.params.id));
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* no transaction open */ }
    }
    return next(err);
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/invoices/:id (billing.write) - line items go with it.
router.delete('/invoices/:id', authRequired, requirePerm('billing.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invoice not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
