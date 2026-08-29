// ============================================================
// GULLYGANG — AUTHORITATIVE YOUTUBE TO INSFORGE PLAYLIST SYNC
// Multi-page YouTube synchronization & differential reconciliation engine
// ============================================================

const { queryInsForge, escapeSql } = require('../_db');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

/**
 * Extract clean playlist ID from YouTube URL or raw ID
 */
function extractPlaylistId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const trimmed = urlOrId.trim();
  const match = trimmed.match(/[?&]list=([^#&?]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

/**
 * Normalize and validate thumbnail URL
 */
function getNormalizedThumbnail(thumbUrl, videoId) {
  if (thumbUrl && typeof thumbUrl === 'string' && thumbUrl.startsWith('http')) {
    return thumbUrl.trim();
  }
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return 'romantic.png';
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
 * Fetch all tracks from YouTube Playlist with multi-page pagination (Tier 1: Data API v3)
 */
async function fetchYouTubePlaylistWithDataAPI(listId, apiKey) {
  const tracks = [];
  const seenIds = new Set();
  let nextPageToken = '';
  let pageCount = 0;

  do {
    pageCount++;
    const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&playlistId=${encodeURIComponent(listId)}&maxResults=50${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ''}&key=${encodeURIComponent(apiKey)}`;
    
    const res = await fetch(apiUrl);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`YouTube API returned ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const items = data.items || [];

    for (const item of items) {
      const vidId = item.snippet?.resourceId?.videoId;
      const title = (item.snippet?.title || '').trim();
      const artist = (item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Odia Music').trim();

      // Skip invalid, deleted, private, or duplicate videos safely
      if (!vidId || seenIds.has(vidId) || isUnavailableTitle(title)) {
        continue;
      }
      seenIds.add(vidId);

      const thumbs = item.snippet?.thumbnails || {};
      const rawThumb = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '';

      tracks.push({
        youtube_id: vidId,
        title: title || 'Untitled Track',
        artist: artist || 'Odia Artist',
        thumbnail: getNormalizedThumbnail(rawThumb, vidId)
      });
    }

    nextPageToken = data.nextPageToken || '';
  } while (nextPageToken && pageCount < 200);

  return tracks;
}

/**
 * Universal Recursive Tree Walker for YouTube InnerTube/HTML structures
 */
function walkYouTubeTree(node, tracks, seenIds, continuationTokens) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const el of node) {
      walkYouTubeTree(el, tracks, seenIds, continuationTokens);
    }
    return;
  }

  // 1. Extract continuation tokens
  const token = node.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token ||
                node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
                node.continuationCommand?.token;
  if (token && !continuationTokens.includes(token)) {
    continuationTokens.push(token);
  }

  // 2. Extract from modern lockupViewModel
  if (node.lockupViewModel) {
    const lockup = node.lockupViewModel;
    const vidId = lockup.contentId;
    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || '';
    const artist = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || 'Odia Artist';
    const thumb = lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url ||
                  lockup.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url ||
                  (vidId ? `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` : '');

    if (vidId && !seenIds.has(vidId) && !isUnavailableTitle(title)) {
      seenIds.add(vidId);
      tracks.push({
        youtube_id: vidId,
        title: title.trim() || 'Untitled Track',
        artist: artist.trim() || 'Odia Artist',
        thumbnail: getNormalizedThumbnail(thumb, vidId)
      });
    }
  }

  // 3. Extract from classic playlistVideoRenderer
  if (node.playlistVideoRenderer) {
    const pvr = node.playlistVideoRenderer;
    const vidId = pvr.videoId;
    const title = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || '';
    const artist = pvr.shortBylineText?.runs?.[0]?.text || 'Odia Artist';
    const thumb = pvr.thumbnail?.thumbnails?.[pvr.thumbnail.thumbnails.length - 1]?.url ||
                  (vidId ? `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` : '');

    if (vidId && !seenIds.has(vidId) && !isUnavailableTitle(title)) {
      seenIds.add(vidId);
      tracks.push({
        youtube_id: vidId,
        title: title.trim() || 'Untitled Track',
        artist: artist.trim() || 'Odia Artist',
        thumbnail: getNormalizedThumbnail(thumb, vidId)
      });
    }
  }

  // Recurse into child properties
  for (const key of Object.keys(node)) {
    if (key !== 'lockupViewModel' && key !== 'playlistVideoRenderer') {
      walkYouTubeTree(node[key], tracks, seenIds, continuationTokens);
    }
  }
}

/**
 * Fetch InnerTube continuation endpoint
 */
async function fetchYouTubeBrowseContinuation(token) {
  const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
  const res = await fetch(url, {
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
  });
  if (!res.ok) return null;
  return await res.json();
}

/**
 * Fetch all tracks from YouTube Playlist via Web / InnerTube Pagination (Tier 2: Universal Crawler)
 */
async function fetchYouTubePlaylistWithCrawler(listId) {
  const tracks = [];
  const seenIds = new Set();
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) throw new Error(`YouTube Playlist Web fetch returned HTTP ${res.status}`);
  const html = await res.text();
  const jsonMatches = [...html.matchAll(/var ytInitialData = ({.+?});<\/script>/g)];
  if (jsonMatches.length === 0) return tracks;

  const data = JSON.parse(jsonMatches[0][1]);
  const continuationTokens = [];
  walkYouTubeTree(data, tracks, seenIds, continuationTokens);

  const processedTokens = new Set();
  let pageCount = 1;

  while (continuationTokens.length > 0 && pageCount < 200) {
    pageCount++;
    const token = continuationTokens.shift();
    if (!token || processedTokens.has(token)) continue;
    processedTokens.add(token);

    const contData = await fetchYouTubeBrowseContinuation(token);
    if (!contData) continue;

    const newTokens = [];
    walkYouTubeTree(contData, tracks, seenIds, newTokens);
    for (const t of newTokens) {
      if (!processedTokens.has(t) && !continuationTokens.includes(t)) {
        continuationTokens.push(t);
      }
    }
  }

  return tracks;
}

/**
 * Fetch tracks from YouTube Playlist via RSS Feed (Tier 3: Fallback)
 */
async function fetchYouTubePlaylistWithRSS(listId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(listId)}`;
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  if (!res.ok) {
    throw new Error(`YouTube RSS Feed returned HTTP ${res.status}`);
  }

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
      if (!vidId || seenIds.has(vidId)) continue;
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
        : 'Odia Artist';

      if (isUnavailableTitle(rawTitle)) continue;

      tracks.push({
        youtube_id: vidId,
        title: rawTitle || 'Untitled Track',
        artist: rawArtist || 'Odia Artist',
        thumbnail: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`
      });
    }
  }

  return tracks;
}

/**
 * Fetch complete YouTube playlist tracks using multi-tier architecture
 */
async function fetchYouTubeTracks(listId) {
  // Tier 1: Official Data API v3 if API key available
  if (YOUTUBE_API_KEY) {
    try {
      const tracks = await fetchYouTubePlaylistWithDataAPI(listId, YOUTUBE_API_KEY);
      if (tracks && tracks.length > 0) {
        console.log(`[Sync Engine] Data API v3 fetched ${tracks.length} tracks for ${listId}`);
        return tracks;
      }
    } catch (apiErr) {
      console.warn(`[Sync Engine] Data API v3 warning for ${listId}:`, apiErr.message);
    }
  }

  // Tier 2: Universal Multi-Page Web/InnerTube Crawler
  try {
    const crawlerTracks = await fetchYouTubePlaylistWithCrawler(listId);
    if (crawlerTracks && crawlerTracks.length > 0) {
      console.log(`[Sync Engine] Web crawler fetched ${crawlerTracks.length} tracks for ${listId}`);
      return crawlerTracks;
    }
  } catch (crawlerErr) {
    console.warn(`[Sync Engine] Crawler warning for ${listId}:`, crawlerErr.message);
  }

  // Tier 3: RSS Feed Fallback
  console.log(`[Sync Engine] Fallback to RSS feed for ${listId}`);
  return await fetchYouTubePlaylistWithRSS(listId);
}

/**
 * Perform complete differential synchronization for a single playlist
 */
async function syncSinglePlaylist(playlist) {
  const playlistId = playlist.id;
  const listId = extractPlaylistId(playlist.youtube_playlist_url);

  if (!listId) {
    throw new Error(`Playlist ${playlist.name} has no valid YouTube playlist URL`);
  }

  // 1. Mark status as syncing
  await queryInsForge(`
    UPDATE playlists SET
      sync_status = 'syncing',
      sync_error = NULL,
      updated_at = NOW()
    WHERE id = '${escapeSql(playlistId)}';
  `);

  // 2. Fetch authoritative YouTube playlist items
  const ytTracks = await fetchYouTubeTracks(listId);

  // 3. Fetch existing InsForge database records
  const existingRows = await queryInsForge(`
    SELECT id, youtube_id, title, artist, thumbnail, display_order
    FROM playlist_songs
    WHERE playlist_id = '${escapeSql(playlistId)}'
    ORDER BY display_order ASC;
  `);

  const existingMap = new Map();
  existingRows.forEach(row => {
    existingMap.set(row.youtube_id, row);
  });

  // 4. Deletion Safety Guard
  // If YouTube returned 0 songs while database has existing records, DO NOT wipe existing data!
  if (ytTracks.length === 0 && existingRows.length > 0) {
    throw new Error('YouTube returned 0 valid songs. Safety guard aborted sync to prevent accidental deletion.');
  }

  let addedCount = 0;
  let removedCount = 0;
  let updatedCount = 0;
  let reorderedCount = 0;

  const ytTrackIds = new Set(ytTracks.map(t => t.youtube_id));

  // 5. Detect and remove songs no longer present in YouTube playlist
  const songsToRemove = existingRows.filter(row => !ytTrackIds.has(row.youtube_id));
  if (songsToRemove.length > 0) {
    const idsToDelete = songsToRemove.map(s => `'${escapeSql(s.id)}'`).join(',');
    await queryInsForge(`
      DELETE FROM playlist_songs
      WHERE id IN (${idsToDelete});
    `);
    removedCount = songsToRemove.length;
  }

  // 6. Partition tracks into new vs existing
  const newTracksToInsert = [];
  const tracksToUpdate = [];

  for (let idx = 0; idx < ytTracks.length; idx++) {
    const ytItem = ytTracks[idx];
    const targetOrder = idx + 1;
    const existing = existingMap.get(ytItem.youtube_id);

    if (!existing) {
      newTracksToInsert.push({
        youtube_id: ytItem.youtube_id,
        title: ytItem.title,
        artist: ytItem.artist,
        thumbnail: ytItem.thumbnail,
        display_order: targetOrder
      });
      addedCount++;
    } else {
      const titleDiff = existing.title !== ytItem.title;
      const artistDiff = (existing.artist || '') !== (ytItem.artist || '');
      const thumbDiff = (existing.thumbnail || '') !== (ytItem.thumbnail || '');
      const orderDiff = Number(existing.display_order) !== targetOrder;

      if (titleDiff || artistDiff || thumbDiff || orderDiff) {
        if (titleDiff || artistDiff || thumbDiff) updatedCount++;
        if (orderDiff && !titleDiff && !artistDiff && !thumbDiff) reorderedCount++;

        tracksToUpdate.push({
          id: existing.id,
          title: ytItem.title,
          artist: ytItem.artist,
          thumbnail: ytItem.thumbnail,
          display_order: targetOrder
        });
      }
    }
  }

  // 7. Batch insert new songs in chunks of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < newTracksToInsert.length; i += BATCH_SIZE) {
    const batch = newTracksToInsert.slice(i, i + BATCH_SIZE);
    const valueTuples = batch.map(t => `(
      '${escapeSql(playlistId)}',
      '${escapeSql(t.youtube_id)}',
      '${escapeSql(t.title)}',
      '${escapeSql(t.artist)}',
      '${escapeSql(t.thumbnail)}',
      ${t.display_order},
      NOW()
    )`).join(',\n');

    await queryInsForge(`
      INSERT INTO playlist_songs (
        playlist_id, youtube_id, title, artist, thumbnail, display_order, created_at
      ) VALUES
      ${valueTuples};
    `);
  }

  // 8. Execute necessary updates
  for (const t of tracksToUpdate) {
    await queryInsForge(`
      UPDATE playlist_songs SET
        title = '${escapeSql(t.title)}',
        artist = '${escapeSql(t.artist)}',
        thumbnail = '${escapeSql(t.thumbnail)}',
        display_order = ${t.display_order}
      WHERE id = '${escapeSql(t.id)}';
    `);
  }

  // 9. Verify final database count
  const countVerification = await queryInsForge(`
    SELECT COUNT(*)::int AS count
    FROM playlist_songs
    WHERE playlist_id = '${escapeSql(playlistId)}';
  `);
  const finalStoredCount = countVerification[0]?.count || 0;

  // 10. Update playlist sync stats and status
  const stats = {
    total: finalStoredCount,
    fetched: ytTracks.length,
    added: addedCount,
    removed: removedCount,
    updated: updatedCount,
    reordered: reorderedCount
  };

  await queryInsForge(`
    UPDATE playlists SET
      last_synced_at = NOW(),
      sync_status = 'success',
      sync_error = NULL,
      sync_stats = '${escapeSql(JSON.stringify(stats))}'::jsonb,
      updated_at = NOW()
    WHERE id = '${escapeSql(playlistId)}';
  `);

  return {
    playlist_id: playlistId,
    name: playlist.name,
    youtube_id: listId,
    stats,
    status: 'success'
  };
}

module.exports = async function handler(req, res) {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // ------------------------------------------------------------
    // GET: Return all playlists with sync status and statistics
    // ------------------------------------------------------------
    if (req.method === 'GET') {
      const sql = `
        SELECT 
          p.id,
          p.name,
          p.slug,
          p.icon,
          p.youtube_playlist_url,
          p.bg_image,
          p.display_order,
          p.is_active,
          p.last_synced_at,
          p.sync_status,
          p.sync_error,
          p.sync_stats,
          p.sync_interval_mins,
          COUNT(ps.id)::int AS song_count
        FROM playlists p
        LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
        WHERE p.is_active = true
        GROUP BY p.id
        ORDER BY p.display_order ASC;
      `;

      const playlists = await queryInsForge(sql);

      return res.status(200).json({
        success: true,
        serverTime: new Date().toISOString(),
        playlists: playlists.map(pl => ({
          id: pl.id,
          name: pl.name,
          slug: pl.slug,
          icon: pl.icon,
          youtube_playlist_url: pl.youtube_playlist_url,
          youtube_playlist_id: extractPlaylistId(pl.youtube_playlist_url),
          bg_image: pl.bg_image,
          display_order: pl.display_order,
          song_count: pl.song_count || 0,
          last_synced_at: pl.last_synced_at,
          sync_status: pl.sync_status || 'idle',
          sync_error: pl.sync_error || null,
          sync_stats: pl.sync_stats || { total: pl.song_count || 0, added: 0, removed: 0, updated: 0, reordered: 0 },
          sync_interval_mins: pl.sync_interval_mins || 60
        }))
      });
    }

    // ------------------------------------------------------------
    // POST: Trigger immediate synchronization
    // ------------------------------------------------------------
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      body = body || {};

      const targetPlaylistId = body.playlist_id;

      // Select target playlist(s)
      let querySql = `
        SELECT id, name, slug, icon, youtube_playlist_url, display_order
        FROM playlists
        WHERE is_active = true
      `;
      if (targetPlaylistId) {
        querySql += ` AND id = '${escapeSql(targetPlaylistId)}'`;
      }
      querySql += ` ORDER BY display_order ASC;`;

      const targetPlaylists = await queryInsForge(querySql);

      if (!targetPlaylists || targetPlaylists.length === 0) {
        return res.status(404).json({
          success: false,
          error: targetPlaylistId ? 'Specified playlist not found' : 'No active playlists found to sync'
        });
      }

      const syncResults = [];
      const errors = [];

      for (const pl of targetPlaylists) {
        try {
          const result = await syncSinglePlaylist(pl);
          syncResults.push(result);
        } catch (syncErr) {
          console.error(`[Sync Engine Error] Failed to sync ${pl.name} (${pl.id}):`, syncErr);
          
          // Record failure in database
          await queryInsForge(`
            UPDATE playlists SET
              sync_status = 'error',
              sync_error = '${escapeSql(syncErr.message || 'Unknown sync error')}',
              updated_at = NOW()
            WHERE id = '${escapeSql(pl.id)}';
          `).catch(() => {});

          errors.push({
            playlist_id: pl.id,
            name: pl.name,
            error: syncErr.message || 'Failed to synchronize playlist'
          });
        }
      }

      return res.status(200).json({
        success: errors.length === 0,
        syncedCount: syncResults.length,
        errorCount: errors.length,
        results: syncResults,
        errors
      });
    }

    // ------------------------------------------------------------
    // PUT: Update playlist sync configuration (e.g. interval)
    // ------------------------------------------------------------
    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      body = body || {};

      const { playlist_id, sync_interval_mins } = body;
      if (!playlist_id || typeof sync_interval_mins !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'playlist_id and numeric sync_interval_mins are required'
        });
      }

      const validInterval = Math.max(15, Math.min(10080, sync_interval_mins)); // 15 mins to 7 days
      await queryInsForge(`
        UPDATE playlists SET
          sync_interval_mins = ${validInterval},
          updated_at = NOW()
        WHERE id = '${escapeSql(playlist_id)}';
      `);

      return res.status(200).json({
        success: true,
        playlist_id,
        sync_interval_mins: validInterval
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[Playlist Sync Handler Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing playlist synchronization'
    });
  }
};
