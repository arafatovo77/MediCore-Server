'use strict';

// Express application: JSON body parsing, the API routers under /api,
// the static frontend from ../public, a JSON 404 for unknown API
// routes, and one central error handler that answers {error}.

const path = require('path');
const express = require('express');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/setup'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/patients'));
app.use('/api', require('./routes/doctors'));
app.use('/api', require('./routes/appointments'));
app.use('/api', require('./routes/invoices'));
app.use('/api', require('./routes/medicines'));
app.use('/api', require('./routes/purchases'));
app.use('/api', require('./routes/expenses'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/lab'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/audit'));
app.use('/api', require('./routes/export'));

// The frontend: a single static site in ../public.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Unknown API routes answer JSON, not the frontend page.
// eslint-disable-next-line no-unused-vars
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  const status = err && err.status ? err.status : 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  return res.status(status).json({ error: message || 'Internal server error' });
});

module.exports = app;
