// ============================================================
// GULLYGANG — FIRST-PARTY EVENT INGESTION ENDPOINT
// Privacy-first, batched, sanitized public analytics collector
// ============================================================

const {
  queryInsForge,
  escapeSql,
  isValidUUID
} = require('./_db.js');

const ALLOWED_EVENT_TYPES = new Set([
  'page_view',
  'article_view',
  'search',
  'search_result_click',
  'music_search',
  'music_search_result_click',
  'artist_view',
  'album_view',
  'artist_play_all',
  'album_play',
  'album_add_queue',
  'artist_result_click',
  'album_result_click',
  'tag_view',
  'related_article_click',
  'load_more',
  'playlist_open',
  'track_play',
  'track_pause',
  'track_skip'
]);

const SENSITIVE_KEY_PATTERN = /(?:password|token|cookie|jwt|auth|secret|authorization|bearer|email)/i;

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 64 * 1024) { // Max 64KB payload
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const eventType = String(raw.event_type || '').trim().toLowerCase();
  if (!ALLOWED_EVENT_TYPES.has(eventType)) return null;

  const pagePath = raw.page_path && typeof raw.page_path === 'string'
    ? raw.page_path.trim().slice(0, 512)
    : null;

  const pageType = raw.page_type && typeof raw.page_type === 'string'
    ? raw.page_type.trim().toLowerCase().slice(0, 64)
    : null;

  const articleId = raw.article_id && isValidUUID(raw.article_id) ? raw.article_id.trim() : null;
  const playlistId = raw.playlist_id && isValidUUID(raw.playlist_id) ? raw.playlist_id.trim() : null;

  const trackId = raw.track_id && typeof raw.track_id === 'string'
    ? raw.track_id.trim().slice(0, 64)
    : null;

  const tag = raw.tag && typeof raw.tag === 'string'
    ? raw.tag.trim().toLowerCase().slice(0, 128)
    : null;

  const searchQuery = raw.search_query && typeof raw.search_query === 'string'
    ? raw.search_query.trim().toLowerCase().slice(0, 256)
    : null;

  const sessionId = raw.session_id && typeof raw.session_id === 'string'
    ? raw.session_id.trim().replace(/[^\w-]/g, '').slice(0, 64)
    : null;

  // Sanitize metadata JSON, stripping any sensitive keys
  let cleanMeta = {};
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    for (const [k, v] of Object.entries(raw.metadata)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) continue;
      if (typeof v === 'string') {
        cleanMeta[k.slice(0, 64)] = v.slice(0, 256);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        cleanMeta[k.slice(0, 64)] = v;
      }
    }
  }

  return {
    event_type: eventType,
    page_type: pageType,
    page_path: pagePath,
    article_id: articleId,
    playlist_id: playlistId,
    track_id: trackId,
    tag: tag,
    search_query: searchQuery,
    metadata: cleanMeta,
    session_id: sessionId
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await parseBody(req);
    const rawEvents = Array.isArray(body.events) ? body.events : [body];
    const validEvents = [];

    // Max 20 events per batch
    for (let i = 0; i < Math.min(rawEvents.length, 20); i++) {
      const sanitized = sanitizeEvent(rawEvents[i]);
      if (sanitized) {
        validEvents.push(sanitized);
      }
    }

    if (validEvents.length === 0) {
      return res.status(400).json({ error: 'No valid events provided' });
    }

    // Parameterized SQL batch insertion
    const valueTuples = validEvents.map(e => {
      const artSql = e.article_id ? `'${escapeSql(e.article_id)}'` : 'NULL';
      const plSql = e.playlist_id ? `'${escapeSql(e.playlist_id)}'` : 'NULL';
      const pathSql = e.page_path ? `'${escapeSql(e.page_path)}'` : 'NULL';
      const pTypeSql = e.page_type ? `'${escapeSql(e.page_type)}'` : 'NULL';
      const trSql = e.track_id ? `'${escapeSql(e.track_id)}'` : 'NULL';
      const tagSql = e.tag ? `'${escapeSql(e.tag)}'` : 'NULL';
      const qSql = e.search_query ? `'${escapeSql(e.search_query)}'` : 'NULL';
      const sSql = e.session_id ? `'${escapeSql(e.session_id)}'` : 'NULL';
      const metaJson = JSON.stringify(e.metadata).replace(/'/g, "''");

      return `(
        '${escapeSql(e.event_type)}',
        ${pTypeSql},
        ${pathSql},
        ${artSql},
        ${plSql},
        ${trSql},
        ${tagSql},
        ${qSql},
        '${metaJson}'::jsonb,
        ${sSql}
      )`;
    }).join(', ');

    const insertSql = `
      INSERT INTO analytics_events (
        event_type, page_type, page_path, article_id, playlist_id, track_id, tag, search_query, metadata, session_id
      ) VALUES ${valueTuples};
    `;

    await queryInsForge(insertSql);

    return res.status(200).json({ success: true, processed: validEvents.length });
  } catch (err) {
    console.error('[Analytics Ingest Error]:', err.message);
    return res.status(500).json({ error: 'Failed to record analytics' });
  }
};
