// ============================================================
// GULLYGANG — PRODUCTION SECURE ADMIN API ROUTER
// Protected by InsForge Auth & Project Admin Role Verification
// ============================================================

const { queryInsForge, escapeSql, INSFORGE_HOST, INSFORGE_API_KEY } = require('./_db.js');

// Simple helper to parse request body
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Extract Bearer token from Authorization header
function getBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1].trim();
  }
  return null;
}

// Decode JWT payload safely without external dependencies
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

// Authenticate caller: Verify token & assert is_project_admin = true
async function verifyAdminAuth(req) {
  const token = getBearerToken(req);
  if (!token) return { isAuthorized: false, error: 'Missing authorization token', statusCode: 401 };

  const payload = decodeJwtPayload(token);
  const userId = payload?.sub || payload?.id || payload?.user_id;

  if (!userId) {
    return { isAuthorized: false, error: 'Invalid token structure', statusCode: 401 };
  }

  // Verify user existence and project admin privilege in Postgres
  try {
    const safeUserId = escapeSql(userId);
    const users = await queryInsForge(`
      SELECT id, email, is_project_admin, email_verified, profile 
      FROM auth.users 
      WHERE id = '${safeUserId}';
    `);

    if (users.length === 0) {
      return { isAuthorized: false, error: 'User not found', statusCode: 401 };
    }

    const user = users[0];
    if (!user.is_project_admin) {
      return { isAuthorized: false, error: 'Forbidden: Insufficient privileges. Project Admin required.', statusCode: 403 };
    }

    return { isAuthorized: true, user };
  } catch (err) {
    console.error('[AdminAPI] Auth verification error:', err);
    return { isAuthorized: false, error: 'Authentication verification failure', statusCode: 500 };
  }
}

// Sanitize HTML string to prevent XSS in blog content
function sanitizeHtml(dirty) {
  if (!dirty || typeof dirty !== 'string') return '';
  
  // 1. Remove dangerous script and iframe elements
  let clean = dirty
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // 2. Remove inline event handlers (onerror, onload, onclick, onmouseover, etc.)
  clean = clean.replace(/(\s)on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '$1');

  // 3. Remove javascript: pseudo-protocols in links and src
  clean = clean.replace(/(href|src)\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, '$1="#"');

  return clean;
}

// Validate & clean URL slug (lowercase, hyphen-separated, alphanumeric)
function sanitizeSlug(slug, fallbackTitle = '') {
  let s = (slug || fallbackTitle)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'article-' + Date.now();
}

// Extract YouTube ID from URL or return raw ID
function extractYouTubeId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return match ? match[1] : trimmed;
}

module.exports = async function handler(req, res) {
  // CORS & Standard Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

      // Authenticate against InsForge Auth endpoint
      const authRes = await fetch(`${INSFORGE_HOST}/api/auth/sessions?client_type=mobile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${INSFORGE_API_KEY}`
        },
        body: JSON.stringify({ email, password })
      });

      if (!authRes.ok) {
        // Safe generic message — zero account enumeration
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const authData = await authRes.json();
      const userId = authData.user?.id;

      // Verify if user is an approved project administrator
      const checkAdmin = await queryInsForge(`
        SELECT id, email, is_project_admin, profile 
        FROM auth.users 
        WHERE id = '${escapeSql(userId)}';
      `);

      if (checkAdmin.length === 0 || !checkAdmin[0].is_project_admin) {
        return res.status(403).json({
          error: 'Access denied. Your account is not authorized for administrative access.'
        });
      }

      return res.status(200).json({
        accessToken: authData.accessToken,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          profile: authData.user.profile || {},
          is_project_admin: true
        }
      });
    }

    // ==========================================================
    // ALL SUBSEQUENT ACTIONS REQUIRE ADMIN AUTHORIZATION
    // ==========================================================
    const auth = await verifyAdminAuth(req);
    if (!auth.isAuthorized) {
      return res.status(auth.statusCode || 401).json({ error: auth.error });
    }

    // ==========================================================
    // 2. SESSION VALIDATION
    // ==========================================================
    if (action === 'session') {
      return res.status(200).json({
        user: {
          id: auth.user.id,
          email: auth.user.email,
          profile: auth.user.profile || {},
          is_project_admin: auth.user.is_project_admin
        }
      });
    }

    // ==========================================================
    // 3. OVERVIEW / DASHBOARD STATS
    // ==========================================================
    if (action === 'overview') {
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
          playlists_total: parseInt(playlists[0]?.total || 0),
          playlists_active: parseInt(playlists[0]?.active || 0),
          songs_total: parseInt(songs[0]?.total || 0),
          visuals_total: parseInt(visuals[0]?.total || 0),
          visuals_active: parseInt(visuals[0]?.active || 0),
          blogs_total: parseInt(blogs[0]?.total || 0),
          blogs_published: parseInt(blogs[0]?.published || 0),
          messages_total: parseInt(messages[0]?.total || 0)
        },
        recentActivity
      });
    }

    // ==========================================================
    // 4. PLAYLISTS CRUD
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
        const displayOrder = parseInt(body.display_order || 0);
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
        if (!id) return res.status(400).json({ error: 'Playlist ID is required' });

        const name = (body.name || '').trim();
        const slug = sanitizeSlug(body.slug, name);
        const icon = (body.icon || '🎵').trim();
        const ytUrl = (body.youtube_playlist_url || '').trim();
        const bgImage = (body.bg_image || '').trim();
        const displayOrder = parseInt(body.display_order || 0);
        const isActive = body.is_active !== false;

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
        if (!id) return res.status(400).json({ error: 'Playlist ID is required' });

        // Clean up songs and delete playlist
        await queryInsForge(`DELETE FROM playlist_songs WHERE playlist_id = '${escapeSql(id)}';`);
        await queryInsForge(`DELETE FROM playlists WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 5. SONGS CRUD
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
        if (playlistId) conditions.push(`s.playlist_id = '${escapeSql(playlistId)}'`);
        if (q) conditions.push(`(s.title ILIKE '%${escapeSql(q)}%' OR s.artist ILIKE '%${escapeSql(q)}%')`);

        if (conditions.length > 0) sql += ` WHERE ` + conditions.join(' AND ');
        sql += ` ORDER BY s.display_order ASC, s.created_at ASC;`;

        const songs = await queryInsForge(sql);
        return res.status(200).json({ songs });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        
        // Handle batch reorder
        if (body.reorder && Array.isArray(body.reorder)) {
          for (const item of body.reorder) {
            if (item.id && typeof item.display_order === 'number') {
              await queryInsForge(`
                UPDATE playlist_songs 
                SET display_order = ${item.display_order} 
                WHERE id = '${escapeSql(item.id)}';
              `);
            }
          }
          return res.status(200).json({ success: true });
        }

        const playlistId = body.playlist_id;
        const ytId = extractYouTubeId(body.youtube_id || body.youtube_url);
        const title = (body.title || '').trim();
        const artist = (body.artist || 'GULLYGANG').trim();
        const thumbnail = (body.thumbnail || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`).trim();
        const displayOrder = parseInt(body.display_order || 0);
        const isActive = body.is_active !== false;

        if (!title) return res.status(400).json({ error: 'Song title is required' });
        if (!ytId) return res.status(400).json({ error: 'Valid YouTube URL or Video ID is required' });

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
        if (!id) return res.status(400).json({ error: 'Song ID is required' });

        const playlistId = body.playlist_id;
        const ytId = extractYouTubeId(body.youtube_id || body.youtube_url);
        const title = (body.title || '').trim();
        const artist = (body.artist || '').trim();
        const thumbnail = (body.thumbnail || '').trim();
        const displayOrder = parseInt(body.display_order || 0);
        const isActive = body.is_active !== false;

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
        if (!id) return res.status(400).json({ error: 'Song ID is required' });

        await queryInsForge(`DELETE FROM playlist_songs WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 6. VISUALS CRUD
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
        const displayOrder = parseInt(body.display_order || 0);
        const isActive = body.is_active !== false;

        if (!name) return res.status(400).json({ error: 'Visual name is required' });
        if (!videoUrl) return res.status(400).json({ error: 'Visual video URL is required' });

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
        if (!id) return res.status(400).json({ error: 'Visual ID is required' });

        const name = (body.name || '').trim();
        const videoUrl = (body.url || '').trim();
        const displayOrder = parseInt(body.display_order || 0);
        const isActive = body.is_active !== false;

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
        if (!id) return res.status(400).json({ error: 'Visual ID is required' });

        await queryInsForge(`DELETE FROM visuals WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 7. BLOG POSTS CRUD
    // ==========================================================
    if (action === 'blog') {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id');
        const slug = url.searchParams.get('slug');

        if (id) {
          const post = await queryInsForge(`SELECT * FROM blog_posts WHERE id = '${escapeSql(id)}';`);
          return res.status(200).json({ post: post[0] || null });
        }
        if (slug) {
          const post = await queryInsForge(`SELECT * FROM blog_posts WHERE slug = '${escapeSql(slug)}';`);
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
        if (!id) return res.status(400).json({ error: 'Blog post ID is required' });

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
        if (!id) return res.status(400).json({ error: 'Blog post ID is required' });

        await queryInsForge(`DELETE FROM blog_posts WHERE id = '${escapeSql(id)}';`);
        return res.status(200).json({ success: true });
      }
    }

    // ==========================================================
    // 8. ADVERTISEMENTS SETTINGS
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
    // 9. SITE SETTINGS
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
    // 10. ADMIN USERS MANAGEMENT
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

        // Create user via InsForge Auth
        const createRes = await fetch(`${INSFORGE_HOST}/api/auth/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${INSFORGE_API_KEY}`
          },
          body: JSON.stringify({ email, password, name })
        });

        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          return res.status(400).json({ error: errData.message || 'Failed to create user account' });
        }

        // Promote to project admin
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
    console.error('[AdminAPI] Server error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
};
