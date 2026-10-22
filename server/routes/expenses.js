'use strict';

// Expenses register: dated money-out entries (rent, supplies, ...),
// maintained under the pharmacy.write permission alongside purchases.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { toNumber, isBlank, isMoney, isValidDate } = require('../utils');

const router = express.Router();

const SELECT_EXPENSE =
  'SELECT id, date, title, amount, note, created_by AS "createdBy" FROM expenses';

const ORDER_EXPENSES = ' ORDER BY date DESC, CAST(SPLIT_PART(id, \'-\', 2) AS INTEGER) DESC';

async function loadExpense(id) {
  const result = await query(SELECT_EXPENSE + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

function expenseFields(body, base) {
  const src = body || {};
  const cur = base || {};
  return {
    title: src.title !== undefined ? String(src.title) : cur.title || '',
    amount: src.amount !== undefined ? toNumber(src.amount, 0) : cur.amount || 0,
    date:
      src.date !== undefined && src.date !== null && src.date !== ''
        ? String(src.date)
        : cur.date || null,
    note: src.note !== undefined && src.note !== null ? String(src.note) : cur.note || '',
  };
}

// Validate a merged expense record; returns an error, or null.
function expenseError(fields) {
  if (isBlank(fields.title)) return 'Expense title is required';
  if (!isMoney(fields.amount)) return 'Amount must be 0 or more';
  if (fields.date !== null && fields.date !== undefined && !isValidDate(String(fields.date))) {
    return 'Date must be a valid date (YYYY-MM-DD)';
  }
  return null;
}

// GET /api/expenses
router.get('/expenses', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_EXPENSE + ORDER_EXPENSES);
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/expenses (pharmacy.write) {title, amount, date?, note?}
router.post('/expenses', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const fields = expenseFields(req.body, null);
    const error = expenseError(fields);
    if (error) return res.status(400).json({ error });
    const id = 'EXP-' + (await nextId(null, 'expense'));
    await query(
      `INSERT INTO expenses (id, date, title, amount, note, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)`,
      [id, fields.date, fields.title, fields.amount, fields.note, req.user.username]
    );
    return res.status(201).json(await loadExpense(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/expenses/:id (pharmacy.write) - merge-style update.
router.put('/expenses/:id', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const existing = await loadExpense(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    const fields = expenseFields(req.body, existing);
    const error = expenseError(fields);
    if (error) return res.status(400).json({ error });
    await query(
      `UPDATE expenses SET date = COALESCE($2::date, CURRENT_DATE), title = $3, amount = $4, note = $5
       WHERE id = $1`,
      [req.params.id, fields.date, fields.title, fields.amount, fields.note]
    );
    return res.json(await loadExpense(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/expenses/:id (pharmacy.write)
router.delete('/expenses/:id', authRequired, requirePerm('pharmacy.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Expense not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
