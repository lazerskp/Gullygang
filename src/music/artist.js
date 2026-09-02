// ============================================================
// GULLYGANG — DEDICATED ARTIST DISCOVERY PAGE ENGINE (STEP 15)
// ============================================================

import { state, escapeHtml, normalizeThumbnailUrl } from '../core/state.js';
import { Analytics } from '../analytics/analytics.js';

export const ArtistPageEngine = (function () {
  let currentArtistId = null;
  let currentArtistData = null;
  let activeAbortController = null;

  function getArtistIdFromRoute() {
    const path = (typeof window !== 'undefined' ? window.location.pathname : '').replace(/\/+$/, '') || '';
    if (path.startsWith('/music/artist/')) {
      return path.slice('/music/artist/'.length).trim();
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || params.get('artistId') || null;
  }

  async function init(explicitId = null) {
    const container = document.getElementById('artist-page-container');
    if (!container) return;

    const artistId = explicitId || getArtistIdFromRoute();
    if (!artistId) {
      renderError('Artist unavailable', 'We couldn\'t load this artist right now.');
      return;
    }

    currentArtistId = artistId;
    renderLoadingSkeleton();

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    try {
      const res = await fetch(`/api/music?action=artist&id=${encodeURIComponent(artistId)}`, {
        signal: activeAbortController.signal
      });

      if (!res.ok) {
        renderError('Artist unavailable', 'We couldn\'t load this artist right now.', true);
        return;
      }

      const data = await res.json();
      if (data && data.success && data.artist) {
        currentArtistData = data;
        renderArtistPage(data);
        if (Analytics && typeof Analytics.trackArtistView === 'function') {
          Analytics.trackArtistView(artistId, data.artist.name);
        }
      } else {
        renderError('Artist unavailable', 'We couldn\'t load this artist right now.', true);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        renderError('Artist unavailable', 'We couldn\'t load this artist right now.', true);
      }
    }
  }

  function renderLoadingSkeleton() {
    const container = document.getElementById('artist-page-container');
    if (!container) return;
    container.innerHTML = `
      <div class="artist-skeleton-view max-w-5xl mx-auto px-4 py-8 space-y-8 animate-pulse">
        <div class="flex flex-col md:flex-row items-center gap-6 p-6 rounded-2xl bg-white/5">
          <div class="w-36 h-36 md:w-44 md:h-44 rounded-full bg-white/10 shrink-0"></div>
          <div class="flex-1 space-y-3 text-center md:text-left w-full">
            <div class="h-4 bg-white/10 rounded w-24 mx-auto md:mx-0"></div>
            <div class="h-8 bg-white/10 rounded w-3/5 mx-auto md:mx-0"></div>
            <div class="h-4 bg-white/5 rounded w-2/5 mx-auto md:mx-0"></div>
            <div class="h-10 bg-white/10 rounded-xl w-36 mx-auto md:mx-0 mt-4"></div>
          </div>
        </div>
        <div class="space-y-3">
          <div class="h-6 bg-white/10 rounded w-32 mb-4"></div>
          ${[1, 2, 3, 4, 5].map(() => `
            <div class="flex items-center gap-4 p-3 rounded-xl bg-white/5">
              <div class="w-10 h-10 rounded-lg bg-white/10 shrink-0"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3.5 bg-white/10 rounded w-2/5"></div>
                <div class="h-2.5 bg-white/5 rounded w-1/4"></div>
              </div>
              <div class="w-10 h-3 bg-white/5 rounded"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderError(title, message, retry = false) {
    const container = document.getElementById('artist-page-container');
    if (!container) return;
    container.innerHTML = `
      <div class="artist-error-view max-w-md mx-auto px-4 py-24 text-center">
        <div class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 text-white/40">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </div>
        <h3 class="text-base font-semibold text-white mb-1">${escapeHtml(title)}</h3>
        <p class="text-xs text-white/50 mb-4">${escapeHtml(message)}</p>
        <div class="flex items-center justify-center gap-3">
          ${retry ? `<button type="button" class="btn-subtle text-xs px-4 py-2 rounded-xl" onclick="ArtistPageEngine.retry()">Retry</button>` : ''}
          <a href="/music" class="text-xs text-[var(--accent)] font-bold uppercase tracking-wider underline px-2 py-2">← Explore Music</a>
        </div>
      </div>
    `;
  }

  function renderArtistPage(data) {
    const container = document.getElementById('artist-page-container');
    if (!container) return;

    const { artist, topSongs = [], albums = [], singles = [], relatedArtists = [] } = data;
    const name = escapeHtml(artist.name || 'Artist');
    const thumb = normalizeThumbnailUrl(artist.thumbnail);
    const subs = artist.subscribers ? `${escapeHtml(artist.subscribers)} subscribers` : 'Artist Profile';
    document.title = `${name} | GULLYGANG Music`;

    container.innerHTML = `
      <div class="artist-entity-view max-w-5xl mx-auto px-4 py-8 space-y-10">
        <!-- Hero Banner -->
        <section class="artist-hero-card flex flex-col md:flex-row items-center gap-6 p-6 md:p-8 rounded-3xl bg-white/[0.03] border border-white/5 backdrop-blur-xl relative overflow-hidden">
          <div class="relative w-36 h-36 md:w-44 md:h-44 rounded-full overflow-hidden shadow-2xl ring-4 ring-white/10 shrink-0">
            <img src="${thumb}" alt="${name}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
          </div>
          <div class="flex-1 text-center md:text-left space-y-2">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">Verified Artist</div>
            <h1 class="text-2xl md:text-4xl font-extrabold text-white tracking-tight">${name}</h1>
            <p class="text-xs md:text-sm text-white/60">${subs}</p>
            ${artist.description ? `<p class="text-xs text-white/50 max-w-xl line-clamp-2 mt-1">${escapeHtml(artist.description)}</p>` : ''}
            <div class="pt-3 flex flex-wrap items-center justify-center md:justify-start gap-3">
              ${topSongs.length > 0 ? `
                <button type="button" id="btn-artist-play-top" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 transition-all shadow-lg active:scale-95">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <span>Play Top Songs</span>
                </button>
              ` : ''}
            </div>
          </div>
        </section>

        <!-- Top Songs Section -->
        ${topSongs.length > 0 ? `
          <section class="artist-top-songs-section space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-bold text-white tracking-wide uppercase">Top Songs</h2>
              <span class="text-xs text-white/40">${topSongs.length} popular tracks</span>
            </div>
            <div class="artist-songs-list divide-y divide-white/5 border border-white/5 rounded-2xl bg-white/[0.02] overflow-hidden" role="list">
              ${topSongs.map((track, idx) => {
                const title = escapeHtml(track.title);
                const album = escapeHtml(track.album || name);
                const trackThumb = normalizeThumbnailUrl(track.thumbnail, track.videoId);
                return `
                  <div class="artist-song-row group flex items-center gap-3 p-3 hover:bg-white/5 transition-colors cursor-pointer" data-action="play-song" data-index="${idx}">
                    <span class="w-6 text-center text-xs text-white/40 tabular-nums font-mono">${idx + 1}</span>
                    <div class="relative w-11 h-11 rounded-lg overflow-hidden bg-black/40 shrink-0">
                      <img src="${trackThumb}" class="w-full h-full object-cover" alt="${title}" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
                      <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      </div>
                    </div>
                    <div class="flex-1 min-w-0">
                      <h4 class="text-sm font-medium text-white truncate group-hover:text-[var(--accent)] transition-colors">${title}</h4>
                      <p class="text-xs text-white/50 truncate">${album}</p>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                      <span class="text-xs text-white/40 tabular-nums hidden sm:inline-block">${track.duration || '0:00'}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </section>
        ` : ''}

        <!-- Albums & Singles Sections -->
        ${albums.length > 0 ? `
          <section class="artist-albums-section space-y-4">
            <h2 class="text-lg font-bold text-white tracking-wide uppercase">Albums</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              ${albums.map(alb => renderAlbumCard(alb)).join('')}
            </div>
          </section>
        ` : ''}

        ${singles.length > 0 ? `
          <section class="artist-singles-section space-y-4">
            <h2 class="text-lg font-bold text-white tracking-wide uppercase">Singles & EPs</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              ${singles.map(alb => renderAlbumCard(alb)).join('')}
            </div>
          </section>
        ` : ''}

        <!-- Related Artists Section -->
        ${relatedArtists.length > 0 ? `
          <section class="artist-related-section space-y-4">
            <h2 class="text-lg font-bold text-white tracking-wide uppercase">Fans Also Like</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              ${relatedArtists.map(art => {
                const artName = escapeHtml(art.name);
                const artThumb = normalizeThumbnailUrl(art.thumbnail);
                return `
                  <a href="/music/artist/${art.id}" class="artist-related-card group flex flex-col items-center text-center p-3 rounded-2xl hover:bg-white/5 transition-colors">
                    <div class="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden mb-2 ring-2 ring-white/10 group-hover:ring-[var(--accent)] transition-all">
                      <img src="${artThumb}" alt="${artName}" class="w-full h-full object-cover" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
                    </div>
                    <h4 class="text-xs font-semibold text-white truncate max-w-full group-hover:text-[var(--accent)] transition-colors">${artName}</h4>
                    <span class="text-[10px] text-white/40">Artist</span>
                  </a>
                `;
              }).join('')}
            </div>
          </section>
        ` : ''}
      </div>
    `;

    // Event Handlers
    document.getElementById('btn-artist-play-top')?.addEventListener('click', () => {
      playAllArtistSongs(topSongs, artist.name);
    });

    container.querySelectorAll('[data-action="play-song"]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        if (topSongs[idx]) playArtistSong(topSongs, idx);
      });
    });
  }

  function renderAlbumCard(alb) {
    const title = escapeHtml(alb.title || 'Album');
    const thumb = normalizeThumbnailUrl(alb.thumbnail);
    const year = alb.year ? escapeHtml(alb.year) : 'Album';
    return `
      <a href="/music/album/${alb.id}" class="artist-album-card group flex flex-col p-2.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all">
        <div class="relative aspect-square w-full rounded-xl overflow-hidden mb-2 bg-black/40">
          <img src="${thumb}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <h4 class="text-xs font-semibold text-white truncate group-hover:text-[var(--accent)] transition-colors">${title}</h4>
        <span class="text-[10px] text-white/50">${year}</span>
      </a>
    `;
  }

  function playAllArtistSongs(songs, artistName) {
    if (!songs || songs.length === 0) return;
    if (Analytics && typeof Analytics.trackArtistPlayAll === 'function') {
      Analytics.trackArtistPlayAll(currentArtistId, songs.length);
    }
    state.tracks = songs.map(s => ({
      ...s,
      source: 'ytmusic'
    }));
    state.currentIndex = 0;
    if (window.GullyMusic?.loadTrackAtIndex) {
      window.GullyMusic.loadTrackAtIndex(0, true, 'direct');
    }
  }

  function playArtistSong(songs, index) {
    if (!songs || !songs[index]) return;
    state.tracks = songs.map(s => ({
      ...s,
      source: 'ytmusic'
    }));
    state.currentIndex = index;
    if (window.GullyMusic?.loadTrackAtIndex) {
      window.GullyMusic.loadTrackAtIndex(index, true, 'direct');
    }
  }

  function retry() {
    if (currentArtistId) init(currentArtistId);
  }

  return {
    init,
    retry,
    playAllArtistSongs
  };
})();

if (typeof window !== 'undefined') {
  window.ArtistPageEngine = ArtistPageEngine;
}
