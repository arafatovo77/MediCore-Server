'use strict';

// Pharmacy purchases: one row per stock batch of a medicine.
//
// A purchase is how stock arrives -- there is no stored stock column
// on medicines. A batch's remaining stock is its qty minus the sale
// allocations drawn from it, and a medicine's stock is the sum of its
// batches' remaining stock. A batch that already has recorded sales
// cannot be deleted, because those allocations are the sales history.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { toNumber, isMoney, isPositiveQty, isValidDate } = require('../utils');

const router = express.Router();

const SELECT_PURCHASE =
  'SELECT p.id, p.medicine_id AS "medicineId", p.medicine_name AS "medicineName", ' +
  'p.date, p.qty, p.purchase_price AS "purchasePrice", p.batch_no AS "batchNo", ' +
  'p.expiry_date AS "expiryDate", p.supplier, ' +
  'COALESCE(a.allocated, 0) AS allocated, ' +
  '(p.qty - COALESCE(a.allocated, 0)) AS remaining, ' +
  'p.created_by AS "createdBy" ' +
  'FROM purchases p ' +
  'LEFT JOIN (SELECT purchase_id, SUM(qty) AS allocated FROM pharmacy_sale_allocations ' +
  'GROUP BY purchase_id) a ON a.purchase_id = p.id';

const ORDER_PURCHASES = ' ORDER BY p.date DESC, CAST(SPLIT_PART(p.id, \'-\', 2) AS INTEGER) DESC';

function presentPurchase(row) {
  if (!row) return null;
  return {
    ...row,
    qty: Number(row.qty),
    allocated: Number(row.allocated),
    remaining: Number(row.remaining),
    expiryDate: row.expiryDate || '',
  };
}

async function loadPurchase(id) {
  const result = await query(SELECT_PURCHASE + ' WHERE p.id = $1', [id]);
  return presentPurchase(result.rows[0] || null);
}

// GET /api/purchases - optional ?medicineId= filter. Purchase prices
// are cost data: only Admin and Pharmacist see the real value, every
// other role receives null (same discipline as medicines).
router.get('/purchases', authRequired, async (req, res, next) => {
  try {
    const seesCost = req.user.role === 'Admin' || req.user.role === 'Pharmacist';
    let result;
    if (req.query.medicineId) {
      result = await query(
        SELECT_PURCHASE + ' WHERE p.medicine_id = $1' + ORDER_PURCHASES,
        [String(req.query.medicineId)]
      );
    } else {
      result = await query(SELECT_PURCHASE + ORDER_PURCHASES);
    }
    const rows = result.rows.map((row) => {
      const purchase = presentPurchase(row);
      return seesCost ? purchase : { ...purchase, purchasePrice: null };
    });
    res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/purchases (pharmacy.write)
// {medicineId, qty, purchasePrice, batchNo, expiryDate, supplier, date}
router.post('/purchases', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const medicineResult = await query('SELECT id, name FROM medicines WHERE id = $1', [
      body.medicineId ? String(body.medicineId) : '',
    ]);
    if (medicineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Medicine not found' });
    }
    const medicine = medicineResult.rows[0];

    const qty = toNumber(body.qty, NaN);
    if (!isPositiveQty(qty)) {
      return res.status(400).json({ error: 'A positive quantity is required' });
    }
    const purchasePrice = toNumber(body.purchasePrice, 0);
    if (!isMoney(purchasePrice)) {
      return res.status(400).json({ error: 'Purchase price must be 0 or more' });
    }
    let expiryDate = null;
    if (body.expiryDate !== undefined && body.expiryDate !== null && body.expiryDate !== '') {
      expiryDate = String(body.expiryDate);
      if (!isValidDate(expiryDate)) {
        return res.status(400).json({ error: 'Expiry date must be a valid date (YYYY-MM-DD)' });
      }
    }
    let date = null;
    if (body.date !== undefined && body.date !== null && body.date !== '') {
      date = String(body.date);
      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Date must be a valid date (YYYY-MM-DD)' });
      }
    }

    const id = 'PUR-' + (await nextId(null, 'purchase'));
    await query(
      `INSERT INTO purchases
         (id, medicine_id, medicine_name, date, qty, purchase_price, batch_no, expiry_date, supplier, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8::date, $9, $10)`,
      [
        id,
        medicine.id,
        medicine.name,
        date,
        qty,
        purchasePrice,
        body.batchNo !== undefined && body.batchNo !== null ? String(body.batchNo) : '',
        expiryDate,
        body.supplier !== undefined && body.supplier !== null ? String(body.supplier) : '',
        req.user.username,
      ]
    );
    return res.status(201).json(await loadPurchase(id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/purchases/:id (pharmacy.write) - a batch with recorded
// sales cannot be deleted; its allocations are the sales history.
router.delete('/purchases/:id', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const existing = await query('SELECT id FROM purchases WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    const allocations = await query(
      'SELECT id FROM pharmacy_sale_allocations WHERE purchase_id = $1 LIMIT 1',
      [req.params.id]
    );
    if (allocations.rows.length > 0) {
      return res.status(400).json({ error: 'This batch already has recorded sales and cannot be deleted' });
    }
    await query('DELETE FROM purchases WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
