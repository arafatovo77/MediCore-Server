'use strict';

// Appointments, with a per-doctor, per-day token (queue) number that
// the server assigns at booking time.

const express = require('express');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { isBlank } = require('../utils');

const router = express.Router();

const STATUSES = ['Waiting', 'In Consultation', 'Done', 'Cancelled'];

const SELECT_APPOINTMENT =
  'SELECT id, patient_id AS "patientId", patient_name AS "patientName", ' +
  'doctor_id AS "doctorId", doctor_name AS "doctorName", date, token, status, ' +
  'created_by AS "createdBy" FROM appointments';

async function loadAppointment(id) {
  const result = await query(SELECT_APPOINTMENT + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// GET /api/appointments  (optional ?date=YYYY-MM-DD)
router.get('/appointments', authRequired, async (req, res, next) => {
  try {
    let result;
    if (req.query.date) {
      result = await query(SELECT_APPOINTMENT + ' WHERE date = $1::date ORDER BY seq', [req.query.date]);
    } else {
      result = await query(SELECT_APPOINTMENT + ' ORDER BY seq');
    }
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/appointments (appointments.write)
router.post('/appointments', authRequired, requirePerm('appointments.write'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (isBlank(body.doctorId) || isBlank(body.date)) {
      return res.status(400).json({ error: 'Doctor and date are required' });
    }
    const status = body.status !== undefined ? String(body.status) : 'Waiting';
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid appointment status' });
    }
    // Next queue number for this doctor on this date.
    const counted = await query(
      'SELECT COUNT(*)::int AS count FROM appointments WHERE doctor_id = $1 AND date = $2::date',
      [String(body.doctorId), String(body.date)]
    );
    const token = counted.rows[0].count + 1;
    const id = 'A-' + (await nextId(null, 'appt'));
    await query(
      `INSERT INTO appointments
         (id, patient_id, patient_name, doctor_id, doctor_name, date, token, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        body.patientId ? String(body.patientId) : null,
        body.patientName ? String(body.patientName) : '',
        String(body.doctorId),
        body.doctorName ? String(body.doctorName) : '',
        String(body.date),
        token,
        status,
        req.user.username,
      ]
    );
    return res.status(201).json(await loadAppointment(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/appointments/:id (appointments.write) - status / field updates.
router.put('/appointments/:id', authRequired, requirePerm('appointments.write'), async (req, res, next) => {
  try {
    const existing = await loadAppointment(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });
    const body = req.body || {};
    const updated = {
      patientId: body.patientId !== undefined ? body.patientId : existing.patientId,
      patientName: body.patientName !== undefined ? String(body.patientName) : existing.patientName,
      doctorId: body.doctorId !== undefined ? body.doctorId : existing.doctorId,
      doctorName: body.doctorName !== undefined ? String(body.doctorName) : existing.doctorName,
      date: body.date !== undefined ? String(body.date) : existing.date,
      status: body.status !== undefined ? String(body.status) : existing.status,
    };
    if (!STATUSES.includes(updated.status)) {
      return res.status(400).json({ error: 'Invalid appointment status' });
    }
    await query(
      `UPDATE appointments SET patient_id = $2, patient_name = $3, doctor_id = $4,
         doctor_name = $5, date = $6, status = $7 WHERE id = $1`,
      [
        req.params.id,
        updated.patientId ? String(updated.patientId) : null,
        updated.patientName,
        updated.doctorId ? String(updated.doctorId) : null,
        updated.doctorName,
        updated.date,
        updated.status,
      ]
    );
    return res.json(await loadAppointment(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/appointments/:id (appointments.write)
router.delete('/appointments/:id', authRequired, requirePerm('appointments.write'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Appointment not found' });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
