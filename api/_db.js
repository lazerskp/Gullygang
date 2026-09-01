// ============================================================
// GULLYGANG — SHARED SERVER DATABASE & SECURITY HELPER
// Zero hardcoded secrets — strictly requires server environment variables
// ============================================================

/**
 * Resolve InsForge Base URL strictly from environment
 */
function getInsForgeHost() {
  const host = process.env.INSFORGE_URL || process.env.INSFORGE_BASE_URL || process.env.INSFORGE_HOST || process.env.OSS_HOST;
  if (!host) {
    throw new Error('INSFORGE_URL is not configured in server environment variables');
  }
  return host.replace(/\/+$/, '');
}

/**
 * Resolve InsForge Privileged Server API Key strictly from environment
 */
function getInsForgeApiKey() {
  const key = process.env.INSFORGE_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error('INSFORGE_API_KEY is not configured in server environment variables');
  }
  return key;
}

/**
 * Execute InsForge SQL Query via official rawsql endpoint
 */
async function queryInsForge(sql, timeoutMs = 15000) {
  const host = getInsForgeHost();
  const apiKey = getInsForgeApiKey();

  const url = `${host}/api/database/advance/rawsql`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`InsForge query failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.rows ?? data.data ?? data ?? [];
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Escape single quotes for raw SQL strings
 */
function escapeSql(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "''");
}

/**
 * Validate UUID format (RFC 4122 v1-v5)
 */
function isValidUUID(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

/**
 * Validate finite integer
 */
function isValidInteger(val) {
  if (val === null || val === undefined || val === '') return false;
  const num = Number(val);
  return Number.isInteger(num) && Number.isFinite(num);
}

/**
 * Validate URL slug (lowercase alphanumeric with hyphens)
 */
function isValidSlug(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(str.trim());
}

/**
 * Validate HTTP/HTTPS URL
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

module.exports = {
  getInsForgeHost,
  getInsForgeApiKey,
  queryInsForge,
  escapeSql,
  isValidUUID,
  isValidInteger,
  isValidSlug,
  isValidUrl
};
