'use strict';

// Doctor directory.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { toNumber, isBlank, isMoney } = require('../utils');

const router = express.Router();

const SELECT_DOCTOR =
  'SELECT id, name, dept, qual, fee, days, "time" AS "time" FROM doctors';

async function loadDoctor(id) {
  const result = await query(SELECT_DOCTOR + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

function doctorFields(body, base) {
  const src = body || {};
  const cur = base || {};
  return {
    name: src.name !== undefined ? String(src.name) : cur.name || '',
    dept: src.dept !== undefined ? String(src.dept) : cur.dept || '',
    qual: src.qual !== undefined ? String(src.qual) : cur.qual || '',
    fee: src.fee !== undefined ? toNumber(src.fee, 0) : cur.fee || 0,
    days: src.days !== undefined ? String(src.days) : cur.days || '',
    time: src.time !== undefined ? String(src.time) : cur.time || '',
  };
}

// GET /api/doctors
router.get('/doctors', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_DOCTOR + ' ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/doctors (doctors.write)
router.post('/doctors', authRequired, requirePerm('doctors.write'), async (req, res, next) => {
  try {
    if (!req.body || isBlank(req.body.name)) {
      return res.status(400).json({ error: 'Doctor name is required' });
    }
    const fields = doctorFields(req.body, null);
    if (!isMoney(fields.fee)) {
      return res.status(400).json({ error: 'Fee must be 0 or more' });
    }
    const id = 'D-' + (await nextId(null, 'doctor'));
    await query(
      'INSERT INTO doctors (id, name, dept, qual, fee, days, "time") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, fields.name, fields.dept, fields.qual, fields.fee, fields.days, fields.time]
    );
    return res.status(201).json(await loadDoctor(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/doctors/:id (doctors.write)
router.put('/doctors/:id', authRequired, requirePerm('doctors.write'), async (req, res, next) => {
  try {
    const existing = await loadDoctor(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Doctor not found' });
    const fields = doctorFields(req.body, existing);
    if (isBlank(fields.name)) {
      return res.status(400).json({ error: 'Doctor name is required' });
    }
    if (!isMoney(fields.fee)) {
      return res.status(400).json({ error: 'Fee must be 0 or more' });
    }
    await query(
      'UPDATE doctors SET name = $2, dept = $3, qual = $4, fee = $5, days = $6, "time" = $7 WHERE id = $1',
      [req.params.id, fields.name, fields.dept, fields.qual, fields.fee, fields.days, fields.time]
    );
    return res.json(await loadDoctor(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/doctors/:id (doctors.write)
router.delete('/doctors/:id', authRequired, requirePerm('doctors.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM doctors WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
