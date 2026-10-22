'use strict';

// PostgreSQL access for MediCore.
//
// One connection pool for the whole app, configured from DATABASE_URL.
// Type parsers are adjusted so API responses carry plain values:
// DATE columns come back as 'YYYY-MM-DD' strings (not Date objects),
// NUMERIC money columns come back as numbers, and BIGINT as numbers.

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

require('dotenv').config();

types.setTypeParser(1082, (value) => value); // DATE -> raw 'YYYY-MM-DD'
types.setTypeParser(1700, (value) => (value === null ? null : Number(value))); // NUMERIC
types.setTypeParser(20, (value) => (value === null ? null : Number(value))); // BIGINT

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

// First suffix each counter family hands out on a fresh install.
const COUNTER_STARTS = {
  patient: 1001,
  doctor: 101,
  appt: 1,
  invoice: 5001,
  med: 1,
  test: 1,
  order: 1,
  dispense: 1,
  user: 1,
};

// Hand out the next numeric suffix for an ID family.
// The counters table stores the NEXT suffix to use, so the update below
// returns (suffix handed out) + 1. Pass a transaction client when the
// caller is inside a transaction; otherwise the pool is used.
async function nextId(client, name) {
  const runner = client || pool;
  const res = await runner.query(
    'UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value',
    [name]
  );
  if (res.rows.length > 0) return res.rows[0].value - 1;

  // Counter row missing (database created before counters were seeded):
  // create it and hand out the family's starting suffix.
  const start = COUNTER_STARTS[name] || 1;
  await runner.query(
    'INSERT INTO counters (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
    [name, start + 1]
  );
  return start;
}

// Apply database/schema.sql, and database/seed.sql when withSeed is set.
// The schema uses CREATE TABLE IF NOT EXISTS, so this is safe to re-run.
async function initDb(withSeed) {
  const dbDir = path.join(__dirname, '..', 'database');
  const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
  await pool.query(schema);
  if (withSeed) {
    const seed = fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8');
    await pool.query(seed);
  }
}

module.exports = { pool, query, nextId, initDb };
