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
    // 0. Public Sync Version (Real-time synchronization check)
    if (type === 'sync_version' || type === 'events') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      const rows = await queryInsForge(`SELECT value, updated_at FROM site_settings WHERE key = 'sync_version';`);
      const val = rows[0]?.value || {};
      return res.status(200).json({
        version: val.version || 0,
        last_event: val.last_event || null,
        timestamp: Date.now()
      });
    }

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

    // 4. Public Blog Posts & Articles
    if (type === 'blog' || type === 'article') {
      const slug = url.searchParams.get('slug');
      const tag = url.searchParams.get('tag');

      if (slug) {
        const safeSlug = escapeSql(slug.trim());
        const rows = await queryInsForge(`
          SELECT id, slug, title, excerpt, content, featured_image, reading_time, author, seo_title, seo_description, tags, is_featured, published_at, created_at
          FROM blog_posts
          WHERE slug = '${safeSlug}' AND (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
          LIMIT 1;
        `);
        if (!rows || rows.length === 0) {
          return res.status(404).json({ error: 'Article not found or not currently published' });
        }
        return res.status(200).json(rows[0]);
      }

      let query = `
        SELECT id, slug, title, excerpt, featured_image, reading_time, author, tags, is_featured, published_at, created_at
        FROM blog_posts
        WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
      `;

      if (tag) {
        const safeTag = escapeSql(tag.trim().toLowerCase());
        query += ` AND '${safeTag}' = ANY(tags)`;
      }

      query += ` ORDER BY is_featured DESC, published_at DESC, created_at DESC;`;

      const rows = await queryInsForge(query);
      return res.status(200).json(rows);
    }

    // 4.5 Related Stories (More from GULLYGANG)
    if (type === 'related_articles') {
      const currentSlug = url.searchParams.get('slug');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || 4, 10), 10);

      let currentTags = [];
      let currentId = null;

      if (currentSlug) {
        const safeSlug = escapeSql(currentSlug.trim());
        const curRows = await queryInsForge(`
          SELECT id, tags 
          FROM blog_posts 
          WHERE slug = '${safeSlug}' AND (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
          LIMIT 1;
        `);
        if (curRows.length > 0) {
          currentId = curRows[0].id;
          currentTags = Array.isArray(curRows[0].tags) ? curRows[0].tags : [];
        }
      }

      let excludeClause = currentId ? `AND id != '${escapeSql(currentId)}'` : '';
      let sql = '';

      if (currentTags.length > 0) {
        const safeTagsLiteral = currentTags.map(t => `'${escapeSql(t)}'`).join(',');
        sql = `
          SELECT id, slug, title, excerpt, featured_image, reading_time, author, tags, is_featured, published_at
          FROM blog_posts
          WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
          ${excludeClause}
          ORDER BY (
            CASE WHEN tags && ARRAY[${safeTagsLiteral}]::text[] THEN 1 ELSE 0 END
          ) DESC, published_at DESC, created_at DESC
          LIMIT ${limit};
        `;
      } else {
        sql = `
          SELECT id, slug, title, excerpt, featured_image, reading_time, author, tags, is_featured, published_at
          FROM blog_posts
          WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
          ${excludeClause}
          ORDER BY published_at DESC, created_at DESC
          LIMIT ${limit};
        `;
      }

      const rows = await queryInsForge(sql);
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
