/**
 * api/music.js
 * GULLYGANG — Universal Music Search & Discovery API Router (Step 15)
 * Endpoints:
 *   GET /api/music?action=search&q=<query>&type=all|songs|artists|albums|videos&limit=20
 *   GET /api/music?action=artist&id=<artistId>
 *   GET /api/music?action=album&id=<albumId>
 *   GET /api/music?action=suggestions&q=<query>
 *   GET /api/music?action=related&videoId=<videoId>
 */

const musicProvider = require('./music-provider.js');

module.exports = async function handler(req, res) {
  // CORS & Security Headers
  const setHeader = (key, val) => {
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, val);
    }
  };

  setHeader('Access-Control-Allow-Origin', '*');
  setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  setHeader('Access-Control-Allow-Headers', 'Content-Type');
  setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      return res.status(204).end();
    }
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'GET') {
    setHeader('Allow', 'GET');
    const errBody = { success: false, error: 'Method not allowed. Use GET.' };
    if (typeof res.status === 'function') {
      return res.status(405).json(errBody);
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(errBody));
  }

  // Parse query parameters
  let queryObj = req.query || {};
  if (!req.query && req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost:3000');
      queryObj = {};
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        queryObj[k] = v;
      }
    } catch (_) {}
  }

  const action = (queryObj.action || 'search').toLowerCase().trim();

  // Helper response sender
  const sendJson = (statusCode, data, cacheHeader = null) => {
    if (cacheHeader) {
      setHeader('Cache-Control', cacheHeader);
    } else {
      setHeader('Cache-Control', 'no-store, max-age=0');
    }
    setHeader('Content-Type', 'application/json; charset=utf-8');

    if (typeof res.status === 'function') {
      return res.status(statusCode).json(data);
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(data));
  };

  try {
    // -----------------------------------------------------------
    // 1. UNIVERSAL SEARCH (Grouped 'all' or Filtered)
    // -----------------------------------------------------------
    if (action === 'search') {
      const q = (queryObj.q || queryObj.query || '').trim();

      if (!q || q.length < 2) {
        return sendJson(400, {
          success: false,
          error: 'Search query must be at least 2 characters'
        });
      }

      if (q.length > 150) {
        return sendJson(400, {
          success: false,
          error: 'Search query exceeds maximum length of 150 characters'
        });
      }

      const limit = Math.min(30, Math.max(1, parseInt(queryObj.limit, 10) || 20));
      const searchType = String(queryObj.type || queryObj.filter || 'all').toLowerCase().trim();
      const results = await musicProvider.searchMusic(q, limit, searchType);

      return sendJson(200, results, 'public, max-age=300, s-maxage=600, stale-while-revalidate=120');
    }

    // -----------------------------------------------------------
    // 2. DEDICATED ARTIST PROFILE & DISCOVERY
    // -----------------------------------------------------------
    if (action === 'artist') {
      const artistId = (queryObj.id || queryObj.artistId || '').trim();

      if (!artistId || artistId.length < 5) {
        return sendJson(400, {
          success: false,
          error: 'Invalid or missing artist ID'
        });
      }

      const artistData = await musicProvider.getArtist(artistId);
      if (!artistData || !artistData.success) {
        return sendJson(404, {
          success: false,
          error: 'Artist not found or unavailable'
        });
      }

      return sendJson(200, artistData, 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=300');
    }

    // -----------------------------------------------------------
    // 3. DEDICATED ALBUM & TRACKLIST
    // -----------------------------------------------------------
    if (action === 'album') {
      const albumId = (queryObj.id || queryObj.albumId || '').trim();

      if (!albumId || albumId.length < 5) {
        return sendJson(400, {
          success: false,
          error: 'Invalid or missing album ID'
        });
      }

      const albumData = await musicProvider.getAlbum(albumId);
      if (!albumData || !albumData.success) {
        return sendJson(404, {
          success: false,
          error: 'Album not found or unavailable'
        });
      }

      return sendJson(200, albumData, 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=300');
    }

    // -----------------------------------------------------------
    // 4. LIVE SEARCH SUGGESTIONS
    // -----------------------------------------------------------
    if (action === 'suggestions') {
      const q = (queryObj.q || queryObj.query || '').trim();

      if (!q || q.length < 2) {
        return sendJson(200, {
          success: true,
          query: q,
          suggestions: []
        }, 'public, max-age=60');
      }

      const limit = Math.min(10, Math.max(1, parseInt(queryObj.limit, 10) || 10));
      const sugs = await musicProvider.getMusicSuggestions(q, limit);

      return sendJson(200, sugs, 'public, max-age=180, s-maxage=300, stale-while-revalidate=60');
    }

    // -----------------------------------------------------------
    // 5. RELATED MUSIC / TRACK RECOMMENDATIONS
    // -----------------------------------------------------------
    if (action === 'related') {
      const videoId = (queryObj.videoId || queryObj.id || '').trim();

      if (!videoId || !/^[a-zA-Z0-9_-]{8,24}$/.test(videoId)) {
        return sendJson(400, {
          success: false,
          error: 'Invalid or missing YouTube videoId'
        });
      }

      const limit = Math.min(30, Math.max(1, parseInt(queryObj.limit, 10) || 15));
      const related = await musicProvider.getRelatedMusic(videoId, limit);

      return sendJson(200, related, 'public, max-age=300, s-maxage=600, stale-while-revalidate=120');
    }

    // Unknown action
    return sendJson(400, {
      success: false,
      error: `Unknown music API action: "${action}". Supported: "search", "artist", "album", "suggestions", "related".`
    });

  } catch (err) {
    console.error('[MusicAPI] Handler error:', err.message);
    return sendJson(500, {
      success: false,
      error: 'Music search service is temporarily unavailable. Please try again shortly.'
    });
  }
};
