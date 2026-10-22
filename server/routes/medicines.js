'use strict';

// Pharmacy: medicine stock, dispensing and the sales log.
//
// Dispensing runs in one transaction: the medicine row is locked, the
// stock is checked and decremented, and a sale row is inserted with
// the sell price and buy price snapshotted at that moment, so profit
// stays correct if prices change later. When a medicine has no buy
// price recorded, the sale's unit cost falls back to the sell price
// (profit 0 for that sale).

const express = require('express');
const { pool, query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { round2, toNumber, isBlank, LIMITS, isMoney, isStockQty } = require('../utils');

const router = express.Router();

const SELECT_MEDICINE =
  'SELECT id, name, generic, qty, price, cost_price AS "costPrice", expiry FROM medicines';

const SELECT_SALE =
  'SELECT id, date, med_id AS "medId", name, qty, unit_price AS "unitPrice", ' +
  'unit_cost AS "unitCost", amount, created_by AS "createdBy" FROM pharmacy_sales';

function presentMedicine(row) {
  if (!row) return null;
  return { ...row, expiry: row.expiry || '' };
}

async function loadMedicine(runner, id) {
  const result = await runner.query(SELECT_MEDICINE + ' WHERE id = $1', [id]);
  return presentMedicine(result.rows[0] || null);
}

function medicineFields(body, base) {
  const src = body || {};
  const cur = base || {};
  let costPrice;
  if (src.costPrice !== undefined) {
    costPrice = src.costPrice === null || src.costPrice === '' ? null : toNumber(src.costPrice, null);
  } else {
    costPrice = cur.costPrice !== undefined ? cur.costPrice : null;
  }
  return {
    name: src.name !== undefined ? String(src.name) : cur.name || '',
    generic: src.generic !== undefined ? String(src.generic) : cur.generic || '',
    qty: src.qty !== undefined ? Math.trunc(toNumber(src.qty, 0)) : cur.qty || 0,
    price: src.price !== undefined ? toNumber(src.price, 0) : cur.price || 0,
    costPrice,
    expiry: src.expiry !== undefined ? src.expiry || null : cur.expiry || null,
  };
}

// GET /api/medicines - buy prices (costPrice) go only to the roles
// that manage pharmacy pricing (Admin, Pharmacist); every other role
// receives null in that field, mirroring the pharmacy-sales rule.
router.get('/medicines', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_MEDICINE + ' ORDER BY id');
    const seesCost = req.user.role === 'Admin' || req.user.role === 'Pharmacist';
    const rows = result.rows.map((row) => {
      const med = presentMedicine(row);
      return seesCost ? med : { ...med, costPrice: null };
    });
    res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Range-check the numeric fields of a medicine record before they
// are stored; returns an error message, or null when all are in range.
function medicineRangeError(fields) {
  if (!isStockQty(fields.qty)) return 'Stock quantity must be a whole number of 0 or more';
  if (!isMoney(fields.price)) return 'Sell price must be 0 or more';
  if (fields.costPrice !== null && !isMoney(fields.costPrice)) return 'Buy price must be 0 or more';
  return null;
}

// POST /api/medicines (pharmacy.write)
router.post('/medicines', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    if (!req.body || isBlank(req.body.name)) {
      return res.status(400).json({ error: 'Medicine name is required' });
    }
    const fields = medicineFields(req.body, null);
    const rangeError = medicineRangeError(fields);
    if (rangeError) return res.status(400).json({ error: rangeError });
    const id = 'M-' + (await nextId(null, 'med'));
    await query(
      `INSERT INTO medicines (id, name, generic, qty, price, cost_price, expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, fields.name, fields.generic, fields.qty, fields.price, fields.costPrice, fields.expiry]
    );
    return res.status(201).json(await loadMedicine({ query }, id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/medicines/:id (pharmacy.write)
router.put('/medicines/:id', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const existing = await loadMedicine({ query }, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Medicine not found' });
    const fields = medicineFields(req.body, existing);
    if (isBlank(fields.name)) {
      return res.status(400).json({ error: 'Medicine name is required' });
    }
    const rangeError = medicineRangeError(fields);
    if (rangeError) return res.status(400).json({ error: rangeError });
    await query(
      `UPDATE medicines SET name = $2, generic = $3, qty = $4, price = $5, cost_price = $6, expiry = $7
       WHERE id = $1`,
      [req.params.id, fields.name, fields.generic, fields.qty, fields.price, fields.costPrice, fields.expiry]
    );
    return res.json(await loadMedicine({ query }, req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/medicines/:id (pharmacy.write)
router.delete('/medicines/:id', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM medicines WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Medicine not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/medicines/:id/dispense (pharmacy.dispense) {qty}
router.post('/medicines/:id/dispense', authRequired, requirePerm('pharmacy.dispense'), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    const qty = Math.trunc(toNumber(req.body && req.body.qty, NaN));
    if (!Number.isFinite(qty) || qty <= 0 || qty > LIMITS.quantity) {
      return res.status(400).json({ error: 'A positive quantity is required' });
    }
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM medicines WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Medicine not found' });
    }
    const medicine = found.rows[0];
    if (Number(medicine.qty) < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient stock' });
    }
    const newQty = Number(medicine.qty) - qty;
    await client.query('UPDATE medicines SET qty = $2 WHERE id = $1', [req.params.id, newQty]);

    const saleId = 'S-' + (await nextId(client, 'dispense'));
    const unitPrice = Number(medicine.price);
    const unitCost = medicine.cost_price === null || medicine.cost_price === undefined
      ? unitPrice
      : Number(medicine.cost_price);
    const amount = round2(qty * unitPrice);
    const saleResult = await client.query(
      `INSERT INTO pharmacy_sales
         (id, date, med_id, name, qty, unit_price, unit_cost, amount, created_by)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [saleId, medicine.id, medicine.name, qty, unitPrice, unitCost, amount, req.user.username]
    );
    await client.query('COMMIT');

    const saleRow = await query(SELECT_SALE + ' WHERE id = $1', [saleRowId(saleResult)]);
    const updatedMedicine = await loadMedicine({ query }, req.params.id);
    return res.status(201).json({ sale: saleRow.rows[0], medicine: updatedMedicine });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* no transaction open */ }
    }
    return next(err);
  } finally {
    if (client) client.release();
  }
});

function saleRowId(result) {
  return result.rows[0].id;
}

// POST /api/medicines/:id/restock (pharmacy.write) {qty, expiry?}
router.post('/medicines/:id/restock', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    const qty = Math.trunc(toNumber(req.body && req.body.qty, NaN));
    if (!Number.isFinite(qty) || qty <= 0 || qty > LIMITS.quantity) {
      return res.status(400).json({ error: 'A positive quantity is required' });
    }
    await client.query('BEGIN');
    const found = await client.query('SELECT id, qty FROM medicines WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Medicine not found' });
    }
    const newQty = Number(found.rows[0].qty) + qty;
    if (req.body && req.body.expiry !== undefined) {
      await client.query(
        'UPDATE medicines SET qty = $2, expiry = $3 WHERE id = $1',
        [req.params.id, newQty, req.body.expiry || null]
      );
    } else {
      await client.query('UPDATE medicines SET qty = $2 WHERE id = $1', [req.params.id, newQty]);
    }
    await client.query('COMMIT');
    return res.json(await loadMedicine({ query }, req.params.id));
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* no transaction open */ }
    }
    return next(err);
  } finally {
    if (client) client.release();
  }
});

// GET /api/pharmacy-sales - buy prices (unitCost) are Admin-only:
// every other role receives null in that field.
router.get('/pharmacy-sales', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_SALE + ' ORDER BY id');
    const isAdmin = req.user.role === 'Admin';
    const rows = result.rows.map((row) => (isAdmin ? row : { ...row, unitCost: null }));
    res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
