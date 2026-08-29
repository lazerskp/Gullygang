// ============================================================
// GULLYGANG — SHARED SERVER DATABASE HELPER
// ============================================================

const INSFORGE_HOST = process.env.INSFORGE_HOST || process.env.OSS_HOST || 'https://i7i9c74c.ap-southeast.insforge.app';
const INSFORGE_API_KEY = process.env.INSFORGE_API_KEY || process.env.API_KEY || 'ik_3394ff1ae476e1e5bbabce8593040c1e';

/**
 * Execute InsForge SQL Query via official rawsql API
 */
async function queryInsForge(sql) {
  const url = `${INSFORGE_HOST}/api/database/advance/rawsql`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INSFORGE_API_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`InsForge query failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.rows ?? data.data ?? data ?? [];
}

/**
 * Escape single quotes for raw SQL strings
 */
function escapeSql(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "''");
}

module.exports = {
  INSFORGE_HOST,
  INSFORGE_API_KEY,
  queryInsForge,
  escapeSql
};
