'use strict';

// First-run setup. Creating the first (Admin) account is the one
// unauthenticated mutating route in the app, and it only works while
// the users table is completely empty.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, query, nextId } = require('../db');
const { logAudit } = require('../audit');
const { isBlank } = require('../utils');

const router = express.Router();

// GET /api/setup/status -> {needsSetup}
router.get('/setup/status', async (req, res, next) => {
  try {
    const result = await query('SELECT COUNT(*)::int AS count FROM users');
    res.json({ needsSetup: result.rows[0].count === 0 });
  } catch (err) {
    return next(err);
  }
});

// POST /api/setup/admin {username, password} -> 201 {id, username, role}
router.post('/setup/admin', async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    const username = req.body ? req.body.username : undefined;
    const password = req.body ? req.body.password : undefined;
    if (isBlank(username) || isBlank(password)) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    await client.query('BEGIN');
    const count = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (count.rows[0].count > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Setup has already been completed' });
    }

    const suffix = await nextId(client, 'user');
    const id = 'U-' + suffix;
    const passwordHash = bcrypt.hashSync(String(password), 10);
    // Single atomic insert: the WHERE NOT EXISTS guard means a second
    // setup call running at the same moment cannot also succeed.
    const inserted = await client.query(
      `INSERT INTO users (id, username, password_hash, role)
       SELECT $1, $2, $3, 'Admin' WHERE NOT EXISTS (SELECT 1 FROM users)`,
      [id, String(username), passwordHash]
    );
    if (inserted.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Setup has already been completed' });
    }
    await client.query('COMMIT');

    await logAudit(String(username), 'setup.admin', String(username), 'First Admin account created');
    return res.status(201).json({ id, username: String(username), role: 'Admin' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* no transaction open */ }
    }
    return next(err);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
