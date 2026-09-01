// ============================================================
// GULLYGANG — SECURE PUBLIC READ-ONLY DATA ENDPOINT
// Proxies public read requests to InsForge without exposing API keys
// ============================================================

const { queryInsForge, escapeSql, isValidUUID, isValidSlug } = require('./_db.js');

module.exports = async function handler(req, res) {
  // CORS & Cache Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type = url.searchParams.get('type') || 'playlists';

  try {
    // 1. Public Active Playlists
    if (type === 'playlists') {
      const rows = await queryInsForge(`
        SELECT p.id, p.name, p.slug, p.icon, p.youtube_playlist_url, p.bg_image, p.display_order, p.is_active,
               COUNT(s.id)::int as song_count
        FROM playlists p
        LEFT JOIN playlist_songs s ON p.id = s.playlist_id AND (s.is_active IS NULL OR s.is_active = true)
        WHERE p.is_active = true
        GROUP BY p.id
        ORDER BY p.display_order ASC, p.created_at DESC;
      `);
      return res.status(200).json(rows);
    }

    // 2. Public Songs for Playlist
    if (type === 'songs') {
      const playlistId = url.searchParams.get('playlist_id');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || 100, 10), 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset') || 0, 10), 0);

      let sql = `
        SELECT id, playlist_id, youtube_id, title, artist, thumbnail, display_order
        FROM playlist_songs
        WHERE (is_active IS NULL OR is_active = true)
      `;
      if (playlistId && isValidUUID(playlistId)) {
        sql += ` AND playlist_id = '${escapeSql(playlistId)}'`;
      }
      sql += ` ORDER BY display_order ASC, created_at ASC LIMIT ${limit} OFFSET ${offset};`;

      const rows = await queryInsForge(sql);
      return res.status(200).json(rows);
    }

    // 3. Public Active Visuals
    if (type === 'visuals') {
      const rows = await queryInsForge(`
        SELECT id, name, url, display_order
        FROM visuals
        WHERE is_active = true
        ORDER BY display_order ASC;
      `);
      return res.status(200).json(rows);
    }

    // 4. Public Blog Posts
    if (type === 'blog') {
      const slug = url.searchParams.get('slug');
      if (slug) {
        const safeSlug = escapeSql(slug.trim());
        const rows = await queryInsForge(`
          SELECT id, slug, title, excerpt, content, featured_image, reading_time, author, seo_title, seo_description, published_at
          FROM blog_posts
          WHERE slug = '${safeSlug}' AND status = 'published';
        `);
        return res.status(200).json(rows[0] || null);
      }

      const rows = await queryInsForge(`
        SELECT id, slug, title, excerpt, featured_image, reading_time, author, published_at
        FROM blog_posts
        WHERE status = 'published'
        ORDER BY published_at DESC;
      `);
      return res.status(200).json(rows);
    }

    // 5. Public Site Settings
    if (type === 'settings') {
      const rows = await queryInsForge(`
        SELECT key, value FROM site_settings WHERE key IN ('general_settings', 'advertisements');
      `);
      const map = {};
      rows.forEach(r => map[r.key] = r.value);
      return res.status(200).json(map);
    }

    return res.status(404).json({ error: `Unknown public resource type: ${type}` });
  } catch (err) {
    console.error('[PublicAPI] Query error:', err);
    return res.status(500).json({ error: 'Failed to retrieve public data' });
  }
};
