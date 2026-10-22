'use strict';

// Sign-in and current-user routes.

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const { logAudit } = require('../audit');

const router = express.Router();

// Brute-force guard on sign-in: generous enough for a busy clinic
// front desk (and for staff who mistype), far too slow for guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

// POST /api/auth/login {username, password} -> {token, user}
router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const username = req.body && req.body.username ? String(req.body.username) : '';
    const password = req.body && req.body.password ? String(req.body.password) : '';

    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    const ok = user && password && bcrypt.compareSync(password, user.password_hash);

    if (!ok) {
      await logAudit(username, 'auth.login_failed', username, '');
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await logAudit(user.username, 'auth.login', user.username, '');
    const publicUser = { id: user.id, username: user.username, role: user.role };
    return res.json({ token: signToken(publicUser), user: publicUser });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me -> the signed-in user, fresh from the database.
router.get('/auth/me', authRequired, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

module.exports = router;
