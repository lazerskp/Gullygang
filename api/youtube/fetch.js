// ============================================================
// GULLYGANG — AUTHORITATIVE YOUTUBE PLAYLIST & VIDEO RESOLVER
// Multi-Tier Architecture: Data API v3 -> Universal Crawler -> RSS Feed
// STRICT ZERO DATABASE WRITES — Pure temporary in-memory session resolver
// Guaranteed real 11-char YouTube video IDs ONLY (Never returns playlist IDs as video IDs)
// ============================================================

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// ------------------------------------------------------------
// Rate Limiter Configuration (In-Memory Sliding Window)
// Max 15 requests per minute per IP to prevent abuse
// ------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 15;
const ipRequestHistory = new Map();

// ------------------------------------------------------------
// Response Cache Configuration (15-Minute Stale Cache)
// Protects external API quota and avoids redundant requests
// ------------------------------------------------------------
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const responseCache = new Map();

// ------------------------------------------------------------
// Single-Flight Request Deduplication
// Coalesces concurrent in-flight requests for the exact same media ID
// ------------------------------------------------------------
const inFlightRequests = new Map();

// Memory cleanup timer
setInterval(() => {
  const now = Date.now();
  for (const [ip, history] of ipRequestHistory.entries()) {
    const valid = history.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) {
      ipRequestHistory.delete(ip);
    } else {
      ipRequestHistory.set(ip, valid);
    }
  }

  for (const [key, entry] of responseCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Extract client IP address safely
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Check and record IP rate limiting
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const history = (ipRequestHistory.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  
  if (history.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  history.push(now);
  ipRequestHistory.set(ip, history);
  return true;
}

/**
 * Strict YouTube Input Parser & Validator
 * Returns { type: 'playlist' | 'video', id: string }
 * Strictly verifies that:
 * - Playlist ID starts with PL, UU, LL, RD, OLAK, etc. (10-64 chars)
 * - Video ID is exactly 11 characters
 * - Arbitrary URLs and non-YouTube hosts are rejected (No SSRF / Open Proxy)
 */
function parseAndValidateYouTubeInput(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();

  // Guard against payload abuse
  if (raw.length > 300) return null;

  // 1. URL Parsing
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    let parsedUrl;
    try {
      parsedUrl = new URL(raw);
    } catch {
      return null;
    }

    const host = parsedUrl.hostname.toLowerCase();
    const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
    if (!validHosts.includes(host)) {
      return null; // Reject non-YouTube domains
    }

    // A. Check for playlist parameter (?list=PL... or &list=PL...)
    const listParam = parsedUrl.searchParams.get('list');
    if (listParam && /^(?:PL|UU|LL|RD|OLAK5uy_)[A-Za-z0-9_-]{8,60}$/.test(listParam)) {
      return { type: 'playlist', id: listParam };
    }
    if (listParam && /^[A-Za-z0-9_-]{10,64}$/.test(listParam)) {
      return { type: 'playlist', id: listParam };
    }

    // B. Check for youtu.be/VIDEO_ID
    if (host === 'youtu.be') {
      const vidId = parsedUrl.pathname.slice(1).split('/')[0].split('?')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(vidId)) {
        return { type: 'video', id: vidId };
      }
    }

    // C. Check for ?v=VIDEO_ID
    const vParam = parsedUrl.searchParams.get('v');
    if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
      return { type: 'video', id: vParam };
    }

    // D. Check for /shorts/VIDEO_ID, /embed/VIDEO_ID, /v/VIDEO_ID
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && (pathParts[0] === 'shorts' || pathParts[0] === 'embed' || pathParts[0] === 'v')) {
      const vidId = pathParts[1];
      if (/^[A-Za-z0-9_-]{11}$/.test(vidId)) {
        return { type: 'video', id: vidId };
      }
    }

    return null;
  }

  // 2. Raw Playlist ID (starts with PL, UU, LL, RD, OLAK)
  if (/^(?:PL|UU|LL|RD|OLAK5uy_)[A-Za-z0-9_-]{8,60}$/.test(raw)) {
    return { type: 'playlist', id: raw };
  }

  // 3. Raw 11-char Video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return { type: 'video', id: raw };
  }

  return null;
}

/**
 * Normalize and validate thumbnail URL for a real 11-character video ID
 */
function getNormalizedThumbnail(thumbUrl, videoId) {
  if (thumbUrl && typeof thumbUrl === 'string' && thumbUrl.startsWith('https://')) {
    return thumbUrl.trim();
  }
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return 'favicon.png';
}

/**
 * Check if a title indicates deleted, private, or unavailable video
 */
function isUnavailableTitle(title) {
  if (!title || typeof title !== 'string') return true;
  const lower = title.trim().toLowerCase();
  return (
    lower === 'private video' ||
    lower === 'deleted video' ||
    lower === '[deleted video]' ||
    lower === '[private video]' ||
    lower.includes('unavailable video') ||
    lower.includes('video unavailable')
  );
}

/**
 * Timeout-wrapped fetch helper (prevents hung external requests)
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================
// TIER 1: YouTube Data API v3 (Official Quota-backed Resolver)
// ============================================================
async function fetchYouTubePlaylistWithDataAPI(listId, apiKey) {
  const tracks = [];
  const seenIds = new Set();
  let nextPageToken = '';
  let pageCount = 0;
  let playlistTitle = 'Your Playlist';

  // 1. Fetch playlist metadata
  try {
    const metaUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(listId)}&key=${encodeURIComponent(apiKey)}`;
    const metaRes = await fetchWithTimeout(metaUrl, {}, 5000);
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const firstItem = metaData.items && metaData.items[0];
      if (firstItem?.snippet?.title) {
        playlistTitle = firstItem.snippet.title.trim();
      }
    } else if (metaRes.status === 403) {
      const errData = await metaRes.json().catch(() => ({}));
      const reason = errData?.error?.errors?.[0]?.reason || '';
      if (reason.includes('quota') || reason.includes('rateLimit')) {
        throw new Error('QUOTA_EXCEEDED');
      }
    }
  } catch (e) {
    if (e.message === 'QUOTA_EXCEEDED') throw e;
  }

  // 2. Fetch playlist items with pagination (max 4 pages = 200 items)
  try {
    do {
      pageCount++;
      const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails,status&playlistId=${encodeURIComponent(listId)}&maxResults=50${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ''}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(apiUrl, {}, 6000);

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('PRIVATE_OR_UNAVAILABLE');
        }
        if (res.status === 403) {
          const errData = await res.json().catch(() => ({}));
          const reason = errData?.error?.errors?.[0]?.reason || '';
          if (reason.includes('quota') || reason.includes('rateLimit')) {
            throw new Error('QUOTA_EXCEEDED');
          }
          throw new Error('PRIVATE_OR_UNAVAILABLE');
        }
        break;
      }

      const data = await res.json();
      const items = data.items || [];

      for (const item of items) {
        // Extract real video ID
        const vidId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        const title = (item.snippet?.title || '').trim();
        const artist = (item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube Artist').trim();

        // STRICT VALIDATION: Must be an actual 11-char video ID (Never a playlist ID)
        if (!vidId || typeof vidId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(vidId)) {
          continue;
        }
        if (seenIds.has(vidId) || isUnavailableTitle(title)) {
          continue;
        }
        seenIds.add(vidId);

        const thumbs = item.snippet?.thumbnails || {};
        const rawThumb = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '';

        tracks.push({
          id: vidId,
          videoId: vidId,
          title: title || 'Untitled Track',
          artist: artist || 'YouTube Artist',
          thumbnail: getNormalizedThumbnail(rawThumb, vidId),
          position: tracks.length + 1
        });
      }

      nextPageToken = data.nextPageToken || '';
    } while (nextPageToken && pageCount < 4);
  } catch (err) {
    if (err.message === 'PRIVATE_OR_UNAVAILABLE' || err.message === 'QUOTA_EXCEEDED') {
      throw err;
    }
  }

  return {
    title: playlistTitle,
    tracks,
    source: 'youtube-data-api'
  };
}

// ============================================================
// TIER 2: Universal Multi-Page Web & InnerTube Crawler
// Extracts real video IDs directly from YouTube playlist data
// ============================================================
function walkPlaylistTree(node, tracks, seenIds, continuationTokens, cleanListId) {
  if (!node || typeof node !== 'object') return;

  // Strict guard: NEVER walk into sidebar, recommendation carousels, or related chips
  if (
    node.horizontalCardListRenderer ||
    node.playlistSidebarRenderer ||
    node.relatedChipCloudRenderer ||
    node.richItemRenderer ||
    node.richSectionRenderer ||
    node.shelfRenderer
  ) {
    return;
  }

  if (Array.isArray(node)) {
    for (const el of node) {
      walkPlaylistTree(el, tracks, seenIds, continuationTokens, cleanListId);
    }
    return;
  }

  // 1. Continuation token
  const token = node.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token ||
                node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  if (token && !continuationTokens.includes(token)) {
    continuationTokens.push(token);
    return;
  }

  function addStrictTrack(vidId, title, artist, thumb, itemPlId) {
    // STRICT VALIDATION: MUST BE AN 11-CHAR VIDEO ID (NEVER A PLAYLIST ID)
    if (!vidId || typeof vidId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(vidId)) return;
    if (seenIds.has(vidId)) return;
    if (isUnavailableTitle(title)) return;
    if (itemPlId && itemPlId !== cleanListId && itemPlId !== ('VL' + cleanListId)) {
      return;
    }

    seenIds.add(vidId);
    tracks.push({
      id: vidId,
      videoId: vidId,
      title: (title || 'Untitled Track').trim(),
      artist: (artist || 'YouTube Artist').trim(),
      thumbnail: getNormalizedThumbnail(thumb, vidId),
      position: tracks.length + 1
    });
  }

  // 2. Modern lockupViewModel
  if (node.lockupViewModel) {
    const lockup = node.lockupViewModel;
    const vidId = lockup.contentId;
    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || '';
    const artist = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || 'YouTube Artist';
    const thumb = lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url ||
                  lockup.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
    const itemPlId = lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.playlistId;

    addStrictTrack(vidId, title, artist, thumb, itemPlId);
    return;
  }

  // 3. Classic playlistVideoRenderer
  if (node.playlistVideoRenderer) {
    const pvr = node.playlistVideoRenderer;
    const vidId = pvr.videoId;
    const title = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || '';
    const artist = pvr.shortBylineText?.runs?.[0]?.text || 'YouTube Artist';
    const thumb = pvr.thumbnail?.thumbnails?.[pvr.thumbnail.thumbnails.length - 1]?.url;
    const itemPlId = pvr.navigationEndpoint?.watchEndpoint?.playlistId;

    addStrictTrack(vidId, title, artist, thumb, itemPlId);
    return;
  }

  for (const key of Object.keys(node)) {
    if (
      key !== 'lockupViewModel' &&
      key !== 'playlistVideoRenderer' &&
      key !== 'horizontalCardListRenderer' &&
      key !== 'playlistSidebarRenderer' &&
      key !== 'relatedChipCloudRenderer' &&
      key !== 'richItemRenderer' &&
      key !== 'richSectionRenderer' &&
      key !== 'shelfRenderer'
    ) {
      walkPlaylistTree(node[key], tracks, seenIds, continuationTokens, cleanListId);
    }
  }
}

async function fetchYouTubeBrowseContinuation(token) {
  const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20231201.01.00'
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20231201.01.00', hl: 'en', gl: 'US' } },
      continuation: token
    })
  }, 6000).catch(() => null);

  if (!res || !res.ok) return null;
  return await res.json().catch(() => null);
}

async function fetchYouTubePlaylistWithCrawler(listId) {
  const cleanListId = listId.replace(/^VL/, '');
  const tracks = [];
  const seenIds = new Set();
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(cleanListId)}`;

  let res;
  try {
    res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, 8000);
  } catch (err) {
    return { title: 'Your Playlist', tracks: [], source: 'crawler-timeout' };
  }

  if (!res.ok) {
    if (res.status === 404) throw new Error('PRIVATE_OR_UNAVAILABLE');
    return { title: 'Your Playlist', tracks: [], source: 'crawler-error' };
  }

  const html = await res.text();

  // Extract playlist title
  let playlistTitle = 'Your Playlist';
  const titleMatch = html.match(/<title>([^<]+)- YouTube<\/title>/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    playlistTitle = titleMatch[1].replace(/- YouTube$/i, '').trim() || playlistTitle;
  }

  const jsonMatches = [...html.matchAll(/var ytInitialData = ({.+?});<\/script>/g)];
  if (jsonMatches.length === 0) {
    return { title: playlistTitle, tracks: [], source: 'web-crawler' };
  }

  let data;
  try {
    data = JSON.parse(jsonMatches[0][1]);
  } catch {
    return { title: playlistTitle, tracks: [], source: 'web-crawler' };
  }

  const continuationTokens = [];
  const primaryContents = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  walkPlaylistTree(primaryContents, tracks, seenIds, continuationTokens, cleanListId);

  const processedTokens = new Set();
  let pageCount = 1;

  while (continuationTokens.length > 0 && pageCount < 4) { // Up to 200 items
    pageCount++;
    const token = continuationTokens.shift();
    if (!token || processedTokens.has(token)) continue;
    processedTokens.add(token);

    try {
      const contData = await fetchYouTubeBrowseContinuation(token);
      if (!contData) continue;

      const actions = contData.onResponseReceivedActions || contData.onResponseReceivedEndpoints || [];
      for (const act of actions) {
        const items = act.appendContinuationItemsAction?.continuationItems ||
                      act.reloadContinuationItemsCommand?.continuationItems;
        if (items) {
          walkPlaylistTree(items, tracks, seenIds, continuationTokens, cleanListId);
        }
      }
    } catch (e) {}
  }

  return {
    title: playlistTitle,
    tracks,
    source: 'web-crawler'
  };
}

// ============================================================
// TIER 3: YouTube RSS Feed Fallback (Guaranteed Real Video IDs)
// ============================================================
async function fetchYouTubePlaylistWithRSS(listId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(listId)}`;
  let res;
  try {
    res = await fetchWithTimeout(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, 6000);
  } catch {
    return [];
  }

  if (!res.ok) return [];

  const xmlText = await res.text();
  const tracks = [];
  const seenIds = new Set();
  const entries = xmlText.split('<entry>');

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
    const authorMatch = entry.match(/<author>\s*<name>([^<]+)<\/name>/);

    if (idMatch && titleMatch) {
      const vidId = idMatch[1].trim();
      // MUST BE 11 CHARACTERS
      if (!vidId || !/^[A-Za-z0-9_-]{11}$/.test(vidId) || seenIds.has(vidId)) continue;
      seenIds.add(vidId);

      const rawTitle = titleMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      const rawArtist = authorMatch
        ? authorMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
        : 'YouTube Artist';

      if (isUnavailableTitle(rawTitle)) continue;

      tracks.push({
        id: vidId,
        videoId: vidId,
        title: rawTitle || 'Untitled Track',
        artist: rawArtist || 'YouTube Artist',
        thumbnail: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        position: tracks.length + 1
      });
    }
  }

  return tracks;
}

/**
 * Universal Multi-Tier Playlist Resolver
 */
async function fetchAuthoritativePlaylist(listId) {
  // Tier 1: Data API v3 (if key present)
  if (YOUTUBE_API_KEY) {
    try {
      const dataApiRes = await fetchYouTubePlaylistWithDataAPI(listId, YOUTUBE_API_KEY);
      if (dataApiRes && dataApiRes.tracks && dataApiRes.tracks.length > 0) {
        return dataApiRes;
      }
    } catch (apiErr) {
      if (apiErr.message === 'PRIVATE_OR_UNAVAILABLE' || apiErr.message === 'QUOTA_EXCEEDED') {
        throw apiErr;
      }
    }
  }

  // Tier 2: Universal Multi-Page Web Crawler
  try {
    const crawlerRes = await fetchYouTubePlaylistWithCrawler(listId);
    if (crawlerRes && crawlerRes.tracks && crawlerRes.tracks.length > 0) {
      return crawlerRes;
    }
  } catch (crawlerErr) {
    if (crawlerErr.message === 'PRIVATE_OR_UNAVAILABLE') {
      throw crawlerErr;
    }
  }

  // Tier 3: RSS Feed Fallback
  try {
    const rssTracks = await fetchYouTubePlaylistWithRSS(listId);
    if (rssTracks && rssTracks.length > 0) {
      return {
        title: 'Your Playlist',
        tracks: rssTracks,
        source: 'rss-feed'
      };
    }
  } catch (rssErr) {}

  return {
    title: 'Your Playlist',
    tracks: [],
    source: 'none'
  };
}

/**
 * Fetch a single video's details (Guaranteed Real 11-char Video ID)
 */
async function fetchYouTubeVideo(videoId, apiKey) {
  let title = 'YouTube Song';
  let artist = 'YouTube Artist';
  let thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  if (apiKey) {
    try {
      const vidUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(vidUrl, {}, 5000);
      if (res.ok) {
        const data = await res.json();
        const item = data.items && data.items[0];
        if (item) {
          title = (item.snippet?.title || title).trim();
          artist = (item.snippet?.channelTitle || artist).trim();
          const thumbs = item.snippet?.thumbnails || {};
          thumb = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumb;
        }
      }
    } catch (e) {}
  }

  // Fallback to official YouTube oEmbed
  if (title === 'YouTube Song') {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
      const oeRes = await fetchWithTimeout(oembedUrl, {}, 4000);
      if (oeRes.ok) {
        const oeData = await oeRes.json();
        if (oeData.title) title = oeData.title.trim();
        if (oeData.author_name) artist = oeData.author_name.trim();
        if (oeData.thumbnail_url) thumb = oeData.thumbnail_url;
      }
    } catch (e) {}
  }

  return {
    title,
    tracks: [
      {
        id: videoId,
        videoId: videoId,
        title,
        artist,
        thumbnail: getNormalizedThumbnail(thumb, videoId),
        position: 1
      }
    ]
  };
}

module.exports = async function handler(req, res) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=180, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Rate Limiting Check
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      ok: false,
      error: 'Too many playlist requests. Please wait a minute and try again.',
      code: 'RATE_LIMITED'
    });
  }

  try {
    let input = '';
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      input = body.url || body.id || body.input || body.playlistId || body.videoId || '';
    } else {
      input = req.query.url || req.query.list || req.query.v || req.query.id || req.query.input || req.query.playlistId || req.query.videoId || '';
    }

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'Please provide a YouTube playlist URL, playlist ID, or video URL.',
        code: 'MISSING_INPUT'
      });
    }

    // 2. Strict Input Validation & Type Detection
    const parsed = parseAndValidateYouTubeInput(input);
    if (!parsed) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid YouTube playlist link or video link.',
        code: 'INVALID_URL'
      });
    }

    // 3. In-Memory Response Cache Lookup
    const cacheKey = `${parsed.type}:${parsed.id}`;
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return res.status(200).json(cached.payload);
    }

    // 4. Single-Flight Coalescing
    if (inFlightRequests.has(cacheKey)) {
      const result = await inFlightRequests.get(cacheKey);
      return res.status(200).json(result);
    }

    // 5. Execute Multi-Tier Resolver
    const fetchPromise = (async () => {
      if (parsed.type === 'playlist') {
        const result = await fetchAuthoritativePlaylist(parsed.id);
        
        // NEVER return playlist ID as a video ID. If no tracks found, return clean error.
        if (!result.tracks || result.tracks.length === 0) {
          return {
            ok: false,
            type: 'playlist',
            playlistId: parsed.id,
            error: 'Playlist is empty or unavailable.',
            code: 'EMPTY_PLAYLIST'
          };
        }

        const payload = {
          ok: true,
          type: 'playlist',
          playlistId: parsed.id,
          title: result.title || 'Your Playlist',
          count: result.tracks.length,
          tracks: result.tracks
        };

        // Cache successful response
        responseCache.set(cacheKey, { timestamp: Date.now(), payload });
        return payload;
      } else {
        const result = await fetchYouTubeVideo(parsed.id, YOUTUBE_API_KEY);
        const payload = {
          ok: true,
          type: 'video',
          videoId: parsed.id,
          title: result.title,
          count: 1,
          tracks: result.tracks
        };

        // Cache successful response
        responseCache.set(cacheKey, { timestamp: Date.now(), payload });
        return payload;
      }
    })();

    inFlightRequests.set(cacheKey, fetchPromise);

    try {
      const payload = await fetchPromise;
      const status = payload.ok ? 200 : 404;
      return res.status(status).json(payload);
    } finally {
      inFlightRequests.delete(cacheKey);
    }

  } catch (err) {
    if (err.message === 'PRIVATE_OR_UNAVAILABLE') {
      return res.status(404).json({
        ok: false,
        error: 'Private or unavailable playlist.',
        code: 'PRIVATE_OR_UNAVAILABLE'
      });
    }

    if (err.message === 'QUOTA_EXCEEDED') {
      res.setHeader('Retry-After', '300');
      return res.status(429).json({
        ok: false,
        error: 'YouTube API quota reached. Please try again later.',
        code: 'QUOTA_EXCEEDED'
      });
    }

    console.error('[YouTube Fetch API] Resolver notice:', err.message || err);
    return res.status(500).json({
      ok: false,
      error: 'Couldn’t load playlist. Please verify the link and try again.',
      code: 'FETCH_ERROR'
    });
  }
};
