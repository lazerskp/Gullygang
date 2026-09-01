// ============================================================
// GULLYGANG — PRODUCTION SECURE ADMIN API ROUTER
// Cryptographically verified by InsForge Auth & auth.users.is_project_admin
// ============================================================

const {
  getInsForgeHost,
  getInsForgeApiKey,
  queryInsForge,
  escapeSql,
  isValidUUID,
  isValidInteger,
  isValidSlug,
  isValidUrl
} = require('./_db.js');

// Dynamically load @insforge/sdk
let sdkModule = null;
async function getSdk() {
  if (!sdkModule) {
    sdkModule = await import('@insforge/sdk');
  }
  return sdkModule;
}

// Helper to parse request JSON body safely
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      // Guard against oversized payload attacks (max 2MB)
      if (data.length > 2 * 1024 * 1024) {
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Parse named cookie from request header
function getCookie(req, name) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Extract authentication token from HttpOnly cookie or Authorization header
function getAuthToken(req) {
  // 1. Primary: HttpOnly Session Cookie
  const cookieToken = getCookie(req, 'gullygang_admin_session');
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
  }

  // 2. Fallback: Bearer Token in Authorization header
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      return parts[1].trim();
    }
  }

  return null;
}

/**
 * Cryptographically verify incoming request with InsForge Auth and check database role.
 * NEVER trusts unverified client JWT payloads or sub claims.
 */
async function verifyAdminAuth(req) {
  const token = getAuthToken(req);
  if (!token) {
    return {
      isAuthorized: false,
      error: 'Authentication required. Please sign in.',
      statusCode: 401
    };
  }

  try {
    const { createClient } = await getSdk();
    const host = getInsForgeHost();

    // Create user-scoped InsForge client with token for cryptographic session verification
    const userClient = createClient({ baseUrl: host, accessToken: token });
    const { data, error } = await userClient.auth.getCurrentUser();

    if (error || !data?.user?.id) {
      return {
        isAuthorized: false,
        error: 'Invalid or expired session. Please sign in again.',
        statusCode: 401
      };
    }

    const authenticatedUserId = data.user.id;

    // Authoritative check against PostgreSQL auth.users table
    const safeUserId = escapeSql(authenticatedUserId);
    const users = await queryInsForge(`
      SELECT id, email, is_project_admin, email_verified, profile 
      FROM auth.users 
      WHERE id = '${safeUserId}'
      LIMIT 1;
    `);

    if (!users || users.length === 0) {
      return {
        isAuthorized: false,
        error: 'Authenticated user account not found.',
        statusCode: 401
      };
    }

    const user = users[0];
    if (!user.is_project_admin) {
      return {
        isAuthorized: false,
        error: 'Access denied. Your account is not authorized for administrative access.',
        statusCode: 403
      };
    }

    return { isAuthorized: true, user };
  } catch (err) {
    console.error('[AdminAPI] Verification exception:', err);
    return {
      isAuthorized: false,
      error: 'Authentication verification failure: ' + (err.message || 'Server error'),
      statusCode: 500
    };
  }
}

// Sanitize HTML string to prevent stored XSS in editorial content
function sanitizeHtml(dirty) {
  if (!dirty || typeof dirty !== 'string') return '';
  return dirty
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/(\s)on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '$1')
    .replace(/(href|src)\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, '$1="#"');
}

// Clean and validate URL slug
function sanitizeSlug(slug, fallbackTitle = '') {
  let s = (slug || fallbackTitle)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'item-' + Date.now();
}

// Extract standard 11-char YouTube ID
function extractYouTubeId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return match ? match[1] : '';
}

module.exports = async function handler(req, res) {
  // CORS & Security Headers
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || 'overview';

  try {
    // ==========================================================
    // 1. PUBLIC AUTH: LOGIN
    // ==========================================================
    if (action === 'login' && req.method === 'POST') {
      const body = await parseBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const { createClient } = await getSdk();
      const host = getInsForgeHost();
      const anonKey = process.env.INSFORGE_ANON_KEY;

      // Authenticate against official InsForge Auth service
      const authClient = createClient({ baseUrl: host, anonKey });
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });

      if (error || !data?.accessToken || !data?.user?.id) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Assert project admin privilege in PostgreSQL auth.users
      const safeUserId = escapeSql(data.user.id);
      const users = await queryInsForge(`
        SELECT id, email, is_project_admin, email_verified, profile 
        FROM auth.users 
        WHERE id = '${safeUserId}'
        LIMIT 1;
      `);

      if (!users || users.length === 0 || !users[0].is_project_admin) {
        return res.status(403).json({
          error: 'Access denied. Your account is not authorized for administrative access.'
        });
      }

      // Set secure HttpOnly session cookie
      const isProd = process.env.NODE_ENV === 'production';
      const cookieHeader = [
        `gullygang_admin_session=${data.accessToken}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${60 * 60 * 24 * 7}`, // 7 days
        ...(isProd ? ['Secure'] : [])
      ].join('; ');

      res.setHeader('Set-Cookie', cookieHeader);

      return res.status(200).json({
        success: true,
        accessToken: data.accessToken,
        user: {
          id: users[0].id,
          email: users[0].email,
          profile: users[0].profile || {},
          is_project_admin: true
        }
      });
    }

    // ==========================================================
    // 2. AUTH: LOGOUT
    // ==========================================================
    if (action === 'logout' && req.method === 'POST') {
      const token = getAuthToken(req);
      if (token) {
        try {
          const { createClient } = await getSdk();
          const host = getInsForgeHost();
          const userClient = createClient({ baseUrl: host, accessToken: token });
          await userClient.auth.signOut().catch(() => {});
        } catch (_) {}
      }

      // Clear the HttpOnly session cookie
      const clearCookieHeader = 'gullygang_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
      res.setHeader('Set-Cookie', clearCookieHeader);

      return res.status(200).json({ success: true, message: 'Signed out successfully' });
    }

    // ==========================================================
    // ALL SUBSEQUENT ACTIONS REQUIRE VERIFIED ADMIN AUTHORIZATION
    // ==========================================================
    const auth = await verifyAdminAuth(req);
    if (!auth.isAuthorized) {
      return res.status(auth.statusCode || 401).json({ error: auth.error });
    }

    // ==========================================================
    // 3. SESSION VALIDATION
    // ==========================================================
    if (action === 'session' && req.method === 'GET') {
      return res.status(200).json({
        is_authenticated: true,
        user: {
          id: auth.user.id,
          email: auth.user.email,
          profile: auth.user.profile || {},
          is_project_admin: auth.user.is_project_admin
        }
      });
    }

    // ==========================================================
    // 4. OVERVIEW / DASHBOARD STATS
    // ==========================================================
    if (action === 'overview' && req.method === 'GET') {
      const [playlists, songs, visuals, blogs, messages] = await Promise.all([
        queryInsForge('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active FROM playlists;'),
        queryInsForge('SELECT COUNT(*) as total FROM playlist_songs;'),
        queryInsForge('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active FROM visuals;'),
        queryInsForge('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = \'published\') as published FROM blog_posts;'),
        queryInsForge('SELECT COUNT(*) as total FROM contact_messages;')
      ]);

      const recentActivity = await queryInsForge(`
        SELECT 'blog' as type, title as label, created_at FROM blog_posts ORDER BY created_at DESC LIMIT 3
      `);

      return res.status(200).json({
        counts: {
          playlists_total: parseInt(playlists[0]?.total || 0, 10),
          playlists_active: parseInt(playlists[0]?.active || 0, 10),
          songs_total: parseInt(songs[0]?.total || 0, 10),
          visuals_total: parseInt(visuals[0]?.total || 0, 10),
          visuals_active: parseInt(visuals[0]?.active || 0, 10),
          blogs_total: parseInt(blogs[0]?.total || 0, 10),
          blogs_published: parseInt(blogs[0]?.published || 0, 10),
          messages_total: parseInt(messages[0]?.total || 0, 10)
        },
        recentActivity
      });
    }

    // ==========================================================
    // 5. PLAYLISTS CRUD
    // ==========================================================
    if (action === 'playlists') {
      if (req.method === 'GET') {
        const rows = await queryInsForge(`
          SELECT p.*, COUNT(s.id)::int as song_count
          FROM playlists p
          LEFT JOIN playlist_songs s ON p.id = s.playlist_id
          GROUP BY p.id
          ORDER BY p.display_order ASC, p.created_at DESC;
        `);
        return res.status(200).json({ playlists: rows });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const name = (body.name || '').trim();
        const slug = sanitizeSlug(body.slug, name);
        const icon = (body.icon || '🎵').trim();
        const ytUrl = (body.youtube_playlist_url || '').trim();
        const bgImage = (body.bg_image || '').trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!name) return res.status(400).json({ error: 'Playlist name is required' });

        const inserted = await queryInsForge(`
          INSERT INTO playlists (name, slug, icon, youtube_playlist_url, bg_image, display_order, is_active, created_at, updated_at)
          VALUES ('${escapeSql(name)}', '${escapeSql(slug)}', '${escapeSql(icon)}', '${escapeSql(ytUrl)}', '${escapeSql(bgImage)}', ${displayOrder}, ${isActive}, NOW(), NOW())
          RETURNING *;
        `);
        return res.status(201).json({ playlist: inserted[0] });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const id = body.id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Playlist UUID is required' });

        const name = (body.name || '').trim();
        const slug = sanitizeSlug(body.slug, name);
        const icon = (body.icon || '🎵').trim();
        const ytUrl = (body.youtube_playlist_url || '').trim();
        const bgImage = (body.bg_image || '').trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!name) return res.status(400).json({ error: 'Playlist name is required' });

        const updated = await queryInsForge(`
          UPDATE playlists
          SET name = '${escapeSql(name)}',
              slug = '${escapeSql(slug)}',
              icon = '${escapeSql(icon)}',
              youtube_playlist_url = '${escapeSql(ytUrl)}',
              bg_image = '${escapeSql(bgImage)}',
              display_order = ${displayOrder},
              is_active = ${isActive},
              updated_at = NOW()
          WHERE id = '${escapeSql(id)}'
          RETURNING *;
        `);
        return res.status(200).json({ playlist: updated[0] });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || (await parseBody(req)).id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Playlist UUID is required' });

        // Cascading song deletion and playlist removal
        await queryInsForge(`DELETE FROM playlist_songs WHERE playlist_id = '${escapeSql(id)}';`);
        await queryInsForge(`DELETE FROM playlists WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 6. SONGS CRUD
    // ==========================================================
    if (action === 'songs') {
      if (req.method === 'GET') {
        const playlistId = url.searchParams.get('playlist_id');
        const q = url.searchParams.get('q');
        let sql = `
          SELECT s.*, p.name as playlist_name 
          FROM playlist_songs s 
          LEFT JOIN playlists p ON s.playlist_id = p.id
        `;
        const conditions = [];
        if (playlistId && isValidUUID(playlistId)) {
          conditions.push(`s.playlist_id = '${escapeSql(playlistId)}'`);
        }
        if (q && q.trim()) {
          const safeQ = escapeSql(q.trim());
          conditions.push(`(s.title ILIKE '%${safeQ}%' OR s.artist ILIKE '%${safeQ}%')`);
        }

        if (conditions.length > 0) sql += ` WHERE ` + conditions.join(' AND ');
        sql += ` ORDER BY s.display_order ASC, s.created_at ASC;`;

        const songs = await queryInsForge(sql);
        return res.status(200).json({ songs });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);

        // Handle batch reorder payload
        if (body.reorder && Array.isArray(body.reorder)) {
          for (const item of body.reorder) {
            if (item.id && isValidUUID(item.id) && isValidInteger(item.display_order)) {
              await queryInsForge(`
                UPDATE playlist_songs 
                SET display_order = ${parseInt(item.display_order, 10)} 
                WHERE id = '${escapeSql(item.id)}';
              `);
            }
          }
          return res.status(200).json({ success: true });
        }

        const playlistId = body.playlist_id && isValidUUID(body.playlist_id) ? body.playlist_id : null;
        const ytId = extractYouTubeId(body.youtube_id || body.youtube_url);
        const title = (body.title || '').trim();
        const artist = (body.artist || 'GULLYGANG').trim();
        const thumbnail = (body.thumbnail || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`).trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!title) return res.status(400).json({ error: 'Song title is required' });
        if (!ytId) return res.status(400).json({ error: 'Valid YouTube URL or 11-character Video ID is required' });

        const inserted = await queryInsForge(`
          INSERT INTO playlist_songs (playlist_id, youtube_id, title, artist, thumbnail, display_order, is_active, created_at)
          VALUES (${playlistId ? `'${escapeSql(playlistId)}'` : 'NULL'}, '${escapeSql(ytId)}', '${escapeSql(title)}', '${escapeSql(artist)}', '${escapeSql(thumbnail)}', ${displayOrder}, ${isActive}, NOW())
          RETURNING *;
        `);
        return res.status(201).json({ song: inserted[0] });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const id = body.id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Song UUID is required' });

        const playlistId = body.playlist_id && isValidUUID(body.playlist_id) ? body.playlist_id : null;
        const ytId = extractYouTubeId(body.youtube_id || body.youtube_url);
        const title = (body.title || '').trim();
        const artist = (body.artist || '').trim();
        const thumbnail = (body.thumbnail || '').trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!title) return res.status(400).json({ error: 'Song title is required' });
        if (!ytId) return res.status(400).json({ error: 'Valid YouTube Video ID is required' });

        const updated = await queryInsForge(`
          UPDATE playlist_songs
          SET playlist_id = ${playlistId ? `'${escapeSql(playlistId)}'` : 'NULL'},
              youtube_id = '${escapeSql(ytId)}',
              title = '${escapeSql(title)}',
              artist = '${escapeSql(artist)}',
              thumbnail = '${escapeSql(thumbnail)}',
              display_order = ${displayOrder},
              is_active = ${isActive}
          WHERE id = '${escapeSql(id)}'
          RETURNING *;
        `);
        return res.status(200).json({ song: updated[0] });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || (await parseBody(req)).id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Song UUID is required' });

        await queryInsForge(`DELETE FROM playlist_songs WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 7. VISUALS CRUD
    // ==========================================================
    if (action === 'visuals') {
      if (req.method === 'GET') {
        const visuals = await queryInsForge(`
          SELECT * FROM visuals ORDER BY display_order ASC, created_at DESC;
        `);
        return res.status(200).json({ visuals });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const name = (body.name || '').trim();
        const videoUrl = (body.url || '').trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!name) return res.status(400).json({ error: 'Visual atmosphere name is required' });
        if (!videoUrl || !isValidUrl(videoUrl)) return res.status(400).json({ error: 'A valid HTTP/HTTPS Video URL is required' });

        const inserted = await queryInsForge(`
          INSERT INTO visuals (name, url, display_order, is_active, created_at, updated_at)
          VALUES ('${escapeSql(name)}', '${escapeSql(videoUrl)}', ${displayOrder}, ${isActive}, NOW(), NOW())
          RETURNING *;
        `);
        return res.status(201).json({ visual: inserted[0] });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const id = body.id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Visual UUID is required' });

        const name = (body.name || '').trim();
        const videoUrl = (body.url || '').trim();
        const displayOrder = isValidInteger(body.display_order) ? parseInt(body.display_order, 10) : 0;
        const isActive = body.is_active !== false;

        if (!name) return res.status(400).json({ error: 'Visual atmosphere name is required' });
        if (!videoUrl || !isValidUrl(videoUrl)) return res.status(400).json({ error: 'A valid Video URL is required' });

        const updated = await queryInsForge(`
          UPDATE visuals
          SET name = '${escapeSql(name)}',
              url = '${escapeSql(videoUrl)}',
              display_order = ${displayOrder},
              is_active = ${isActive},
              updated_at = NOW()
          WHERE id = '${escapeSql(id)}'
          RETURNING *;
        `);
        return res.status(200).json({ visual: updated[0] });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || (await parseBody(req)).id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Visual UUID is required' });

        await queryInsForge(`DELETE FROM visuals WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 8. BLOG POSTS CRUD
    // ==========================================================
    if (action === 'blog') {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id');
        const slug = url.searchParams.get('slug');

        if (id && isValidUUID(id)) {
          const post = await queryInsForge(`SELECT * FROM blog_posts WHERE id = '${escapeSql(id)}';`);
          return res.status(200).json({ post: post[0] || null });
        }
        if (slug) {
          const post = await queryInsForge(`SELECT * FROM blog_posts WHERE slug = '${escapeSql(slug.trim())}';`);
          return res.status(200).json({ post: post[0] || null });
        }

        const posts = await queryInsForge(`
          SELECT id, slug, title, excerpt, featured_image, reading_time, author, status, published_at, created_at, updated_at 
          FROM blog_posts 
          ORDER BY published_at DESC, created_at DESC;
        `);
        return res.status(200).json({ posts });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const title = (body.title || '').trim();
        const slug = sanitizeSlug(body.slug, title);
        const excerpt = (body.excerpt || '').trim();
        const content = sanitizeHtml(body.content || '');
        const featuredImage = (body.featured_image || '').trim();
        const readingTime = (body.reading_time || '5 min read').trim();
        const author = (body.author || 'GULLYGANG Editorial').trim();
        const seoTitle = (body.seo_title || title).trim();
        const seoDesc = (body.seo_description || excerpt).trim();
        const status = body.status === 'draft' ? 'draft' : 'published';

        if (!title) return res.status(400).json({ error: 'Article title is required' });
        if (!content) return res.status(400).json({ error: 'Article content is required' });

        const inserted = await queryInsForge(`
          INSERT INTO blog_posts (slug, title, excerpt, content, featured_image, reading_time, author, seo_title, seo_description, status, published_at, created_at, updated_at)
          VALUES ('${escapeSql(slug)}', '${escapeSql(title)}', '${escapeSql(excerpt)}', '${escapeSql(content)}', '${escapeSql(featuredImage)}', '${escapeSql(readingTime)}', '${escapeSql(author)}', '${escapeSql(seoTitle)}', '${escapeSql(seoDesc)}', '${escapeSql(status)}', NOW(), NOW(), NOW())
          RETURNING *;
        `);
        return res.status(201).json({ post: inserted[0] });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const id = body.id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Blog Post UUID is required' });

        const title = (body.title || '').trim();
        const slug = sanitizeSlug(body.slug, title);
        const excerpt = (body.excerpt || '').trim();
        const content = sanitizeHtml(body.content || '');
        const featuredImage = (body.featured_image || '').trim();
        const readingTime = (body.reading_time || '5 min read').trim();
        const author = (body.author || 'GULLYGANG Editorial').trim();
        const seoTitle = (body.seo_title || title).trim();
        const seoDesc = (body.seo_description || excerpt).trim();
        const status = body.status === 'draft' ? 'draft' : 'published';

        if (!title) return res.status(400).json({ error: 'Article title is required' });
        if (!content) return res.status(400).json({ error: 'Article content is required' });

        const updated = await queryInsForge(`
          UPDATE blog_posts
          SET slug = '${escapeSql(slug)}',
              title = '${escapeSql(title)}',
              excerpt = '${escapeSql(excerpt)}',
              content = '${escapeSql(content)}',
              featured_image = '${escapeSql(featuredImage)}',
              reading_time = '${escapeSql(readingTime)}',
              author = '${escapeSql(author)}',
              seo_title = '${escapeSql(seoTitle)}',
              seo_description = '${escapeSql(seoDesc)}',
              status = '${escapeSql(status)}',
              updated_at = NOW()
          WHERE id = '${escapeSql(id)}'
          RETURNING *;
        `);
        return res.status(200).json({ post: updated[0] });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || (await parseBody(req)).id;
        if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'A valid Blog Post UUID is required' });

        await queryInsForge(`DELETE FROM blog_posts WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 9. ADVERTISEMENTS SETTINGS
    // ==========================================================
    if (action === 'ads') {
      if (req.method === 'GET') {
        const rows = await queryInsForge(`SELECT value FROM site_settings WHERE key = 'advertisements';`);
        const config = rows[0]?.value || {
          blog_ad_1_active: true,
          blog_ad_2_active: true,
          about_ad_1_active: true,
          about_ad_2_active: true,
          provider: 'adsterra',
          ad_label: 'ADVERTISEMENT'
        };
        return res.status(200).json({ ads: config });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const configJson = JSON.stringify(body);

        await queryInsForge(`
          INSERT INTO site_settings (key, value, updated_at)
          VALUES ('advertisements', '${escapeSql(configJson)}'::jsonb, NOW())
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW();
        `);
        return res.status(200).json({ success: true, ads: body });
      }
    }

    // ==========================================================
    // 10. SITE SETTINGS
    // ==========================================================
    if (action === 'settings') {
      if (req.method === 'GET') {
        const rows = await queryInsForge(`SELECT value FROM site_settings WHERE key = 'general_settings';`);
        const settings = rows[0]?.value || {
          site_name: 'GULLYGANG',
          tagline: 'Music That Feels Different',
          support_link: 'https://pages.razorpay.com/gullygang',
          instagram_url: 'https://instagram.com/gullygang',
          youtube_url: 'https://youtube.com/@gullygang',
          default_theme: 'dark',
          maintenance_mode: false
        };
        return res.status(200).json({ settings });
      }

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const settingsJson = JSON.stringify(body);

        await queryInsForge(`
          INSERT INTO site_settings (key, value, updated_at)
          VALUES ('general_settings', '${escapeSql(settingsJson)}'::jsonb, NOW())
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW();
        `);
        return res.status(200).json({ success: true, settings: body });
      }
    }

    // ==========================================================
    // 11. ADMIN USERS MANAGEMENT
    // ==========================================================
    if (action === 'users') {
      if (req.method === 'GET') {
        const users = await queryInsForge(`
          SELECT id, email, email_verified, is_project_admin, created_at, profile 
          FROM auth.users 
          ORDER BY created_at DESC;
        `);
        return res.status(200).json({ users });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const email = (body.email || '').trim().toLowerCase();
        const password = body.password || '';
        const name = (body.name || 'Admin User').trim();

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        const host = getInsForgeHost();
        const apiKey = getInsForgeApiKey();

        // Create user via InsForge Auth admin API
        const createRes = await fetch(`${host}/api/auth/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ email, password, name })
        });

        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          return res.status(400).json({ error: errData.message || 'Failed to create user account' });
        }

        // Elevate created user to project admin
        await queryInsForge(`
          UPDATE auth.users 
          SET email_verified = true, is_project_admin = true 
          WHERE email = '${escapeSql(email)}';
        `);

        return res.status(201).json({ success: true, email });
      }
    }

    return res.status(404).json({ error: `Unknown admin action: ${action}` });
  } catch (err) {
    console.error('[AdminAPI] Execution error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + (err.message || 'Unknown error') });
  }
};
