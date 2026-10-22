'use strict';

// Audit trail read-out. Admin-only (users.manage): the log names the
// staff accounts behind each action, so it is not a general read.

const express = require('express');
const { query } = require('../db');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit-log -> latest 200 entries, newest first.
router.get('/audit-log', authRequired, requirePerm('users.manage'), async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, ts, actor, action, target, detail FROM audit_log ORDER BY id DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
