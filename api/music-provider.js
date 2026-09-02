/**
 * api/music-provider.js
 * GULLYGANG — Music Provider Abstraction Layer (Step 15)
 * Interfaces with ytmusicapi / Python service, caches normalized responses,
 * deduplicates concurrent requests, and provides fallback parsing for:
 *   - Universal Search (Grouped 'all' & Filtered 'songs', 'artists', 'albums', 'videos')
 *   - Dedicated Artist Profiles
 *   - Dedicated Album Details & Tracklists
 *   - Live Search Suggestions
 *   - Related Music
 */

const { spawn } = require('child_process');
const path = require('path');
const https = require('https');

// In-memory Cache Store with automatic TTL eviction
const cache = new Map();
const inFlightRequests = new Map();

const SEARCH_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const SUGGESTIONS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RELATED_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const ARTIST_TTL_MS = 30 * 60 * 1000;    // 30 minutes
const ALBUM_TTL_MS = 30 * 60 * 1000;     // 30 minutes
const REQUEST_TIMEOUT_MS = 6000;         // 6 seconds timeout

function getFromCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setInCache(key, data, ttlMs) {
  // Cap cache size to prevent memory bloat
  if (cache.size > 2000) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

/**
 * Normalize and sanitize individual track objects
 */
function normalizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const videoId = String(raw.videoId || raw.id || '').trim();
  if (!videoId || !/^[a-zA-Z0-9_-]{8,24}$/.test(videoId)) return null;

  const title = String(raw.title || 'Untitled Track').trim();

  let artists = [];
  if (Array.isArray(raw.artists)) {
    artists = raw.artists
      .map(a => {
        if (typeof a === 'string' && a.trim()) return { id: '', name: a.trim() };
        if (a && a.name) return { id: String(a.id || a.browseId || '').trim(), name: String(a.name).trim() };
        return null;
      })
      .filter(Boolean);
  } else if (raw.artist && typeof raw.artist === 'string') {
    artists = raw.artist.split(',').map(name => ({ id: '', name: name.trim() })).filter(Boolean);
  }

  if (artists.length === 0) {
    artists = [{ id: '', name: 'GULLYGANG' }];
  }

  const artist = artists.map(a => a.name).join(', ');
  const album = raw.album && typeof raw.album === 'string' ? raw.album.trim() : (raw.album && raw.album.name ? String(raw.album.name).trim() : '');
  const albumId = String(raw.albumId || (raw.album && (raw.album.id || raw.album.browseId)) || '').trim();
  
  let duration = raw.duration || '0:00';
  let durationSeconds = parseInt(raw.duration_seconds || raw.durationSeconds, 10);
  
  if (isNaN(durationSeconds) || durationSeconds <= 0) {
    const parts = String(duration).split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      durationSeconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      durationSeconds = 0;
    }
  }

  let thumbnail = raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails.length ? (raw.thumbnails[raw.thumbnails.length - 1].url || raw.thumbnails[0].url) : '');
  if (!thumbnail || thumbnail.includes('placeholder')) {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  const resultType = raw.resultType || raw.type || 'song';
  const trackNumber = parseInt(raw.trackNumber, 10) || 1;

  return {
    id: videoId,
    videoId: videoId,
    title,
    artist,
    artists,
    album,
    albumId,
    duration,
    duration_seconds: durationSeconds,
    thumbnail,
    trackNumber,
    resultType,
    source: 'ytmusic'
  };
}

/**
 * Normalize and sanitize artist objects
 */
function normalizeArtist(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || raw.browseId || raw.channelId || '').trim();
  if (!id) return null;

  const name = String(raw.name || raw.artist || raw.title || 'Unknown Artist').trim();
  const thumbnail = String(raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails.length ? (raw.thumbnails[raw.thumbnails.length - 1].url || raw.thumbnails[0].url) : 'https://gullygang.in/brand-cover.png')).trim();
  const description = String(raw.description || '').trim();
  const subscribers = String(raw.subscribers || raw.views || '').trim();

  return {
    id,
    name,
    thumbnail,
    description,
    subscribers,
    resultType: 'artist',
    source: 'ytmusic'
  };
}

/**
 * Normalize and sanitize album objects
 */
function normalizeAlbum(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || raw.browseId || raw.playlistId || '').trim();
  if (!id) return null;

  const title = String(raw.title || raw.name || 'Untitled Album').trim();

  let artists = [];
  if (Array.isArray(raw.artists)) {
    artists = raw.artists
      .map(a => {
        if (typeof a === 'string' && a.trim()) return { id: '', name: a.trim() };
        if (a && a.name) return { id: String(a.id || a.browseId || '').trim(), name: String(a.name).trim() };
        return null;
      })
      .filter(Boolean);
  } else if (raw.artist && typeof raw.artist === 'string') {
    artists = raw.artist.split(',').map(name => ({ id: '', name: name.trim() })).filter(Boolean);
  }

  if (artists.length === 0) {
    artists = [{ id: '', name: 'GULLYGANG' }];
  }

  const artist = artists.map(a => a.name).join(', ');
  const year = String(raw.year || '').trim();
  const thumbnail = String(raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails.length ? (raw.thumbnails[raw.thumbnails.length - 1].url || raw.thumbnails[0].url) : 'https://gullygang.in/brand-cover.png')).trim();
  const description = String(raw.description || '').trim();
  const trackCount = parseInt(raw.trackCount, 10) || (Array.isArray(raw.tracks) ? raw.tracks.length : 0);
  const duration = String(raw.duration || '').trim();

  return {
    id,
    title,
    artist,
    artists,
    year,
    thumbnail,
    description,
    duration,
    trackCount,
    resultType: 'album',
    source: 'ytmusic'
  };
}

/**
 * Execute Python ytmusicapi service with timeout and error containment
 */
function callPythonService(action, arg1, arg2, arg3) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '..', 'services', 'ytmusic', 'app.py');
    const args = [pythonScript, action];
    if (arg1 !== undefined && arg1 !== null) args.push(String(arg1));
    if (arg2 !== undefined && arg2 !== null) args.push(String(arg2));
    if (arg3 !== undefined && arg3 !== null) args.push(String(arg3));

    const child = spawn('python3', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error('Music provider service request timed out'));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        return reject(new Error(`Music provider exited with code ${code}`));
      }

      try {
        const lines = stdout.trim().split('\n');
        let jsonStr = '';
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i].trim();
          if (l.startsWith('{') && l.endsWith('}')) {
            jsonStr = l;
            break;
          }
        }
        if (!jsonStr) {
          return reject(new Error('Invalid response from music provider service'));
        }
        const parsed = JSON.parse(jsonStr);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Failed to parse music provider response'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fast direct HTTP fallback for suggestions
 */
function fetchHttpSuggestions(query, limit = 10) {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(query)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const match = data.match(/\[\s*"[^"]+"\s*,\s*(\[.*?\])\s*\]/);
          if (match) {
            const items = JSON.parse(match[1]);
            const suggestions = items
              .map(i => Array.isArray(i) ? i[0] : (typeof i === 'string' ? i : null))
              .filter(Boolean)
              .slice(0, limit);
            return resolve(suggestions);
          }
        } catch (_) {}
        resolve([]);
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve([]);
    });
  });
}

async function searchMusic(query, arg2 = 20, arg3 = 'all') {
  const cleanQuery = (query || '').trim();
  if (cleanQuery.length < 2) {
    throw new Error('Search query must be at least 2 characters');
  }
  if (cleanQuery.length > 150) {
    throw new Error('Search query must not exceed 150 characters');
  }

  let cleanLimit = 20;
  let cleanType = 'all';

  if (typeof arg2 === 'number') {
    cleanLimit = arg2;
    cleanType = String(arg3 || 'all').toLowerCase().trim();
  } else if (typeof arg2 === 'string') {
    const norm = arg2.toLowerCase().trim();
    if (['all', 'songs', 'artists', 'albums', 'videos'].includes(norm)) {
      cleanType = norm;
      cleanLimit = parseInt(arg3, 10) || 20;
    } else {
      cleanLimit = parseInt(arg2, 10) || 20;
      cleanType = String(arg3 || 'all').toLowerCase().trim();
    }
  }

  cleanLimit = Math.min(30, Math.max(1, cleanLimit));
  const cacheKey = `search:${cleanType}:${cleanQuery.toLowerCase()}:${cleanLimit}`;

  // 1. Check cache
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. In-flight request deduplication
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const resp = await callPythonService('search', cleanQuery, cleanLimit, cleanType);
      if (resp && resp.success) {
        if (cleanType === 'all' && resp.results && typeof resp.results === 'object' && !Array.isArray(resp.results)) {
          const grouped = resp.results;
          const result = {
            success: true,
            query: cleanQuery,
            type: 'all',
            results: {
              top: (grouped.top || []).map(r => r.resultType === 'artist' ? normalizeArtist(r) : (r.resultType === 'album' ? normalizeAlbum(r) : normalizeTrack(r))).filter(Boolean),
              songs: (grouped.songs || []).map(normalizeTrack).filter(Boolean),
              artists: (grouped.artists || []).map(normalizeArtist).filter(Boolean),
              albums: (grouped.albums || []).map(normalizeAlbum).filter(Boolean),
              videos: (grouped.videos || []).map(normalizeTrack).filter(Boolean)
            }
          };
          setInCache(cacheKey, result, SEARCH_TTL_MS);
          return result;
        } else if (Array.isArray(resp.results)) {
          let normalized = [];
          if (cleanType === 'artists') {
            normalized = resp.results.map(normalizeArtist).filter(Boolean);
          } else if (cleanType === 'albums') {
            normalized = resp.results.map(normalizeAlbum).filter(Boolean);
          } else {
            normalized = resp.results.map(normalizeTrack).filter(Boolean);
          }
          const result = {
            success: true,
            query: cleanQuery,
            type: cleanType,
            results: normalized.slice(0, cleanLimit)
          };
          setInCache(cacheKey, result, SEARCH_TTL_MS);
          return result;
        }
      }
      throw new Error('Provider did not return search results');
    } catch (err) {
      console.warn('[MusicProvider] Search notice:', err.message);
      return {
        success: true,
        query: cleanQuery,
        type: cleanType,
        results: cleanType === 'all' ? { top: [], songs: [], artists: [], albums: [], videos: [] } : []
      };
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Dedicated Artist Profile Provider Method
 */
async function getArtist(artistId) {
  const cleanId = String(artistId || '').trim();
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid or missing artist ID');
  }

  const cacheKey = `artist:${cleanId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const resp = await callPythonService('artist', cleanId);
      if (resp && resp.success && resp.artist) {
        const result = {
          success: true,
          artist: normalizeArtist(resp.artist),
          topSongs: (resp.topSongs || []).map(normalizeTrack).filter(Boolean),
          albums: (resp.albums || []).map(normalizeAlbum).filter(Boolean),
          singles: (resp.singles || []).map(normalizeAlbum).filter(Boolean),
          relatedArtists: (resp.relatedArtists || []).map(normalizeArtist).filter(Boolean)
        };
        setInCache(cacheKey, result, ARTIST_TTL_MS);
        return result;
      }
      throw new Error(resp?.error || 'Artist profile unavailable');
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Dedicated Album & Tracklist Provider Method
 */
async function getAlbum(albumId) {
  const cleanId = String(albumId || '').trim();
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid or missing album ID');
  }

  const cacheKey = `album:${cleanId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const resp = await callPythonService('album', cleanId);
      if (resp && resp.success && resp.album) {
        const result = {
          success: true,
          album: normalizeAlbum(resp.album),
          tracks: (resp.tracks || []).map(normalizeTrack).filter(Boolean)
        };
        setInCache(cacheKey, result, ALBUM_TTL_MS);
        return result;
      }
      throw new Error(resp?.error || 'Album unavailable');
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Universal Suggestions method
 */
async function getMusicSuggestions(query, limit = 10) {
  const cleanQuery = (query || '').trim();
  if (cleanQuery.length < 2) {
    return { success: true, query: cleanQuery, suggestions: [] };
  }

  const cleanLimit = Math.min(10, Math.max(1, parseInt(limit, 10) || 10));
  const cacheKey = `sug:${cleanQuery.toLowerCase()}:${cleanLimit}`;

  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      let suggestions = [];
      try {
        const resp = await callPythonService('suggestions', cleanQuery, cleanLimit);
        if (resp && resp.success && Array.isArray(resp.suggestions)) {
          suggestions = resp.suggestions.slice(0, cleanLimit);
        }
      } catch (_) {
        suggestions = await fetchHttpSuggestions(cleanQuery, cleanLimit);
      }

      if (suggestions.length === 0) {
        suggestions = await fetchHttpSuggestions(cleanQuery, cleanLimit);
      }

      const result = {
        success: true,
        query: cleanQuery,
        suggestions: suggestions.slice(0, cleanLimit)
      };

      setInCache(cacheKey, result, SUGGESTIONS_TTL_MS);
      return result;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Universal Related Music method
 */
async function getRelatedMusic(videoId, limit = 15) {
  const cleanId = (videoId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]{8,24}$/.test(cleanId)) {
    throw new Error('Invalid YouTube videoId format');
  }

  const cleanLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 15));
  const cacheKey = `related:${cleanId}:${cleanLimit}`;

  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const resp = await callPythonService('related', cleanId, cleanLimit);
      if (resp && resp.success && Array.isArray(resp.results)) {
        const normalized = resp.results
          .map(normalizeTrack)
          .filter(Boolean)
          .slice(0, cleanLimit);

        const result = {
          success: true,
          videoId: cleanId,
          results: normalized
        };

        setInCache(cacheKey, result, RELATED_TTL_MS);
        return result;
      }
      return {
        success: true,
        videoId: cleanId,
        results: []
      };
    } catch (err) {
      console.warn('[MusicProvider] Related music error:', err.message);
      return {
        success: true,
        videoId: cleanId,
        results: []
      };
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

function clearCache() {
  cache.clear();
  inFlightRequests.clear();
}

module.exports = {
  searchMusic,
  getArtist,
  getAlbum,
  getMusicSuggestions,
  getSuggestions: getMusicSuggestions,
  getSearchSuggestions: getMusicSuggestions,
  getRelatedMusic,
  getRelatedTracks: getRelatedMusic,
  normalizeTrack,
  normalizeArtist,
  normalizeAlbum,
  clearCache
};
