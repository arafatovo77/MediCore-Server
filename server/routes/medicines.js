'use strict';

// Pharmacy: medicine master, dispensing and the sales log.
//
// Medicines are a master record only (name, sell price, low-stock
// threshold): stock is COMPUTED, never stored -- it is the sum of
// purchase batches minus what sales have drawn from them (see
// routes/purchases.js). Dispensing runs in one transaction: the
// medicine row is locked, the medicine's batches are read oldest
// expiry first (FEFO), the sale is allocated greedily across those
// batches, and a sale row is inserted with the sell price snapshotted
// and the unit cost set to the weighted average of the batches used,
// so profit stays correct if prices change later.

const express = require('express');
const { pool, query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { round2, toNumber, isBlank, LIMITS, isMoney, isStockQty } = require('../utils');

const router = express.Router();

// Master fields only, plus the computed enrichment: stock (total
// remaining across the medicine's batches), lastPurchasePrice (the
// purchase_price of the most recent purchase) and nextExpiry (the
// earliest expiry_date among batches that still have stock left).
const SELECT_MEDICINE =
  'SELECT m.id, m.name, m.generic, m.company, m.unit, m.pack_size AS "packSize", ' +
  'm.price, m.low_stock AS "lowStock", ' +
  'COALESCE((SELECT SUM(p.qty) FROM purchases p WHERE p.medicine_id = m.id), 0) - ' +
  'COALESCE((SELECT SUM(a.qty) FROM pharmacy_sale_allocations a ' +
  'JOIN purchases p2 ON p2.id = a.purchase_id WHERE p2.medicine_id = m.id), 0) AS stock, ' +
  '(SELECT p3.purchase_price FROM purchases p3 WHERE p3.medicine_id = m.id ' +
  'ORDER BY p3.date DESC, p3.created_at DESC, CAST(SPLIT_PART(p3.id, \'-\', 2) AS INTEGER) DESC LIMIT 1) AS "lastPurchasePrice", ' +
  '(SELECT p4.expiry_date FROM purchases p4 WHERE p4.medicine_id = m.id ' +
  'AND p4.expiry_date IS NOT NULL AND (p4.qty - COALESCE((SELECT SUM(a2.qty) ' +
  'FROM pharmacy_sale_allocations a2 WHERE a2.purchase_id = p4.id), 0)) > 0 ' +
  'ORDER BY p4.expiry_date ASC LIMIT 1) AS "nextExpiry" ' +
  'FROM medicines m';

const SELECT_SALE =
  'SELECT id, date, med_id AS "medId", name, qty, unit_price AS "unitPrice", ' +
  'unit_cost AS "unitCost", amount, created_by AS "createdBy" FROM pharmacy_sales';

// Round a money value to four decimals (weighted-average sale costs).
function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function presentMedicine(row) {
  if (!row) return null;
  return {
    ...row,
    stock: row.stock === null || row.stock === undefined ? 0 : Math.trunc(Number(row.stock)),
    lastPurchasePrice:
      row.lastPurchasePrice === null || row.lastPurchasePrice === undefined
        ? null
        : Number(row.lastPurchasePrice),
    nextExpiry: row.nextExpiry || '',
  };
}

async function loadMedicine(runner, id) {
  const result = await runner.query(SELECT_MEDICINE + ' WHERE m.id = $1', [id]);
  return presentMedicine(result.rows[0] || null);
}

function medicineFields(body, base) {
  const src = body || {};
  const cur = base || {};
  // Any qty / stock / costPrice / expiry keys in the request body are
  // IGNORED: stock comes only from purchases (see routes/purchases.js),
  // and the old stored qty / cost_price / expiry columns no longer exist.
  return {
    name: src.name !== undefined ? String(src.name) : cur.name || '',
    generic: src.generic !== undefined ? String(src.generic) : cur.generic || '',
    company: src.company !== undefined ? String(src.company) : cur.company || '',
    unit: src.unit !== undefined ? String(src.unit) : cur.unit || '',
    packSize: src.packSize !== undefined ? String(src.packSize) : cur.packSize || '',
    price: src.price !== undefined ? toNumber(src.price, 0) : cur.price || 0,
    lowStock:
      src.lowStock !== undefined
        ? Math.trunc(toNumber(src.lowStock, 0))
        : cur.lowStock !== undefined
          ? cur.lowStock
          : 10,
  };
}

// GET /api/medicines - cost data (lastPurchasePrice) goes only to the
// roles that manage pharmacy pricing (Admin, Pharmacist); every other
// role receives null in that field, mirroring the pharmacy-sales rule.
// Computed stock and nextExpiry go to all roles.
router.get('/medicines', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_MEDICINE + ' ORDER BY m.id');
    const seesCost = req.user.role === 'Admin' || req.user.role === 'Pharmacist';
    const rows = result.rows.map((row) => {
      const med = presentMedicine(row);
      return seesCost ? med : { ...med, lastPurchasePrice: null };
    });
    res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Range-check the numeric fields of a medicine record before they
// are stored; returns an error message, or null when all are in range.
function medicineRangeError(fields) {
  if (!isMoney(fields.price)) return 'Sell price must be 0 or more';
  if (!isStockQty(fields.lowStock)) return 'Low stock threshold must be a whole number of 0 or more';
  return null;
}

// POST /api/medicines (pharmacy.write) - creates the master record
// only; stock arrives later through purchases, so it starts at 0.
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
      `INSERT INTO medicines (id, name, generic, company, unit, pack_size, price, low_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fields.name, fields.generic, fields.company, fields.unit, fields.packSize, fields.price, fields.lowStock]
    );
    return res.status(201).json(await loadMedicine({ query }, id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/medicines/:id (pharmacy.write) - master fields only.
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
      `UPDATE medicines SET name = $2, generic = $3, company = $4, unit = $5, pack_size = $6, price = $7, low_stock = $8
       WHERE id = $1`,
      [req.params.id, fields.name, fields.generic, fields.company, fields.unit, fields.packSize, fields.price, fields.lowStock]
    );
    return res.json(await loadMedicine({ query }, req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/medicines/:id (pharmacy.write) - the medicine's purchases
// (and their allocations) go with it via ON DELETE CASCADE; past sales
// keep their name snapshot and lose only the medicine link.
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
// FEFO allocation inside one transaction: batches with stock left are
// taken earliest-expiry first (no-expiry batches last), one allocation
// row is written per batch touched, and the sale's unit_cost is the
// weighted average of the batch purchase prices used. There is no
// stored stock column to update -- the allocations ARE the stock change.
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
      'SELECT id, name, price FROM medicines WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Medicine not found' });
    }
    const medicine = found.rows[0];

    const batchesResult = await client.query(
      `SELECT p.id, p.purchase_price,
         p.qty - COALESCE((SELECT SUM(a.qty) FROM pharmacy_sale_allocations a WHERE a.purchase_id = p.id), 0) AS remaining
       FROM purchases p
       WHERE p.medicine_id = $1
         AND (p.qty - COALESCE((SELECT SUM(a.qty) FROM pharmacy_sale_allocations a WHERE a.purchase_id = p.id), 0)) > 0
       ORDER BY p.expiry_date ASC NULLS LAST, p.date ASC, CAST(SPLIT_PART(p.id, '-', 2) AS INTEGER) ASC`,
      [req.params.id]
    );
    const batches = batchesResult.rows.map((row) => ({
      id: row.id,
      purchasePrice: Number(row.purchase_price),
      remaining: Number(row.remaining),
    }));
    const totalRemaining = batches.reduce((sum, batch) => sum + batch.remaining, 0);
    if (totalRemaining < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    let toAllocate = qty;
    let costTotal = 0;
    const allocations = [];
    for (const batch of batches) {
      if (toAllocate <= 0) break;
      const take = Math.min(batch.remaining, toAllocate);
      allocations.push({ purchaseId: batch.id, qty: take, unitCost: batch.purchasePrice });
      costTotal += take * batch.purchasePrice;
      toAllocate -= take;
    }

    const saleId = 'S-' + (await nextId(client, 'dispense'));
    const unitPrice = Number(medicine.price);
    const unitCost = round4(costTotal / qty);
    const amount = round2(qty * unitPrice);
    const saleResult = await client.query(
      `INSERT INTO pharmacy_sales
         (id, date, med_id, name, qty, unit_price, unit_cost, amount, created_by)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [saleId, medicine.id, medicine.name, qty, unitPrice, unitCost, amount, req.user.username]
    );
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO pharmacy_sale_allocations (sale_id, purchase_id, qty, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [saleId, allocation.purchaseId, allocation.qty, allocation.unitCost]
      );
    }
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
