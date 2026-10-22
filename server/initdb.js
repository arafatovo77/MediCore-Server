'use strict';

// Database initialisation command line:
//   node server/initdb.js          -> apply database/schema.sql
//   node server/initdb.js --seed   -> apply the schema, then the demo seed
// Safe to re-run: the schema is written with IF NOT EXISTS throughout.

require('dotenv').config();

const { initDb, pool } = require('./db');

async function main() {
  const withSeed = process.argv.includes('--seed');
  await initDb(withSeed);
  console.log('Database schema applied (database/schema.sql).');
  if (withSeed) {
    console.log('Demo seed data applied (database/seed.sql).');
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Database initialisation failed:', err.message);
    try { await pool.end(); } catch (e) { /* pool already closed */ }
    process.exit(1);
  });
