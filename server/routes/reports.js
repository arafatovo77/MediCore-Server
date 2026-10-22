'use strict';

// Pharmacy reports: computed stock values and stock alerts.
//
// Stock is computed from purchases minus sale allocations (see
// routes/purchases.js). Stock value uses each batch's own purchase
// price, so it is cost data: lastPurchasePrice, stockValue and
// totalStockValue go only to Admin and Pharmacist, and every other
// role receives null in those fields.

const express = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');
const { round2 } = require('../utils');

const router = express.Router();

// Remaining units of one purchase batch, as a SQL fragment over p.
const REMAINING_OF_P =
  '(p.qty - COALESCE((SELECT SUM(a.qty) FROM pharmacy_sale_allocations a WHERE a.purchase_id = p.id), 0))';

// Computed stock of one medicine, as a SQL fragment over m.
const STOCK_OF_M =
  'COALESCE((SELECT SUM(p.qty) FROM purchases p WHERE p.medicine_id = m.id), 0) - ' +
  'COALESCE((SELECT SUM(a.qty) FROM pharmacy_sale_allocations a ' +
  'JOIN purchases p2 ON p2.id = a.purchase_id WHERE p2.medicine_id = m.id), 0)';

function seesCost(req) {
  return req.user.role === 'Admin' || req.user.role === 'Pharmacist';
}

// GET /api/reports/stock - one row per medicine with its computed
// stock and the value of that stock at batch purchase prices.
router.get('/reports/stock', authRequired, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT m.id AS "medicineId", m.name, m.generic, m.price AS "sellPrice", ' +
      '(SELECT p3.purchase_price FROM purchases p3 WHERE p3.medicine_id = m.id ' +
      'ORDER BY p3.date DESC, p3.created_at DESC, CAST(SPLIT_PART(p3.id, \'-\', 2) AS INTEGER) DESC LIMIT 1) AS "lastPurchasePrice", ' +
      STOCK_OF_M + ' AS stock, ' +
      'COALESCE((SELECT SUM(' + REMAINING_OF_P + ' * p.purchase_price) ' +
      'FROM purchases p WHERE p.medicine_id = m.id), 0) AS "stockValue" ' +
      'FROM medicines m ORDER BY m.id'
    );
    const allowed = seesCost(req);
    let totalStockValue = 0;
    const medicines = result.rows.map((row) => {
      const stockValue = round2(Number(row.stockValue) || 0);
      totalStockValue += stockValue;
      return {
        medicineId: row.medicineId,
        name: row.name,
        generic: row.generic,
        sellPrice: row.sellPrice,
        lastPurchasePrice: allowed ? row.lastPurchasePrice : null,
        stock: Math.trunc(Number(row.stock) || 0),
        stockValue: allowed ? stockValue : null,
      };
    });
    res.json({
      medicines,
      rows: medicines,
      totalStockValue: allowed ? round2(totalStockValue) : null,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/pharmacy/alerts - batches expiring within 30 days (or
// already expired) that still hold stock, and medicines at or below
// their per-medicine low-stock threshold.
router.get('/pharmacy/alerts', authRequired, async (req, res, next) => {
  try {
    const expiringResult = await query(
      'SELECT p.id AS "purchaseId", p.medicine_id AS "medicineId", ' +
      'p.medicine_name AS "medicineName", p.batch_no AS "batchNo", ' +
      'p.expiry_date AS "expiryDate", (p.expiry_date - CURRENT_DATE) AS "daysLeft", ' +
      REMAINING_OF_P + ' AS remaining, ' +
      'CASE WHEN p.expiry_date < CURRENT_DATE THEN \'Expired\' ELSE \'Expiring\' END AS status ' +
      'FROM purchases p ' +
      'WHERE p.expiry_date IS NOT NULL AND p.expiry_date <= CURRENT_DATE + 30 ' +
      'AND ' + REMAINING_OF_P + ' > 0 ' +
      'ORDER BY p.expiry_date ASC'
    );
    const expiring = expiringResult.rows.map((row) => ({
      ...row,
      daysLeft: Number(row.daysLeft),
      remaining: Number(row.remaining),
    }));

    const lowStockResult = await query(
      'SELECT m.id AS "medicineId", m.name, ' + STOCK_OF_M + ' AS stock, ' +
      'm.low_stock AS "lowStock" FROM medicines m ' +
      'WHERE ' + STOCK_OF_M + ' <= m.low_stock ' +
      'ORDER BY stock ASC'
    );
    const lowStock = lowStockResult.rows.map((row) => ({
      ...row,
      stock: Math.trunc(Number(row.stock) || 0),
      lowStock: Number(row.lowStock),
    }));

    res.json({ expiring, lowStock });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
