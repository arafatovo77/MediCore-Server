'use strict';

// Server entry point: load .env, build the app, start listening.

require('dotenv').config();

// Refuse to start on a misconfigured server: the database connection
// string and a strong JWT_SECRET are both required (see .env.example).
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in (see HowToSetup.md).');
  process.exit(1);
}
try {
  require('./middleware/auth').assertSecretConfigured();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('MediCore server listening on port ' + PORT);
});
