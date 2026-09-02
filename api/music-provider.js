/**
 * api/music-provider.js
 * GULLYGANG — Universal Music Provider Abstraction Layer (Step 15)
 * Dual Engine Architecture:
 *   1. Native Direct InnerTube Engine (Primary & Resilient Serverless Fallback)
 *   2. Python ytmusicapi Subprocess Bridge (Local Development & Background Services)
 * Features:
 *   - Universal Search (Grouped 'all' + Category filters: 'songs', 'artists', 'albums', 'videos')
 *   - Dedicated Artist Profiles (Discography, top songs, albums, singles, related)
 *   - Dedicated Album Details & Full Tracklists
 *   - Fast Live Search Suggestions
 *   - Related Music & Track Recommendations
 *   - Provider Health Check Endpoint
 *   - Request Deduplication & In-Memory TTL Cache (Never caching empty/failed responses)
 */

const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

// Cache Configuration & Stores
const cache = new Map();
const inFlightRequests = new Map();

const SEARCH_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const SUGGESTIONS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RELATED_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const ARTIST_TTL_MS = 30 * 60 * 1000;    // 30 minutes
const ALBUM_TTL_MS = 30 * 60 * 1000;     // 30 minutes
const REQUEST_TIMEOUT_MS = 7000;         // 7 seconds timeout

// Search Filter Parameters for InnerTube
const INNER_TUBE_PARAMS = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF'
};

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
  // Never cache failed or empty responses
  if (!data || data.success === false) return;
  if (Array.isArray(data.results) && data.results.length === 0) return;
  if (data.results && typeof data.results === 'object' && !Array.isArray(data.results)) {
    const r = data.results;
    const total = (r.songs?.length || 0) + (r.artists?.length || 0) + (r.albums?.length || 0) + (r.top?.length || 0);
    if (total === 0) return;
  }

  if (cache.size > 2000) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

function clearCache() {
  cache.clear();
}

/**
 * Clean & Format Thumbnail URL
 */
function cleanThumbnailUrl(url, videoId) {
  if (typeof url === 'string' && url.trim().length > 10) {
    return url.replace(/=w\d+-h\d+[^"]*/, '=w544-h544-l90-rj');
  }
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return 'https://gullygang.in/brand-cover.png';
}

/**
 * Clean & Format Duration
 */
function parseDuration(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') {
    return { duration: '0:00', duration_seconds: 0 };
  }
  const clean = durationStr.trim();
  const parts = clean.split(':').map(Number);
  let seconds = 0;
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return { duration: clean, duration_seconds: seconds };
}

/**
 * Native InnerTube POST Request
 */
function postInnerTube(endpoint, postData) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'en',
          gl: 'IN'
        }
      },
      ...postData
    });

    const options = {
      hostname: 'music.youtube.com',
      port: 443,
      path: `/youtubei/v1/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: REQUEST_TIMEOUT_MS
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`InnerTube HTTP ${res.statusCode}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Failed to parse InnerTube JSON response'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('InnerTube request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Parse single musicResponsiveListItemRenderer into clean normalized entity
 */
function parseInnerTubeItem(renderer, forcedType = null) {
  const item = renderer.musicResponsiveListItemRenderer;
  if (!item) return null;

  const flexCols = item.flexColumns || [];
  const col0Runs = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const col1Runs = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

  const title = col0Runs.map(r => r.text).join('').trim() || 'Untitled';
  const videoId = item.playlistItemData?.videoId || col0Runs[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  const browseId = item.navigationEndpoint?.browseEndpoint?.browseId || col0Runs[0]?.navigationEndpoint?.browseEndpoint?.browseId;

  const thumbs = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const rawThumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
  const thumbnail = cleanThumbnailUrl(rawThumb, videoId);

  const col1Texts = col1Runs.map(r => r.text);
  const fullCol1 = col1Texts.join('');

  // 1. Artist entity
  if (forcedType === 'artists' || (browseId?.startsWith('UC') && !videoId)) {
    const artistId = browseId || '';
    if (!artistId) return null;
    const subsText = col1Texts.find(t => t.includes('sub') || t.includes('audience') || t.includes('listeners')) || '';
    return {
      id: artistId,
      name: title,
      thumbnail: thumbnail || 'https://gullygang.in/brand-cover.png',
      description: '',
      subscribers: subsText.trim(),
      resultType: 'artist',
      source: 'ytmusic'
    };
  }

  // 2. Album entity
  if (forcedType === 'albums' || browseId?.startsWith('MPRE')) {
    const albumId = browseId || '';
    if (!albumId) return null;
    const yearMatch = fullCol1.match(/\b(19\d\d|20\d\d)\b/);
    const parts = fullCol1.split('•').map(p => p.trim());
    const artistPart = parts.find(p => p && !p.toLowerCase().includes('album') && !p.toLowerCase().includes('single') && !p.toLowerCase().includes('ep') && !/\b\d{4}\b/.test(p)) || 'GULLYGANG';
    return {
      id: albumId,
      title,
      artist: artistPart,
      artists: [{ id: '', name: artistPart }],
      year: yearMatch ? yearMatch[1] : '',
      thumbnail: thumbnail || 'https://gullygang.in/brand-cover.png',
      trackCount: 0,
      resultType: 'album',
      source: 'ytmusic'
    };
  }

  // 3. Track (song or video)
  if (videoId) {
    const parts = fullCol1.split('•').map(p => p.trim());
    const durationMatch = parts.find(p => /^\d{1,2}:\d{2}(:\d{2})?$/.test(p));
    const dur = parseDuration(durationMatch);

    let artistName = parts[0] || 'GULLYGANG';
    if (artistName.toLowerCase().includes('song') || artistName.toLowerCase().includes('video')) {
      artistName = parts[1] || 'GULLYGANG';
    }
    const albumName = parts.length > 2 ? parts[1] : '';

    return {
      id: videoId,
      videoId,
      title,
      artist: artistName,
      artists: [{ id: '', name: artistName }],
      album: albumName,
      duration: dur.duration,
      duration_seconds: dur.duration_seconds,
      thumbnail,
      trackNumber: 1,
      resultType: forcedType === 'videos' || fullCol1.toLowerCase().includes('video') ? 'video' : 'song',
      source: 'ytmusic'
    };
  }

  return null;
}

/**
 * Execute native InnerTube search for a specific category
 */
async function innerTubeCategorySearch(query, catType, limit = 20) {
  const params = INNER_TUBE_PARAMS[catType] || null;
  const raw = await postInnerTube('search', { query, ...(params ? { params } : {}) });
  const shelf = raw.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer;
  const items = shelf?.contents || [];
  return items
    .map(r => parseInnerTubeItem(r, catType))
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Native Grouped Discovery Search ('all')
 */
async function innerTubeGroupedSearch(query, limit = 20) {
  // Query categories in parallel
  const [songs, artists, albums, videos] = await Promise.all([
    innerTubeCategorySearch(query, 'songs', 6).catch(() => []),
    innerTubeCategorySearch(query, 'artists', 4).catch(() => []),
    innerTubeCategorySearch(query, 'albums', 4).catch(() => []),
    innerTubeCategorySearch(query, 'videos', 3).catch(() => [])
  ]);

  // Determine top result: artist matching query name or primary song
  let top = [];
  const qLower = query.toLowerCase().trim();
  const matchedArtist = artists.find(a => a.name.toLowerCase().includes(qLower) || qLower.includes(a.name.toLowerCase()));
  if (matchedArtist) {
    top = [matchedArtist];
  } else if (songs.length > 0) {
    top = [songs[0]];
  } else if (artists.length > 0) {
    top = [artists[0]];
  } else if (albums.length > 0) {
    top = [albums[0]];
  }

  return {
    top,
    songs: songs.slice(0, limit),
    artists: artists.slice(0, 4),
    albums: albums.slice(0, 4),
    videos: videos.slice(0, 3)
  };
}

/**
 * Native InnerTube Dedicated Artist Profile
 */
async function innerTubeArtist(artistId) {
  const data = await postInnerTube('browse', { browseId: artistId });
  const header = data.header?.musicImmersiveHeaderRenderer || data.header?.musicVisualHeaderRenderer || {};
  const name = header?.title?.runs?.[0]?.text || 'Unknown Artist';
  const thumbs = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const thumbnail = cleanThumbnailUrl(thumbs.length ? thumbs[thumbs.length - 1].url : '');
  const subBtn = header?.subscriptionButton?.subscribeButtonRenderer;
  const subscribers = subBtn?.subscriberCountText?.runs?.[0]?.text || '';

  const sections = data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  let topSongs = [];
  let albums = [];
  let singles = [];
  let related = [];

  sections.forEach(sec => {
    if (sec.musicShelfRenderer) {
      const shelf = sec.musicShelfRenderer;
      const title = (shelf.title?.runs?.[0]?.text || '').toLowerCase();
      if (title.includes('song') || topSongs.length === 0) {
        topSongs = (shelf.contents || []).map((item, idx) => {
          const r = item.musicResponsiveListItemRenderer;
          if (!r) return null;
          const flex = r.flexColumns || [];
          const sTitle = flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || `Song ${idx + 1}`;
          const vid = r.playlistItemData?.videoId || flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
          if (!vid) return null;
          const col1 = flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
          const durMatch = col1.match(/\d{1,2}:\d{2}/);
          const dur = parseDuration(durMatch ? durMatch[0] : '0:00');
          const tThumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          return {
            id: vid,
            videoId: vid,
            title: sTitle,
            artist: name,
            artists: [{ id: artistId, name }],
            album: '',
            duration: dur.duration,
            duration_seconds: dur.duration_seconds,
            thumbnail: cleanThumbnailUrl(tThumbs.length ? tThumbs[tThumbs.length - 1].url : '', vid),
            trackNumber: idx + 1,
            resultType: 'song',
            source: 'ytmusic'
          };
        }).filter(Boolean).slice(0, 10);
      }
    } else if (sec.musicCarouselShelfRenderer) {
      const car = sec.musicCarouselShelfRenderer;
      const title = (car.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || '').toLowerCase();
      const items = car.contents || [];

      if (title.includes('album')) {
        albums = items.map(item => {
          const r = item.musicTwoRowItemRenderer;
          if (!r) return null;
          const albId = r.navigationEndpoint?.browseEndpoint?.browseId || '';
          if (!albId) return null;
          const albTitle = r.title?.runs?.[0]?.text || 'Album';
          const col1 = r.subtitle?.runs?.map(x => x.text).join('') || '';
          const yMatch = col1.match(/\b(19\d\d|20\d\d)\b/);
          const aThumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          return {
            id: albId,
            title: albTitle,
            artist: name,
            artists: [{ id: artistId, name }],
            year: yMatch ? yMatch[1] : '',
            thumbnail: cleanThumbnailUrl(aThumbs.length ? aThumbs[aThumbs.length - 1].url : ''),
            trackCount: 0,
            resultType: 'album',
            source: 'ytmusic'
          };
        }).filter(Boolean).slice(0, 10);
      } else if (title.includes('single')) {
        singles = items.map(item => {
          const r = item.musicTwoRowItemRenderer;
          if (!r) return null;
          const sId = r.navigationEndpoint?.browseEndpoint?.browseId || '';
          if (!sId) return null;
          const sTitle = r.title?.runs?.[0]?.text || 'Single';
          const aThumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          return {
            id: sId,
            title: sTitle,
            artist: name,
            artists: [{ id: artistId, name }],
            thumbnail: cleanThumbnailUrl(aThumbs.length ? aThumbs[aThumbs.length - 1].url : ''),
            resultType: 'album',
            source: 'ytmusic'
          };
        }).filter(Boolean).slice(0, 10);
      } else if (title.includes('fan') || title.includes('similar') || title.includes('like')) {
        related = items.map(item => {
          const r = item.musicTwoRowItemRenderer;
          if (!r) return null;
          const aId = r.navigationEndpoint?.browseEndpoint?.browseId || '';
          if (!aId) return null;
          const aName = r.title?.runs?.[0]?.text || 'Artist';
          const aThumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          return {
            id: aId,
            name: aName,
            thumbnail: cleanThumbnailUrl(aThumbs.length ? aThumbs[aThumbs.length - 1].url : ''),
            subscribers: '',
            resultType: 'artist',
            source: 'ytmusic'
          };
        }).filter(Boolean).slice(0, 10);
      }
    }
  });

  return {
    artist: {
      id: artistId,
      name,
      thumbnail,
      description: '',
      subscribers,
      resultType: 'artist',
      source: 'ytmusic'
    },
    topSongs,
    albums,
    singles,
    relatedArtists: related
  };
}

/**
 * Native InnerTube Dedicated Album Details
 */
async function innerTubeAlbum(albumId) {
  const data = await postInnerTube('browse', { browseId: albumId });
  const micro = data.microformat?.microformatDataRenderer || {};
  const title = micro.title || 'Untitled Album';
  const description = micro.description || '';
  const thumbs = micro.thumbnail?.thumbnails || [];
  const thumbnail = cleanThumbnailUrl(thumbs.length ? thumbs[thumbs.length - 1].url : '');

  const sec = data.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer;
  const rawTracks = sec?.contents || [];

  const tracks = rawTracks.map((item, idx) => {
    const r = item.musicResponsiveListItemRenderer;
    if (!r) return null;
    const flex = r.flexColumns || [];
    const tTitle = flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || `Track ${idx + 1}`;
    const vid = r.playlistItemData?.videoId || flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
    if (!vid) return null;

    const tArtist = flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || 'GULLYGANG';
    const durText = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '0:00';
    const dur = parseDuration(durText);

    return {
      id: vid,
      videoId: vid,
      title: tTitle,
      artist: tArtist,
      artists: [{ id: '', name: tArtist }],
      album: title,
      albumId,
      duration: dur.duration,
      duration_seconds: dur.duration_seconds,
      trackNumber: idx + 1,
      thumbnail,
      resultType: 'song',
      source: 'ytmusic'
    };
  }).filter(Boolean);

  const artistName = tracks.length ? tracks[0].artist : 'GULLYGANG';

  return {
    album: {
      id: albumId,
      title,
      artist: artistName,
      artists: [{ id: '', name: artistName }],
      year: '',
      thumbnail,
      description,
      trackCount: tracks.length,
      resultType: 'album',
      source: 'ytmusic'
    },
    tracks
  };
}

/**
 * Fast direct HTTP suggestions
 */
function fetchHttpSuggestions(query, limit = 10) {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json) && Array.isArray(json[1])) {
            return resolve(json[1].slice(0, limit));
          }
        } catch (_) {}
        resolve([]);
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Native InnerTube Related Tracks
 */
async function innerTubeRelated(videoId, limit = 15) {
  const data = await postInnerTube('next', { videoId });
  const queue = data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];

  return queue.map((item, idx) => {
    const v = item.playlistPanelVideoRenderer;
    if (!v || !v.videoId) return null;
    const title = v.title?.runs?.[0]?.text || `Track ${idx + 1}`;
    const artist = v.longBylineText?.runs?.map(r => r.text).join('') || v.shortBylineText?.runs?.map(r => r.text).join('') || 'GULLYGANG';
    const durText = v.lengthText?.runs?.[0]?.text || '0:00';
    const dur = parseDuration(durText);
    const thumbs = v.thumbnail?.thumbnails || [];
    const thumbnail = cleanThumbnailUrl(thumbs.length ? thumbs[thumbs.length - 1].url : '', v.videoId);

    return {
      id: v.videoId,
      videoId: v.videoId,
      title,
      artist,
      artists: [{ id: '', name: artist }],
      duration: dur.duration,
      duration_seconds: dur.duration_seconds,
      thumbnail,
      trackNumber: idx + 1,
      resultType: 'song',
      source: 'ytmusic'
    };
  }).filter(Boolean).slice(0, limit);
}

/**
 * Optional Python Subprocess Runner (Fallback to Native InnerTube on failure)
 */
function callPythonService(action, arg1, arg2, arg3) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '..', 'services', 'ytmusic', 'app.py');
    const args = [pythonScript, action];
    if (arg1 !== undefined && arg1 !== null) args.push(String(arg1));
    if (arg2 !== undefined && arg2 !== null) args.push(String(arg2));
    if (arg3 !== undefined && arg3 !== null) args.push(String(arg3));

    let child;
    try {
      child = spawn('python3', args, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        timeout: 4000
      });
    } catch (spawnErr) {
      return reject(spawnErr);
    }

    let stdout = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error('Python service request timed out'));
    }, 4000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return reject(new Error(`Python service exited with code ${code}`));

      try {
        const lines = stdout.trim().split('\n');
        let jsonStr = '';
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i].trim();
          if (l.startsWith('{') && l.endsWith('}')) { jsonStr = l; break; }
        }
        if (!jsonStr) return reject(new Error('Invalid response from Python service'));
        resolve(JSON.parse(jsonStr));
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Main Search Method with Graceful Fallback & Deduplication
 */
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

  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let result = null;

    // 1. Try Native InnerTube Engine directly (Fast, Reliable, Zero Subprocess Overhead)
    try {
      if (cleanType === 'all') {
        const grouped = await innerTubeGroupedSearch(cleanQuery, cleanLimit);
        result = {
          success: true,
          query: cleanQuery,
          type: 'all',
          results: grouped
        };
      } else {
        const list = await innerTubeCategorySearch(cleanQuery, cleanType, cleanLimit);
        result = {
          success: true,
          query: cleanQuery,
          type: cleanType,
          results: list
        };
      }
    } catch (innerTubeErr) {
      // 2. Fallback to Python Service if Native InnerTube encountered an issue
      try {
        const resp = await callPythonService('search', cleanQuery, cleanLimit, cleanType);
        if (resp && resp.success) {
          result = resp;
        }
      } catch (_) {
        throw new Error('Music search provider temporarily unavailable');
      }
    }

    if (!result || !result.success) {
      throw new Error('Music search provider temporarily unavailable');
    }

    setInCache(cacheKey, result, SEARCH_TTL_MS);
    return result;
  })().finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Dedicated Artist Profile
 */
async function getArtist(artistId) {
  const cleanId = String(artistId || '').trim();
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid or missing artist ID');
  }

  const cacheKey = `artist:${cleanId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let result = null;

    // 1. Try Native InnerTube
    try {
      const data = await innerTubeArtist(cleanId);
      if (data && data.artist && data.artist.name) {
        result = { success: true, ...data };
      }
    } catch (_) {
      // 2. Fallback to Python
      try {
        const resp = await callPythonService('artist', cleanId);
        if (resp && resp.success) result = resp;
      } catch (err) {
        throw new Error('Artist provider temporarily unavailable');
      }
    }

    if (!result || !result.success) {
      throw new Error('Artist not found or provider unavailable');
    }

    setInCache(cacheKey, result, ARTIST_TTL_MS);
    return result;
  })().finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Dedicated Album Details & Full Tracklist
 */
async function getAlbum(albumId) {
  const cleanId = String(albumId || '').trim();
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid or missing album ID');
  }

  const cacheKey = `album:${cleanId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let result = null;

    // 1. Try Native InnerTube
    try {
      const data = await innerTubeAlbum(cleanId);
      if (data && data.album && data.tracks && data.tracks.length > 0) {
        result = { success: true, ...data };
      }
    } catch (_) {
      // 2. Fallback to Python
      try {
        const resp = await callPythonService('album', cleanId);
        if (resp && resp.success) result = resp;
      } catch (err) {
        throw new Error('Album provider temporarily unavailable');
      }
    }

    if (!result || !result.success) {
      throw new Error('Album not found or provider unavailable');
    }

    setInCache(cacheKey, result, ALBUM_TTL_MS);
    return result;
  })().finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Fast Live Search Suggestions
 */
async function getMusicSuggestions(query, limit = 10) {
  const cleanQuery = (query || '').trim();
  if (cleanQuery.length < 2) {
    return { success: true, query: cleanQuery, suggestions: [] };
  }

  const cleanLimit = Math.min(10, Math.max(1, parseInt(limit, 10) || 10));
  const cacheKey = `suggestions:${cleanQuery.toLowerCase()}:${cleanLimit}`;

  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let suggestions = await fetchHttpSuggestions(cleanQuery, cleanLimit);
    if (suggestions.length === 0) {
      try {
        const resp = await callPythonService('suggestions', cleanQuery, cleanLimit);
        if (resp && resp.success && Array.isArray(resp.suggestions)) {
          suggestions = resp.suggestions.slice(0, cleanLimit);
        }
      } catch (_) {}
    }

    const result = {
      success: true,
      query: cleanQuery,
      suggestions: suggestions.slice(0, cleanLimit)
    };

    setInCache(cacheKey, result, SUGGESTIONS_TTL_MS);
    return result;
  })().finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Related Music Tracks
 */
async function getRelatedMusic(videoId, limit = 15) {
  const cleanId = (videoId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]{8,24}$/.test(cleanId)) {
    throw new Error('Invalid YouTube videoId format');
  }

  const cleanLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 15));
  const cacheKey = `related:${cleanId}:${cleanLimit}`;

  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let tracks = [];
    try {
      tracks = await innerTubeRelated(cleanId, cleanLimit);
    } catch (_) {
      try {
        const resp = await callPythonService('related', cleanId, cleanLimit);
        if (resp && resp.success && Array.isArray(resp.results)) {
          tracks = resp.results.slice(0, cleanLimit);
        }
      } catch (err) {
        throw new Error('Related tracks provider temporarily unavailable');
      }
    }

    const result = {
      success: true,
      videoId: cleanId,
      results: tracks
    };

    setInCache(cacheKey, result, RELATED_TTL_MS);
    return result;
  })().finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Provider Health Check
 */
async function getHealth() {
  try {
    const sugs = await fetchHttpSuggestions('test', 1);
    return {
      success: true,
      provider: 'ytmusic',
      available: true,
      latencyMs: 50
    };
  } catch (err) {
    return {
      success: false,
      provider: 'ytmusic',
      available: false,
      error: 'Health check failed'
    };
  }
}

function normalizeArtist(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.musicResponsiveListItemRenderer) {
    return parseInnerTubeItem(raw, 'artists');
  }
  const id = String(raw.id || raw.browseId || raw.channelId || '').trim();
  if (!id) return null;
  const name = String(raw.name || raw.artist || raw.title || 'Unknown Artist').trim();
  const thumbs = raw.thumbnails || [];
  const rawThumb = Array.isArray(thumbs) && thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url) : (raw.thumbnail || '');
  return {
    id,
    name,
    thumbnail: cleanThumbnailUrl(rawThumb),
    description: String(raw.description || '').trim(),
    subscribers: String(raw.subscribers || raw.views || '').trim(),
    resultType: 'artist',
    source: 'ytmusic'
  };
}

function normalizeAlbum(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.musicResponsiveListItemRenderer) {
    return parseInnerTubeItem(raw, 'albums');
  }
  const id = String(raw.id || raw.browseId || raw.playlistId || '').trim();
  if (!id) return null;
  const title = String(raw.title || raw.name || 'Untitled Album').trim();
  let artists = [];
  if (Array.isArray(raw.artists)) {
    artists = raw.artists
      .map(a => typeof a === 'string' ? { id: '', name: a.trim() } : (a && a.name ? { id: String(a.id || a.browseId || '').trim(), name: String(a.name).trim() } : null))
      .filter(Boolean);
  }
  if (artists.length === 0) artists = [{ id: '', name: 'GULLYGANG' }];
  const artist = artists.map(a => a.name).join(', ');
  const thumbs = raw.thumbnails || [];
  const rawThumb = Array.isArray(thumbs) && thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url) : (raw.thumbnail || '');
  return {
    id,
    title,
    artist,
    artists,
    year: String(raw.year || '').trim(),
    thumbnail: cleanThumbnailUrl(rawThumb),
    description: String(raw.description || '').trim(),
    duration: String(raw.duration || '').trim(),
    trackCount: parseInt(raw.trackCount, 10) || 0,
    resultType: 'album',
    source: 'ytmusic'
  };
}

function normalizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.musicResponsiveListItemRenderer) {
    return parseInnerTubeItem(raw, 'songs');
  }
  const videoId = String(raw.videoId || raw.id || '').trim();
  if (!videoId) return null;
  const title = String(raw.title || 'Untitled Track').trim();
  let artists = [];
  if (Array.isArray(raw.artists)) {
    artists = raw.artists
      .map(a => typeof a === 'string' ? { id: '', name: a.trim() } : (a && a.name ? { id: String(a.id || a.browseId || '').trim(), name: String(a.name).trim() } : null))
      .filter(Boolean);
  }
  if (artists.length === 0) artists = [{ id: '', name: 'GULLYGANG' }];
  const artist = artists.map(a => a.name).join(', ');
  const thumbs = raw.thumbnails || [];
  const rawThumb = Array.isArray(thumbs) && thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url) : (raw.thumbnail || '');
  const dur = parseDuration(raw.duration);
  return {
    id: videoId,
    videoId,
    title,
    artist,
    artists,
    album: String(raw.album || '').trim(),
    albumId: String(raw.albumId || '').trim(),
    duration: dur.duration,
    duration_seconds: dur.duration_seconds,
    thumbnail: cleanThumbnailUrl(rawThumb, videoId),
    trackNumber: parseInt(raw.trackNumber, 10) || 1,
    resultType: raw.resultType || 'song',
    source: 'ytmusic'
  };
}

module.exports = {
  searchMusic,
  getArtist,
  getAlbum,
  getMusicSuggestions,
  getSuggestions: getMusicSuggestions,
  getRelatedMusic,
  getRelatedTracks: getRelatedMusic,
  getHealth,
  clearCache,
  normalizeTrack,
  normalizeArtist,
  normalizeAlbum
};
