'use strict';

// Authentication and role permissions.
//
// PERMS is the single source of truth for who may change what. Every
// mutating route runs authRequired first and then requirePerm(...).
// Reading a clinical collection only needs a signed-in user, except
// where a route states a stricter rule (users, audit log, export).

const jwt = require('jsonwebtoken');
const { query } = require('../db');

const PERMS = {
  Admin: [
    'patients.write',
    'doctors.write',
    'appointments.write',
    'billing.write',
    'pharmacy.write',
    'pharmacy.dispense',
    'lab.write',
    'labOrders.create',
    'labOrders.write',
    'settings.write',
    'users.manage',
    'data.manage',
  ],
  Receptionist: [
    'patients.write',
    'appointments.write',
    'billing.write',
    'labOrders.create',
  ],
  Pharmacist: [
    'pharmacy.write',
    'pharmacy.dispense',
  ],
  'Lab Technician': [
    'lab.write',
    'labOrders.create',
    'labOrders.write',
  ],
};

// The signing secret must come from the environment. There is no
// default: a missing, short or placeholder value throws, so a server
// can never silently sign tokens with a publicly known secret.
function jwtSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (
    secret.length < 32 ||
    /change-this|placeholder|example|replace-with/i.test(secret)
  ) {
    throw new Error(
      'JWT_SECRET is missing or too weak: set a random secret of at least 32 characters in .env (see .env.example).'
    );
  }
  return secret;
}

// Called once at startup so a misconfigured server refuses to run
// instead of failing on the first sign-in.
function assertSecretConfigured() {
  jwtSecret();
}

// Sign a login token for a user row ({id, username, role}).
function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h', algorithm: 'HS256' }
  );
}

// Require a valid Bearer token. The user row is loaded fresh from the
// database on every call, so a deleted account stops working at once
// and a role change takes effect without waiting for the token to
// expire. Any failure answers 401.
async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    let payload;
    try {
      payload = jwt.verify(parts[1], jwtSecret(), { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const result = await query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [payload.sub]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    req.user = result.rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

// Require one named permission on the signed-in user's role.
function requirePerm(perm) {
  return function checkPerm(req, res, next) {
    const allowed = (req.user && PERMS[req.user.role]) || [];
    if (!allowed.includes(perm)) {
      return res.status(403).json({ error: 'Forbidden: missing permission ' + perm });
    }
    return next();
  };
}

module.exports = { PERMS, signToken, authRequired, requirePerm, assertSecretConfigured };
