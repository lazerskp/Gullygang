// ============================================================
// GULLYGANG — CLIENT-SIDE FIRST-PARTY ANALYTICS ENGINE
// ============================================================

export const Analytics = (function () {
  let isInitialized = false;
  let queue = [];
  let flushTimer = null;
  let lastTrackedPath = null;
  let lastPlayedTrackKey = null;
  let searchDebounceMap = new Map();

  function getSessionId() {
    if (typeof window === 'undefined') return 'anon';
    try {
      let id = sessionStorage.getItem('gullygang_session_id');
      if (!id) {
        id = 'gg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem('gullygang_session_id', id);
      }
      return id;
    } catch (_) {
      return 'gg_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function init() {
    if (isInitialized || typeof window === 'undefined') return;
    isInitialized = true;
    flushTimer = setInterval(flush, 8000);
    if (flushTimer.unref) flushTimer.unref();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  function detectPageType() {
    if (typeof window === 'undefined') return 'home';
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') return 'home';
    if (path === '/blog') return 'blog';
    if (path.startsWith('/blog/tag/')) return 'tag';
    if (path.startsWith('/blog/') || path === '/top-10-rappers-in-india') return 'article';
    if (path.startsWith('/music/artist/')) return 'artist';
    if (path.startsWith('/music/album/')) return 'album';
    if (path.startsWith('/admin')) return 'admin';
    return 'other';
  }

  function pushEvent(eventType, payload = {}) {
    if (typeof window === 'undefined') return;
    init();

    queue.push({
      event_type: eventType,
      page_path: payload.page_path || window.location.pathname,
      page_type: payload.page_type || detectPageType(),
      article_id: payload.article_id || null,
      playlist_id: payload.playlist_id || null,
      track_id: payload.track_id || null,
      tag: payload.tag || null,
      search_query: payload.search_query ? String(payload.search_query).trim().toLowerCase() : null,
      metadata: payload.metadata || {},
      session_id: getSessionId()
    });

    if (queue.length > 30) queue = queue.slice(-30);
    if (queue.length >= 10) flush();
  }

  function flush() {
    if (queue.length === 0 || typeof window === 'undefined') return;
    const bodyStr = JSON.stringify({ events: queue.splice(0, 20) });

    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/analytics', new Blob([bodyStr], { type: 'application/json' }))) return;
    } catch (_) {}

    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: true
    }).catch(() => {});
  }

  function trackPageView(path, pageType) {
    const p = path || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/');
    if (p === lastTrackedPath) return;
    lastTrackedPath = p;
    pushEvent('page_view', { page_path: p, page_type: pageType || detectPageType() });
  }

  function trackArticleView(articleId, path, title) {
    if (articleId) pushEvent('article_view', { article_id: articleId, page_path: path || window.location.pathname, page_type: 'article', metadata: { title: title || '' } });
  }

  function trackSearch(query, resultCount) {
    if (!query) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2 || Date.now() - (searchDebounceMap.get(q) || 0) < 2000) return;
    searchDebounceMap.set(q, Date.now());
    pushEvent('search', { search_query: q, metadata: { result_count: parseInt(resultCount, 10) || 0 } });
  }

  function trackSearchResultClick(articleId, query, position) {
    if (articleId) pushEvent('search_result_click', { article_id: articleId, search_query: query ? String(query).trim().toLowerCase() : null, metadata: { position: parseInt(position, 10) || 1 } });
  }

  function trackTagView(tag, path) {
    if (tag) pushEvent('tag_view', { tag: String(tag).trim().toLowerCase(), page_path: path || window.location.pathname, page_type: 'tag' });
  }

  function trackRelatedArticleClick(sourceId, targetId, position) {
    if (targetId) pushEvent('related_article_click', { article_id: targetId, metadata: { source_article_id: sourceId || null, position: parseInt(position, 10) || 1 } });
  }

  function trackLoadMore(page, query, tag) {
    pushEvent('load_more', { search_query: query || null, tag: tag || null, metadata: { page: parseInt(page, 10) || 1 } });
  }

  function trackMusic(eventType, playlistId, trackId, title) {
    if (!eventType) return;
    if (eventType === 'track_play') {
      const key = `${playlistId || ''}_${trackId || ''}`;
      if (key === lastPlayedTrackKey) return;
      lastPlayedTrackKey = key;
    }
    pushEvent(eventType, { playlist_id: playlistId || null, track_id: trackId || null, metadata: { title: title || '' } });
  }

  function trackMusicSearch(query, resultCount) {
    if (!query) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2 || Date.now() - (searchDebounceMap.get(`m_${q}`) || 0) < 2000) return;
    searchDebounceMap.set(`m_${q}`, Date.now());
    pushEvent('music_search', { search_query: q, metadata: { result_count: parseInt(resultCount, 10) || 0 } });
  }

  function trackMusicSearchResultClick(videoId, query, position) {
    if (videoId) pushEvent('music_search_result_click', { track_id: videoId, search_query: query ? String(query).trim().toLowerCase() : null, metadata: { article_or_track_id: videoId, selected_position: parseInt(position, 10) || 1 } });
  }

  function trackArtistView(artistId, artistName) {
    if (artistId) pushEvent('artist_view', { page_path: `/music/artist/${artistId}`, page_type: 'artist', metadata: { artist_id: artistId, artist_name: artistName || '' } });
  }

  function trackAlbumView(albumId, albumTitle) {
    if (albumId) pushEvent('album_view', { page_path: `/music/album/${albumId}`, page_type: 'album', metadata: { album_id: albumId, album_title: albumTitle || '' } });
  }

  function trackArtistPlayAll(artistId, trackCount) {
    if (artistId) pushEvent('artist_play_all', { metadata: { artist_id: artistId, track_count: parseInt(trackCount, 10) || 0 } });
  }

  function trackAlbumPlay(albumId, trackCount) {
    if (albumId) pushEvent('album_play', { metadata: { album_id: albumId, track_count: parseInt(trackCount, 10) || 0 } });
  }

  function trackAlbumAddQueue(albumId, trackCount) {
    if (albumId) pushEvent('album_add_queue', { metadata: { album_id: albumId, track_count: parseInt(trackCount, 10) || 0 } });
  }

  function trackArtistResultClick(artistId, query, position) {
    if (artistId) pushEvent('artist_result_click', { search_query: query ? String(query).trim().toLowerCase() : null, metadata: { artist_id: artistId, position: parseInt(position, 10) || 1 } });
  }

  function trackAlbumResultClick(albumId, query, position) {
    if (albumId) pushEvent('album_result_click', { search_query: query ? String(query).trim().toLowerCase() : null, metadata: { album_id: albumId, position: parseInt(position, 10) || 1 } });
  }

  return {
    init,
    flush,
    trackPageView,
    trackArticleView,
    trackSearch,
    trackSearchResultClick,
    trackMusicSearch,
    trackMusicSearchResultClick,
    trackArtistView,
    trackAlbumView,
    trackArtistPlayAll,
    trackAlbumPlay,
    trackAlbumAddQueue,
    trackArtistResultClick,
    trackAlbumResultClick,
    trackTagView,
    trackRelatedArticleClick,
    trackLoadMore,
    trackMusic
  };
})();

if (typeof window !== 'undefined') window.Analytics = Analytics;
