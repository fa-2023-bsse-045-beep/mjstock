class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function text(value, field, { required = false, max = 255 } = {}) {
  if (isBlank(value)) {
    if (required) throw bad(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw bad(`${field} must be text`);
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (/[\u0000-\u001f\u007f]/.test(s)) throw bad(`${field} contains invalid characters`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}

function integer(value, field, { min = 0, max = 1000000, required = true } = {}) {
  if (isBlank(value)) {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) n = Number(value.trim());
  if (!Number.isInteger(n)) throw bad(`${field} must be a whole number`);
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`);
  return n;
}

function amount(value, field, { min = 0, max = 100000000, required = true } = {}) {
  if (isBlank(value)) {
    if (required) throw bad(`${field} is required`);
    return 0;
  }
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value.trim())) n = Number(value.trim());
  if (!Number.isFinite(n)) throw bad(`${field} must be a valid amount`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw bad(`${field} can have at most 2 decimals`);
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`);
  return Math.round(n * 100) / 100;
}

function id(value, field = 'id') {
  return integer(value, field, { min: 1, max: 2147483647 });
}

function email(value) {
  const s = text(value, 'Email', { required: true, max: 255 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Enter a valid email address');
  return s;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw bad('Password must be 8 to 72 characters');
  }
  return value;
}

function oneOf(value, field, options, fallback) {
  if (isBlank(value) && fallback !== undefined) return fallback;
  if (!options.includes(value)) throw bad(`${field} must be one of: ${options.join(', ')}`);
  return value;
}

module.exports = { HttpError, text, integer, amount, id, email, password, oneOf };
