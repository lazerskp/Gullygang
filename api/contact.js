// ============================================================
// GULLYGANG — PRODUCTION CONTACT / SEND MESSAGE API ENDPOINT
// Stores visitor contact inquiries into InsForge contact_messages table
// ============================================================

const { queryInsForge, escapeSql } = require('./_db.js');

// In-memory sliding window rate limiter: Max 5 submissions per 10 minutes per IP
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const ipRequestHistory = new Map();

// Periodic cleanup of stale rate-limit history every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipRequestHistory.entries()) {
    const valid = timestamps.filter(t => (now - t) < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) {
      ipRequestHistory.delete(ip);
    } else {
      ipRequestHistory.set(ip, valid);
    }
  }
}, 10 * 60 * 1000).unref();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  if (forwarded) {
    const ip = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

function isRateLimited(ip) {
  const now = Date.now();
  const history = ipRequestHistory.get(ip) || [];
  const valid = history.filter(t => (now - t) < RATE_LIMIT_WINDOW_MS);

  if (valid.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  valid.push(now);
  ipRequestHistory.set(ip, valid);
  return false;
}

module.exports = async function handler(req, res) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method Not Allowed. Use POST to send contact messages.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  // Parse Body
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const clientIp = getClientIp(req);

  // Anti-Spam Check 1: Honeypot field inspection
  // If the hidden 'website' / 'hp' field is populated, silently return success without storing
  const honeypot = (body.website || body.hp || body.botcheck || '').trim();
  if (honeypot.length > 0) {
    console.warn(`[GULLYGANG CONTACT] Bot submission intercepted from IP: ${clientIp}`);
    return res.status(200).json({
      ok: true,
      message: 'Message sent successfully.'
    });
  }

  // Anti-Spam Check 2: IP Rate Limiting
  if (isRateLimited(clientIp)) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({
      ok: false,
      error: 'Too many messages sent. Please wait a few minutes before submitting again.',
      code: 'RATE_LIMITED'
    });
  }

  // Input Validation
  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const message = (body.message || '').trim();

  if (!name || name.length < 1 || name.length > 100) {
    return res.status(400).json({
      ok: false,
      error: 'Please enter a valid name (1 to 100 characters).',
      code: 'INVALID_NAME'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email) || email.length > 255) {
    return res.status(400).json({
      ok: false,
      error: 'Please enter a valid email address.',
      code: 'INVALID_EMAIL'
    });
  }

  if (!message || message.length < 1 || message.length > 3000) {
    return res.status(400).json({
      ok: false,
      error: 'Please enter a message (up to 3000 characters).',
      code: 'INVALID_MESSAGE'
    });
  }

  try {
    // Insert into InsForge contact_messages table
    const safeName = escapeSql(name);
    const safeEmail = escapeSql(email);
    const safeMsg = escapeSql(message);

    const sql = `
      INSERT INTO contact_messages (name, email, message, created_at)
      VALUES ('${safeName}', '${safeEmail}', '${safeMsg}', NOW())
      RETURNING id, created_at;
    `;

    const result = await queryInsForge(sql);
    const recordId = result?.[0]?.id || null;

    console.log(`[GULLYGANG CONTACT] Stored contact message ${recordId || ''} from ${email}`);

    return res.status(200).json({
      ok: true,
      message: 'Message sent successfully.',
      id: recordId
    });
  } catch (err) {
    console.error('[GULLYGANG CONTACT ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: "Couldn't send your message. Please try again.",
      code: 'DATABASE_ERROR'
    });
  }
};
