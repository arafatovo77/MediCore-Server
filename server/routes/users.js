'use strict';

// User account management. Every route here requires users.manage
// (Admin). Passwords are hashed with bcrypt on the server and hashes
// are never included in a response.

const express = require('express');
const bcrypt = require('bcryptjs');
const { query, nextId } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../audit');
const { isBlank } = require('../utils');

const router = express.Router();

const ROLES = ['Admin', 'Receptionist', 'Pharmacist', 'Lab Technician'];

const SELECT_USER =
  'SELECT id, username, role, created_at AS "createdAt" FROM users';

router.use('/users', authRequired, requirePerm('users.manage'));

async function loadUser(id) {
  const result = await query(SELECT_USER + ' WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// GET /api/users
router.get('/users', async (req, res, next) => {
  try {
    const result = await query(SELECT_USER + ' ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/users {username, password, role}
router.post('/users', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (isBlank(body.username) || isBlank(body.password)) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (String(body.password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!ROLES.includes(body.role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const existing = await query('SELECT id FROM users WHERE username = $1', [String(body.username)]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const id = 'U-' + (await nextId(null, 'user'));
    const passwordHash = bcrypt.hashSync(String(body.password), 10);
    try {
      await query(
        'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
        [id, String(body.username), passwordHash, String(body.role)]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw err;
    }
    await logAudit(req.user.username, 'user.create', String(body.username), 'Role: ' + String(body.role));
    return res.status(201).json(await loadUser(id));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/users/:id {role}
router.put('/users/:id', async (req, res, next) => {
  try {
    const existing = await loadUser(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const role = req.body ? req.body.role : undefined;
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    await query('UPDATE users SET role = $2 WHERE id = $1', [req.params.id, String(role)]);
    await logAudit(
      req.user.username,
      'user.role_change',
      existing.username,
      existing.role + ' -> ' + String(role)
    );
    return res.json(await loadUser(req.params.id));
  } catch (err) {
    return next(err);
  }
});

// POST /api/users/:id/password {password}
router.post('/users/:id/password', async (req, res, next) => {
  try {
    const existing = await loadUser(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (!req.body || isBlank(req.body.password)) {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const passwordHash = bcrypt.hashSync(String(req.body.password), 10);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.params.id, passwordHash]);
    await logAudit(req.user.username, 'user.password_reset', existing.username, '');
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/users/:id - an account cannot delete itself, and the
// last remaining Admin account cannot be deleted.
router.delete('/users/:id', async (req, res, next) => {
  try {
    const existing = await loadUser(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    if (existing.role === 'Admin') {
      const admins = await query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'Admin'");
      if (admins.rows[0].count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last Admin account' });
      }
    }
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logAudit(req.user.username, 'user.delete', existing.username, 'Role: ' + existing.role);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
