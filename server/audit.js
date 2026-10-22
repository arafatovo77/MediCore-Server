'use strict';

// Audit trail writer. Best-effort by design: a failed audit insert is
// logged to the console but never breaks the request that caused it.

const { query } = require('./db');

async function logAudit(actor, action, target, detail) {
  try {
    await query(
      'INSERT INTO audit_log (actor, action, target, detail) VALUES ($1, $2, $3, $4)',
      [actor || '', action || '', target || '', detail || '']
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit };
