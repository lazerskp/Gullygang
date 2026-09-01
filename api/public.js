// ============================================================
// GULLYGANG — SECURE PUBLIC READ-ONLY DATA ENDPOINT
// Proxies public read requests to InsForge without exposing API keys
// ============================================================
const crypto = require('crypto');
const {
  queryInsForge,
  escapeSql,
  isValidUUID,
  isValidSlug
} = require('./_db.js');

function computeETag(dataStr) {
  return `"${crypto.createHash('md5').update(dataStr).digest('hex')}"`;
}

function handleETag(req, res, data) {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const etag = computeETag(jsonStr);
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
    res.status(304).end();
    return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match, Last-Event-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type = url.searchParams.get('type') || 'playlists';

  try {
    // 0. Native Push Realtime Stream (Server-Sent Events with Cross-Instance Sync & Reconnect Recovery)
    if (type === 'events' || type === 'stream') {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform, no-store');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(200);

      const rows = await queryInsForge(`SELECT value, updated_at FROM site_settings WHERE key = 'sync_version';`);
      const val = rows[0]?.value || { version: Date.now() };
      let lastStreamVersion = val.version || Date.now();

      res.write(`event: init\ndata: ${JSON.stringify(val)}\n\n`);

      // Catch-up replay if client missed events during disconnection
      const sinceParam = url.searchParams.get('since_version') || req.headers['last-event-id'];
      if (sinceParam) {
        const sinceVer = parseInt(sinceParam, 10);
        if (!isNaN(sinceVer) && sinceVer < lastStreamVersion && val.last_event) {
          res.write(`event: sync\ndata: ${JSON.stringify(val)}\n\n`);
        }
      }

      const { registerSseSubscriber, unregisterSseSubscriber } = require('./_db.js');
      registerSseSubscriber(res);

      // Heartbeat + Cross-Instance DB Version Check every 5s
      let tick = 0;
      const interval = setInterval(async () => {
        try {
          tick++;
          // 1. Cross-instance database sync check
          const dbRows = await queryInsForge(`SELECT value, updated_at FROM site_settings WHERE key = 'sync_version';`);
          const currentVal = dbRows[0]?.value;
          if (currentVal && currentVal.version && currentVal.version > lastStreamVersion) {
            lastStreamVersion = currentVal.version;
            res.write(`event: sync\ndata: ${JSON.stringify(currentVal)}\n\n`);
          }

          // 2. Keep-alive heartbeat every 15s (every 3 ticks)
          if (tick % 3 === 0) {
            res.write(`event: ping\ndata: {"time":${Date.now()}}\n\n`);
          }
        } catch (_) {
          clearInterval(interval);
          unregisterSseSubscriber(res);
        }
      }, 5000);
      if (interval.unref) interval.unref();

      req.on('close', () => {
        clearInterval(interval);
        unregisterSseSubscriber(res);
      });

      return;
    }

    // 0.5 Lightweight sync version check (for offline recovery only)
    if (type === 'sync_version') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      const rows = await queryInsForge(`SELECT value, updated_at FROM site_settings WHERE key = 'sync_version';`);
      const val = rows[0]?.value || {};
      return res.status(200).json({
        version: val.version || 0,
        last_event: val.last_event || null,
        timestamp: Date.now()
      });
    }

    // 0.6 Dynamic XML Sitemap
    if (type === 'sitemap' || type === 'sitemap.xml') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400');

      const posts = await queryInsForge(`
        SELECT slug, title, excerpt, featured_image, updated_at, published_at
        FROM blog_posts
        WHERE status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW())
        ORDER BY published_at DESC;
      `);

      const baseUrl = 'https://gullygang.in';
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
      
      // Core pages
      xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
      xml += `  <url>\n    <loc>${baseUrl}/blog</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
      xml += `  <url>\n    <loc>${baseUrl}/top-10-rappers-in-india</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;

      for (const p of posts) {
        const lastMod = (p.updated_at || p.published_at || new Date().toISOString()).slice(0, 10);
        const imgTag = p.featured_image ? `\n    <image:image>\n      <image:loc>${p.featured_image.replace(/&/g, '&amp;')}</image:loc>\n      <image:title>${(p.title || '').replace(/&/g, '&amp;')}</image:title>\n    </image:image>` : '';
        xml += `  <url>\n    <loc>${baseUrl}/blog/${p.slug}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>${imgTag}\n  </url>\n`;
      }

      xml += `</urlset>`;
      if (handleETag(req, res, xml)) return;
      return res.status(200).send(xml);
    }

    // 1. Public Active Playlists
    if (type === 'playlists') {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
      const rows = await queryInsForge(`
        SELECT p.id, p.name, p.slug, p.icon, p.youtube_playlist_url, p.bg_image, p.display_order, p.is_active,
               COUNT(s.id)::int as song_count
        FROM playlists p
        LEFT JOIN playlist_songs s ON p.id = s.playlist_id AND (s.is_active IS NULL OR s.is_active = true)
        WHERE p.is_active = true
        GROUP BY p.id
        ORDER BY p.display_order ASC, p.created_at DESC;
      `);
      if (handleETag(req, res, rows)) return;
      return res.status(200).json(rows);
    }

    // 2. Public Songs for Playlist
    if (type === 'songs') {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
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
      if (handleETag(req, res, rows)) return;
      return res.status(200).json(rows);
    }

    // 3. Public Active Visuals
    if (type === 'visuals') {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
      const rows = await queryInsForge(`
        SELECT id, name, url, display_order
        FROM visuals
        WHERE is_active = true
        ORDER BY display_order ASC;
      `);
      if (handleETag(req, res, rows)) return;
      return res.status(200).json(rows);
    }

    // 4. Public Blog Posts & Articles
    if (type === 'blog' || type === 'article') {
      const slug = url.searchParams.get('slug');
      const tag = url.searchParams.get('tag');

      // Single Article Lookup
      if (type === 'article' || (type === 'blog' && slug)) {
        res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
        if (!slug || !isValidSlug(slug)) {
          return res.status(404).json({ error: 'Article not found' });
        }

        const rows = await queryInsForge(`
          SELECT id, slug, title, excerpt, content, featured_image, reading_time, author,
                 seo_title, seo_description, tags, is_featured, published_at, updated_at
          FROM blog_posts
          WHERE slug = '${escapeSql(slug.trim())}'
            AND (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
          LIMIT 1;
        `);

        if (!rows || rows.length === 0) {
          return res.status(404).json({ error: 'Article not found' });
        }
        if (handleETag(req, res, rows[0])) return;
        return res.status(200).json(rows[0]);
      }

      // Public Feed Query
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800');
      let sql = `
        SELECT id, slug, title, excerpt, featured_image, reading_time, author,
               tags, is_featured, published_at, updated_at
        FROM blog_posts
        WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
      `;

      if (tag && typeof tag === 'string') {
        const cleanTag = escapeSql(tag.trim().toLowerCase());
        sql += ` AND '${cleanTag}' = ANY(tags)`;
      }

      sql += ` ORDER BY is_featured DESC, published_at DESC, created_at DESC;`;

      const rows = await queryInsForge(sql);
      if (handleETag(req, res, rows)) return;
      return res.status(200).json(rows);
    }

    // 4.5 Related Stories (More from GULLYGANG)
    if (type === 'related_articles') {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
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
      if (handleETag(req, res, rows)) return;
      return res.status(200).json(rows);
    }

    // 5. Public Site Settings
    if (type === 'settings') {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
      const rows = await queryInsForge(`
        SELECT key, value FROM site_settings WHERE key IN ('general_settings', 'advertisements');
      `);
      const map = {};
      rows.forEach(r => map[r.key] = r.value);
      if (handleETag(req, res, map)) return;
      return res.status(200).json(map);
    }

    return res.status(404).json({ error: `Unknown public resource type: ${type}` });
  } catch (err) {
    console.error('[PublicAPI] Query error:', err);
    return res.status(500).json({ error: 'Failed to retrieve public data' });
  }
};
