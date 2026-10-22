'use strict';

// Clinic settings: a single row (id = 1) with the clinic profile.

const express = require('express');
const { query } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = express.Router();

const FIELDS = ['clinicName', 'address', 'phone', 'currency', 'country', 'currencyCode'];

const DEFAULTS = {
  clinicName: 'MediCore Demo Clinic',
  address: '',
  phone: '',
  currency: '$',
  country: '',
  currencyCode: '',
};

const SELECT_SETTINGS =
  'SELECT clinic_name AS "clinicName", address, phone, currency, country, ' +
  'currency_code AS "currencyCode" FROM settings WHERE id = 1';

async function loadSettings() {
  const result = await query(SELECT_SETTINGS);
  return result.rows[0] || { ...DEFAULTS };
}

// GET /api/settings
router.get('/settings', authRequired, async (req, res, next) => {
  try {
    res.json(await loadSettings());
  } catch (err) {
    return next(err);
  }
});

// PUT /api/settings (settings.write) - only the six profile fields.
router.put('/settings', authRequired, requirePerm('settings.write'), async (req, res, next) => {
  try {
    const current = await loadSettings();
    const updated = { ...current };
    for (const field of FIELDS) {
      if (req.body && req.body[field] !== undefined) {
        updated[field] = String(req.body[field]);
      }
    }
    await query(
      `INSERT INTO settings (id, clinic_name, address, phone, currency, country, currency_code)
       VALUES (1, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         clinic_name = EXCLUDED.clinic_name,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         currency = EXCLUDED.currency,
         country = EXCLUDED.country,
         currency_code = EXCLUDED.currency_code`,
      [updated.clinicName, updated.address, updated.phone, updated.currency, updated.country, updated.currencyCode]
    );
    res.json(await loadSettings());
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
