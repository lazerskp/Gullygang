// ============================================================
// GULLYGANG — CLIENT-SIDE FIRST-PARTY ANALYTICS ENGINE
// Privacy-first, batched, non-blocking anonymous event tracker
// ============================================================

export const Analytics = (function () {
  let isInitialized = false;
  let queue = [];
  let flushTimer = null;
  let lastTrackedPath = null;
  let lastPlayedTrackKey = null;
  let searchDebounceMap = new Map();

  function getAnonymousId(key, storage) {
    try {
      let id = storage.getItem(key);
      if (!id || typeof id !== 'string' || id.length < 16) {
        id = 'gg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        storage.setItem(key, id);
      }
      return id;
    } catch (_) {
      return 'gg_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function getSessionId() {
    if (typeof window === 'undefined') return 'anon';
    return getAnonymousId('gullygang_session_id', window.sessionStorage || window.localStorage);
  }

  function init() {
    if (isInitialized || typeof window === 'undefined') return;
    isInitialized = true;

    // Periodic flush every 8 seconds
    flushTimer = setInterval(flush, 8000);
    if (flushTimer.unref) flushTimer.unref();

    // Flush immediately when visitor navigates away or hides the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });

    window.addEventListener('pagehide', () => {
      flush();
    });
  }

  function pushEvent(eventType, payload = {}) {
    if (typeof window === 'undefined') return;
    init();

    const event = {
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
    };

    queue.push(event);

    // Limit memory growth
    if (queue.length > 30) {
      queue = queue.slice(-30);
    }

    // Immediate flush if queue is full
    if (queue.length >= 10) {
      flush();
    }
  }

  function detectPageType() {
    if (typeof window === 'undefined') return 'home';
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') return 'home';
    if (path === '/blog') return 'blog';
    if (path.startsWith('/blog/tag/')) return 'tag';
    if (path.startsWith('/blog/') || path === '/top-10-rappers-in-india') return 'article';
    if (path.startsWith('/admin')) return 'admin';
    return 'other';
  }

  function flush() {
    if (queue.length === 0 || typeof window === 'undefined') return;

    const batch = queue.splice(0, 20);
    const bodyStr = JSON.stringify({ events: batch });

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([bodyStr], { type: 'application/json' });
        const success = navigator.sendBeacon('/api/analytics', blob);
        if (success) return;
      }
    } catch (_) {}

    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: true
    }).catch(() => {
      // Gracefully silent on failure
    });
  }

  // Tracking API
  function trackPageView(path, pageType) {
    const currentPath = path || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/');
    if (currentPath === lastTrackedPath) return; // Prevent duplicate consecutive logs
    lastTrackedPath = currentPath;

    pushEvent('page_view', {
      page_path: currentPath,
      page_type: pageType || detectPageType()
    });
  }

  function trackArticleView(articleId, path, title) {
    if (!articleId) return;
    pushEvent('article_view', {
      article_id: articleId,
      page_path: path || window.location.pathname,
      page_type: 'article',
      metadata: { title: title || '' }
    });
  }

  function trackSearch(query, resultCount) {
    if (!query || typeof query !== 'string') return;
    const cleanQ = query.trim().toLowerCase();
    if (cleanQ.length < 2) return;

    // Debounce duplicate tracking for identical search within 2 seconds
    const lastTime = searchDebounceMap.get(cleanQ) || 0;
    if (Date.now() - lastTime < 2000) return;
    searchDebounceMap.set(cleanQ, Date.now());

    pushEvent('search', {
      search_query: cleanQ,
      metadata: { result_count: parseInt(resultCount, 10) || 0 }
    });
  }

  function trackSearchResultClick(articleId, query, position) {
    if (!articleId) return;
    pushEvent('search_result_click', {
      article_id: articleId,
      search_query: query ? String(query).trim().toLowerCase() : null,
      metadata: { position: parseInt(position, 10) || 1 }
    });
  }

  function trackTagView(tag, path) {
    if (!tag) return;
    pushEvent('tag_view', {
      tag: String(tag).trim().toLowerCase(),
      page_path: path || window.location.pathname,
      page_type: 'tag'
    });
  }

  function trackRelatedArticleClick(sourceId, targetId, position) {
    if (!targetId) return;
    pushEvent('related_article_click', {
      article_id: targetId,
      metadata: {
        source_article_id: sourceId || null,
        position: parseInt(position, 10) || 1
      }
    });
  }

  function trackLoadMore(page, query, tag) {
    pushEvent('load_more', {
      search_query: query || null,
      tag: tag || null,
      metadata: { page: parseInt(page, 10) || 1 }
    });
  }

  function trackMusic(eventType, playlistId, trackId, title) {
    if (!eventType) return;
    
    // Guard against duplicate track_play spam
    if (eventType === 'track_play') {
      const trackKey = `${playlistId || ''}_${trackId || ''}`;
      if (trackKey === lastPlayedTrackKey) return;
      lastPlayedTrackKey = trackKey;
    }

    pushEvent(eventType, {
      playlist_id: playlistId || null,
      track_id: trackId || null,
      metadata: { title: title || '' }
    });
  }

  return {
    init,
    flush,
    trackPageView,
    trackArticleView,
    trackSearch,
    trackSearchResultClick,
    trackTagView,
    trackRelatedArticleClick,
    trackLoadMore,
    trackMusic
  };
})();

if (typeof window !== 'undefined') {
  window.Analytics = Analytics;
}
