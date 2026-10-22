'use strict';

// Small shared helpers for route handlers.

// Round a money value to two decimals.
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Coerce an incoming value to a finite number, or fall back.
function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// True when a value is missing or a blank string.
function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// Upper bounds for numeric input. Generous for any real clinic, but
// they stop a stray or hostile value (a negative price, a discount
// over 100%, a quantity in the billions) from flowing into the totals
// the server computes.
const LIMITS = {
  money: 100000000, // a single fee, price, cost or payment
  quantity: 1000000, // units on one invoice line or stock movement
  stock: 100000000, // total units held on one medicine record
};

// True when a finite number sits inside [min, max].
function inRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

// True when a money value is acceptable: 0 .. LIMITS.money.
function isMoney(value) {
  return inRange(value, 0, LIMITS.money);
}

// True when a quantity is acceptable: a whole number 1 .. LIMITS.quantity.
function isPositiveQty(value) {
  return Number.isInteger(value) && value >= 1 && value <= LIMITS.quantity;
}

// True when a stock level is acceptable: a whole number 0 .. LIMITS.stock.
function isStockQty(value) {
  return Number.isInteger(value) && value >= 0 && value <= LIMITS.stock;
}

// True for a real calendar date in 'YYYY-MM-DD' form.
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
  );
}

module.exports = {
  round2,
  toNumber,
  isBlank,
  LIMITS,
  inRange,
  isMoney,
  isPositiveQty,
  isStockQty,
  isValidDate,
};
