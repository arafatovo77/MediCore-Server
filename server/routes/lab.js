'use strict';

// Laboratory: test catalogue and orders. An order snapshots the test
// name and price from the catalogue at order time, so later catalogue
// edits do not rewrite history.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { toNumber, isBlank, isMoney } = require('../utils');

const router = express.Router();

const SELECT_TEST = 'SELECT id, name, price FROM lab_tests';

const SELECT_ORDER =
  'SELECT id, date, patient_id AS "patientId", patient_name AS "patientName", ' +
  'test_id AS "testId", test_name AS "testName", price, status, result, ' +
  'created_by AS "createdBy" FROM lab_orders';

async function loadTest(id) {
  const result = await query(SELECT_TEST + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function loadOrder(id) {
  const result = await query(SELECT_ORDER + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// ---- Test catalogue ----

// GET /api/lab-tests
router.get('/lab-tests', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_TEST + ' ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/lab-tests (lab.write)
router.post('/lab-tests', authRequired, requirePerm('lab.write'), async (req, res, next) => {
  try {
    if (!req.body || isBlank(req.body.name)) {
      return res.status(400).json({ error: 'Test name is required' });
    }
    const price = toNumber(req.body.price, 0);
    if (!isMoney(price)) {
      return res.status(400).json({ error: 'Price must be 0 or more' });
    }
    const id = 'LT-' + (await nextId(null, 'test'));
    await query(
      'INSERT INTO lab_tests (id, name, price) VALUES ($1, $2, $3)',
      [id, String(req.body.name), price]
    );
    return res.status(201).json(await loadTest(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/lab-tests/:id (lab.write)
router.put('/lab-tests/:id', authRequired, requirePerm('lab.write'), async (req, res, next) => {
  try {
    const existing = await loadTest(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lab test not found' });
    const name = req.body && req.body.name !== undefined ? String(req.body.name) : existing.name;
    const price = req.body && req.body.price !== undefined ? toNumber(req.body.price, 0) : existing.price;
    if (isBlank(name)) return res.status(400).json({ error: 'Test name is required' });
    if (!isMoney(Number(price))) return res.status(400).json({ error: 'Price must be 0 or more' });
    await query('UPDATE lab_tests SET name = $2, price = $3 WHERE id = $1', [req.params.id, name, price]);
    return res.json(await loadTest(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/lab-tests/:id (lab.write)
router.delete('/lab-tests/:id', authRequired, requirePerm('lab.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM lab_tests WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Lab test not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// ---- Lab orders ----

// GET /api/lab-orders
router.get('/lab-orders', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_ORDER + ' ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/lab-orders (labOrders.create) - snapshots test name + price.
router.post('/lab-orders', authRequired, requirePerm('labOrders.create'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (isBlank(body.testId)) {
      return res.status(400).json({ error: 'A lab test is required' });
    }
    const test = await loadTest(String(body.testId));
    if (!test) return res.status(404).json({ error: 'Lab test not found' });

    const id = 'LO-' + (await nextId(null, 'order'));
    await query(
      `INSERT INTO lab_orders
         (id, date, patient_id, patient_name, test_id, test_name, price, status, result, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, 'Pending', '', $8)`,
      [
        id,
        body.date ? String(body.date) : null,
        body.patientId ? String(body.patientId) : null,
        body.patientName ? String(body.patientName) : '',
        test.id,
        test.name,
        test.price,
        req.user.username,
      ]
    );
    return res.status(201).json(await loadOrder(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/lab-orders/:id (labOrders.write) - status / result updates.
router.put('/lab-orders/:id', authRequired, requirePerm('labOrders.write'), async (req, res, next) => {
  try {
    const existing = await loadOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lab order not found' });
    const body = req.body || {};
    const status = body.status !== undefined ? String(body.status) : existing.status;
    const resultText = body.result !== undefined ? String(body.result) : existing.result;
    if (!['Pending', 'Completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid lab order status' });
    }
    await query(
      'UPDATE lab_orders SET status = $2, result = $3 WHERE id = $1',
      [req.params.id, status, resultText]
    );
    return res.json(await loadOrder(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/lab-orders/:id (labOrders.write)
router.delete('/lab-orders/:id', authRequired, requirePerm('labOrders.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM lab_orders WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Lab order not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
