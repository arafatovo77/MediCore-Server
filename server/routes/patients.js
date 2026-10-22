'use strict';

// Patients register.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { toNumber, isBlank } = require('../utils');

const router = express.Router();

const SELECT_PATIENT =
  'SELECT id, name, age, gender, phone, address, blood, created_by AS "createdBy" FROM patients';

async function loadPatient(id) {
  const result = await query(SELECT_PATIENT + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Fields a create/update may set, merged over an existing row.
function patientFields(body, base) {
  const src = body || {};
  const cur = base || {};
  return {
    name: src.name !== undefined ? String(src.name) : cur.name || '',
    age: src.age !== undefined ? toNumber(src.age, 0) : cur.age || 0,
    gender: src.gender !== undefined ? String(src.gender) : cur.gender || '',
    phone: src.phone !== undefined ? String(src.phone) : cur.phone || '',
    address: src.address !== undefined ? String(src.address) : cur.address || '',
    blood: src.blood !== undefined ? String(src.blood) : cur.blood || '',
  };
}

// GET /api/patients
router.get('/patients', authRequired, async (req, res, next) => {
  try {
    const result = await query(SELECT_PATIENT + ' ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/patients (patients.write)
router.post('/patients', authRequired, requirePerm('patients.write'), async (req, res, next) => {
  try {
    if (!req.body || isBlank(req.body.name)) {
      return res.status(400).json({ error: 'Patient name is required' });
    }
    const fields = patientFields(req.body, null);
    const id = 'P-' + (await nextId(null, 'patient'));
    await query(
      `INSERT INTO patients (id, name, age, gender, phone, address, blood, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fields.name, fields.age, fields.gender, fields.phone, fields.address, fields.blood, req.user.username]
    );
    return res.status(201).json(await loadPatient(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/patients/:id (patients.write)
router.put('/patients/:id', authRequired, requirePerm('patients.write'), async (req, res, next) => {
  try {
    const existing = await loadPatient(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });
    const fields = patientFields(req.body, existing);
    if (isBlank(fields.name)) {
      return res.status(400).json({ error: 'Patient name is required' });
    }
    await query(
      `UPDATE patients SET name = $2, age = $3, gender = $4, phone = $5, address = $6, blood = $7
       WHERE id = $1`,
      [req.params.id, fields.name, fields.age, fields.gender, fields.phone, fields.address, fields.blood]
    );
    return res.json(await loadPatient(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/patients/:id (patients.write)
router.delete('/patients/:id', authRequired, requirePerm('patients.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM patients WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
