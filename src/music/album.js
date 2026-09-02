// ============================================================
// GULLYGANG — DEDICATED ALBUM DISCOVERY PAGE ENGINE (STEP 15)
// ============================================================

import { state, escapeHtml, normalizeThumbnailUrl } from '../core/state.js';
import { Analytics } from '../analytics/analytics.js';

export const AlbumPageEngine = (function () {
  let currentAlbumId = null;
  let currentAlbumData = null;
  let activeAbortController = null;

  function getAlbumIdFromRoute() {
    const path = (typeof window !== 'undefined' ? window.location.pathname : '').replace(/\/+$/, '') || '';
    if (path.startsWith('/music/album/')) {
      return path.slice('/music/album/'.length).trim();
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || params.get('albumId') || null;
  }

  async function init(explicitId = null) {
    const container = document.getElementById('album-page-container');
    if (!container) return;

    const albumId = explicitId || getAlbumIdFromRoute();
    if (!albumId) {
      renderError('Album unavailable', 'We couldn\'t load this album right now.');
      return;
    }

    currentAlbumId = albumId;
    renderLoadingSkeleton();

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    try {
      const res = await fetch(`/api/music?action=album&id=${encodeURIComponent(albumId)}`, {
        signal: activeAbortController.signal
      });

      if (!res.ok) {
        renderError('Album unavailable', 'We couldn\'t load this album right now.', true);
        return;
      }

      const data = await res.json();
      if (data && data.success && data.album) {
        currentAlbumData = data;
        renderAlbumPage(data);
        if (Analytics && typeof Analytics.trackAlbumView === 'function') {
          Analytics.trackAlbumView(albumId, data.album.title);
        }
      } else {
        renderError('Album unavailable', 'We couldn\'t load this album right now.', true);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        renderError('Album unavailable', 'We couldn\'t load this album right now.', true);
      }
    }
  }

  function renderLoadingSkeleton() {
    const container = document.getElementById('album-page-container');
    if (!container) return;
    container.innerHTML = `
      <div class="album-skeleton-view max-w-5xl mx-auto px-4 py-8 space-y-8 animate-pulse">
        <div class="flex flex-col md:flex-row items-center md:items-end gap-6 p-6 rounded-2xl bg-white/5">
          <div class="w-44 h-44 md:w-56 md:h-56 rounded-2xl bg-white/10 shrink-0 shadow-2xl"></div>
          <div class="flex-1 space-y-3 text-center md:text-left w-full">
            <div class="h-4 bg-white/10 rounded w-20 mx-auto md:mx-0"></div>
            <div class="h-8 bg-white/10 rounded w-4/5 mx-auto md:mx-0"></div>
            <div class="h-4 bg-white/5 rounded w-1/3 mx-auto md:mx-0"></div>
            <div class="h-10 bg-white/10 rounded-xl w-48 mx-auto md:mx-0 mt-4"></div>
          </div>
        </div>
        <div class="space-y-3">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map(() => `
            <div class="flex items-center gap-4 p-3 rounded-xl bg-white/5">
              <div class="w-6 h-4 bg-white/10 rounded"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3.5 bg-white/10 rounded w-2/5"></div>
                <div class="h-2.5 bg-white/5 rounded w-1/4"></div>
              </div>
              <div class="w-12 h-3 bg-white/5 rounded"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderError(title, message, retry = false) {
    const container = document.getElementById('album-page-container');
    if (!container) return;
    container.innerHTML = `
      <div class="album-error-view max-w-md mx-auto px-4 py-24 text-center">
        <div class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 text-white/40">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </div>
        <h3 class="text-base font-semibold text-white mb-1">${escapeHtml(title)}</h3>
        <p class="text-xs text-white/50 mb-4">${escapeHtml(message)}</p>
        <div class="flex items-center justify-center gap-3">
          ${retry ? `<button type="button" class="btn-subtle text-xs px-4 py-2 rounded-xl" onclick="AlbumPageEngine.retry()">Retry</button>` : ''}
          <a href="/music" class="text-xs text-[var(--accent)] font-bold uppercase tracking-wider underline px-2 py-2">← Explore Music</a>
        </div>
      </div>
    `;
  }

  function renderAlbumPage(data) {
    const container = document.getElementById('album-page-container');
    if (!container) return;

    const { album, tracks = [] } = data;
    const title = escapeHtml(album.title || 'Album');
    const artist = escapeHtml(album.artist || 'Artist');
    const thumb = normalizeThumbnailUrl(album.thumbnail);
    const metaParts = [];
    if (album.year) metaParts.push(escapeHtml(album.year));
    metaParts.push('Album');
    if (tracks.length > 0) metaParts.push(`${tracks.length} tracks`);
    if (album.duration) metaParts.push(escapeHtml(album.duration));
    const metaStr = metaParts.join(' • ');
    document.title = `${title} — ${artist} | GULLYGANG Music`;

    container.innerHTML = `
      <div class="album-entity-view max-w-5xl mx-auto px-4 py-8 space-y-10">
        <!-- Hero Banner -->
        <section class="album-hero-card flex flex-col md:flex-row items-center md:items-end gap-6 p-6 md:p-8 rounded-3xl bg-white/[0.03] border border-white/5 backdrop-blur-xl relative overflow-hidden">
          <div class="relative w-44 h-44 md:w-56 md:h-56 rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/10 shrink-0 bg-black/40">
            <img src="${thumb}" alt="${title}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
          </div>
          <div class="flex-1 text-center md:text-left space-y-2">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">Album</div>
            <h1 class="text-2xl md:text-4xl font-extrabold text-white tracking-tight">${title}</h1>
            <h3 class="text-sm md:text-base font-medium text-white/80">${artist}</h3>
            <p class="text-xs text-white/50">${metaStr}</p>
            ${album.description ? `<p class="text-xs text-white/40 max-w-xl line-clamp-2 mt-1">${escapeHtml(album.description)}</p>` : ''}
            <div class="pt-4 flex flex-wrap items-center justify-center md:justify-start gap-3">
              <button type="button" id="btn-album-play" class="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[var(--accent)] text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 transition-all shadow-lg active:scale-95">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Play Album</span>
              </button>
              <button type="button" id="btn-album-add-queue" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 text-white font-medium text-xs uppercase tracking-wider hover:bg-white/20 transition-all active:scale-95">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>Add to Queue</span>
              </button>
            </div>
          </div>
        </section>

        <!-- Tracklist Section -->
        <section class="album-tracklist-section space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-bold text-white tracking-wide uppercase">Tracklist</h2>
            <span class="text-xs text-white/40 font-mono">${tracks.length} Songs</span>
          </div>
          <div class="album-tracks-table divide-y divide-white/5 border border-white/5 rounded-2xl bg-white/[0.02] overflow-hidden" role="list">
            ${tracks.map((track, idx) => {
              const trackTitle = escapeHtml(track.title);
              const trackArtist = escapeHtml(track.artist || artist);
              return `
                <div class="album-track-row group flex items-center gap-3 p-3 hover:bg-white/5 transition-colors cursor-pointer" data-action="play-track" data-index="${idx}">
                  <span class="w-8 text-center text-xs text-white/40 tabular-nums font-mono group-hover:hidden">${idx + 1}</span>
                  <div class="w-8 text-center hidden group-hover:flex items-center justify-center text-[var(--accent)]">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <h4 class="text-sm font-medium text-white truncate group-hover:text-[var(--accent)] transition-colors">${trackTitle}</h4>
                    <p class="text-xs text-white/50 truncate">${trackArtist}</p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <span class="text-xs text-white/40 tabular-nums font-mono">${track.duration || '0:00'}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      </div>
    `;

    // Event Handlers
    document.getElementById('btn-album-play')?.addEventListener('click', () => {
      playAlbum(tracks);
    });

    document.getElementById('btn-album-add-queue')?.addEventListener('click', () => {
      addAlbumToQueue(tracks);
    });

    container.querySelectorAll('[data-action="play-track"]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        if (tracks[idx]) playAlbumTrack(tracks, idx);
      });
    });
  }

  function playAlbum(tracks) {
    if (!tracks || tracks.length === 0) return;
    if (Analytics && typeof Analytics.trackAlbumPlay === 'function') {
      Analytics.trackAlbumPlay(currentAlbumId, tracks.length);
    }
    state.tracks = tracks.map(t => ({
      ...t,
      source: 'ytmusic'
    }));
    state.currentIndex = 0;
    if (window.GullyMusic?.loadTrackAtIndex) {
      window.GullyMusic.loadTrackAtIndex(0, true, 'direct');
    }
    showToast(`Playing "${currentAlbumData?.album?.title || 'Album'}"`);
  }

  function addAlbumToQueue(tracks) {
    if (!tracks || tracks.length === 0) return;
    if (Analytics && typeof Analytics.trackAlbumAddQueue === 'function') {
      Analytics.trackAlbumAddQueue(currentAlbumId, tracks.length);
    }
    if (!Array.isArray(state.tracks)) state.tracks = [];
    tracks.forEach(t => {
      state.tracks.push({
        ...t,
        source: 'ytmusic'
      });
    });
    showToast(`Added ${tracks.length} tracks to queue`);
  }

  function playAlbumTrack(tracks, index) {
    if (!tracks || !tracks[index]) return;
    state.tracks = tracks.map(t => ({
      ...t,
      source: 'ytmusic'
    }));
    state.currentIndex = index;
    if (window.GullyMusic?.loadTrackAtIndex) {
      window.GullyMusic.loadTrackAtIndex(index, true, 'direct');
    }
  }

  function showToast(message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 right-6 z-50 px-4 py-2.5 rounded-xl bg-black/90 text-white text-xs border border-white/10 shadow-2xl backdrop-blur-md';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function retry() {
    if (currentAlbumId) init(currentAlbumId);
  }

  return {
    init,
    retry,
    playAlbum,
    addAlbumToQueue
  };
})();

if (typeof window !== 'undefined') {
  window.AlbumPageEngine = AlbumPageEngine;
}
