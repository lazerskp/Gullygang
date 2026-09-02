// ============================================================
// GULLYGANG — UNIVERSAL MUSIC SEARCH & PLAY SYSTEM (STEP 15)
// ============================================================

import { state, escapeHtml, normalizeThumbnailUrl } from '../core/state.js';
import { Analytics } from '../analytics/analytics.js';

export const MusicSearchEngine = (function () {
  let isModalOpen = false;
  let activeSearchController = null;
  let activeSuggestionsController = null;
  let debounceTimer = null;
  let lastSearchedQuery = '';
  let currentResults = null;
  let currentSuggestions = [];
  let selectedSuggestionIndex = -1;
  let activeFilter = 'all';

  function init() {
    if (typeof document === 'undefined') return;

    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); toggle(); }
      else if (k === '/' && !isModalOpen) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) { e.preventDefault(); open(); }
      } else if (e.key === 'Escape' && isModalOpen) { e.preventDefault(); close(); }
    });

    document.querySelectorAll('.btn-music-search-trigger, #btn-music-search-nav, #btn-music-search-mobile').forEach(b => b.onclick = (e) => { e.preventDefault(); open(); });
    document.getElementById('music-search-backdrop')?.addEventListener('click', close);
    document.getElementById('btn-close-music-search')?.addEventListener('click', close);

    const input = document.getElementById('music-search-input');
    const clearBtn = document.getElementById('music-search-clear');
    if (input) {
      input.oninput = (e) => {
        const val = e.target.value;
        clearBtn?.classList.toggle('hidden', !val);
        handleInputChange(val);
      };
      input.onkeydown = handleInputKeydown;
      input.onfocus = () => { if (input.value.trim().length >= 2 && currentSuggestions.length > 0) showSuggestions(); };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        if (input) { input.value = ''; input.focus(); }
        clearBtn.classList.add('hidden');
        hideSuggestions();
        renderEmptyState();
      };
    }

    document.querySelectorAll('.music-search-filter-btn').forEach(b => b.onclick = () => setFilter(b.getAttribute('data-filter') || 'all'));
  }

  function open(initialQuery = '') {
    const modal = document.getElementById('music-search-modal');
    const input = document.getElementById('music-search-input');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('music-search-backdrop')?.classList.remove('hidden');
    document.body.classList.add('music-search-open');
    isModalOpen = true;

    if (input) {
      if (initialQuery) {
        input.value = initialQuery;
        document.getElementById('music-search-clear')?.classList.remove('hidden');
        performSearch(initialQuery);
      } else if (!input.value) renderEmptyState();
      setTimeout(() => input.focus(), 50);
    }
  }

  function close() {
    document.getElementById('music-search-modal')?.classList.add('hidden');
    document.getElementById('music-search-backdrop')?.classList.add('hidden');
    document.body.classList.remove('music-search-open');
    isModalOpen = false;
    hideSuggestions();
    if (activeSearchController) { activeSearchController.abort(); activeSearchController = null; }
    if (activeSuggestionsController) { activeSuggestionsController.abort(); activeSuggestionsController = null; }
  }

  function toggle() { if (isModalOpen) close(); else open(); }

  function handleInputChange(val) {
    const query = (val || '').trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.length < 2) {
      hideSuggestions();
      if (query.length === 0) renderEmptyState();
      return;
    }
    debounceTimer = setTimeout(() => {
      fetchSuggestions(query);
      performSearch(query);
    }, 260);
  }

  function handleInputKeydown(e) {
    const suggestionsEl = document.getElementById('music-search-suggestions');
    const isVisible = suggestionsEl && !suggestionsEl.classList.contains('hidden');

    if (e.key === 'ArrowDown') {
      if (isVisible && currentSuggestions.length > 0) {
        e.preventDefault();
        selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1);
        updateSelectedSuggestion();
      }
    } else if (e.key === 'ArrowUp') {
      if (isVisible && currentSuggestions.length > 0) {
        e.preventDefault();
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
        updateSelectedSuggestion();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const input = document.getElementById('music-search-input');
      const selected = (isVisible && selectedSuggestionIndex >= 0) ? currentSuggestions[selectedSuggestionIndex] : input?.value.trim();
      if (selected && selected.length >= 2) {
        if (input) input.value = selected;
        hideSuggestions();
        performSearch(selected);
      }
    } else if (e.key === 'Escape') {
      if (isVisible) { e.stopPropagation(); hideSuggestions(); }
      else close();
    }
  }

  async function fetchSuggestions(query) {
    if (activeSuggestionsController) activeSuggestionsController.abort();
    activeSuggestionsController = new AbortController();
    try {
      const res = await fetch(`/api/music?action=suggestions&q=${encodeURIComponent(query)}`, { signal: activeSuggestionsController.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && Array.isArray(data.suggestions)) {
        currentSuggestions = data.suggestions;
        renderSuggestions();
      }
    } catch (_) {
      currentSuggestions = [];
      hideSuggestions();
    }
  }

  function renderSuggestions() {
    const el = document.getElementById('music-search-suggestions');
    if (!el || !currentSuggestions?.length) { hideSuggestions(); return; }
    selectedSuggestionIndex = -1;
    el.innerHTML = currentSuggestions.map((sug, idx) => `
      <div class="music-search-suggestion-item" role="option" id="sug-item-${idx}" data-index="${idx}" data-query="${escapeHtml(sug)}">
        <svg class="suggestion-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <span class="suggestion-text">${escapeHtml(sug)}</span>
      </div>
    `).join('');
    el.classList.remove('hidden');
    el.querySelectorAll('.music-search-suggestion-item').forEach(item => {
      item.onclick = () => {
        const q = item.getAttribute('data-query');
        const input = document.getElementById('music-search-input');
        if (input && q) { input.value = q; hideSuggestions(); performSearch(q); }
      };
    });
  }

  function updateSelectedSuggestion() {
    const el = document.getElementById('music-search-suggestions');
    if (!el) return;
    el.querySelectorAll('.music-search-suggestion-item').forEach((item, idx) => {
      const isSelected = idx === selectedSuggestionIndex;
      item.classList.toggle('is-selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
  }

  function hideSuggestions() {
    document.getElementById('music-search-suggestions')?.classList.add('hidden');
    selectedSuggestionIndex = -1;
  }

  function showSuggestions() {
    if (currentSuggestions.length > 0) document.getElementById('music-search-suggestions')?.classList.remove('hidden');
  }

  async function performSearch(query) {
    const cleanQuery = (query || '').trim();
    if (cleanQuery.length < 2) { renderEmptyState(); return; }

    lastSearchedQuery = cleanQuery;
    renderLoadingState();

    if (activeSearchController) activeSearchController.abort();
    activeSearchController = new AbortController();

    try {
      const res = await fetch(`/api/music?action=search&q=${encodeURIComponent(cleanQuery)}&type=${encodeURIComponent(activeFilter)}&limit=25`, {
        signal: activeSearchController.signal
      });
      if (!res.ok) { renderNotice('notice', 'Notice', 'Music search is temporarily unavailable.', true); return; }
      const data = await res.json();
      if (data?.success && data.results) {
        currentResults = data.results;
        const count = Array.isArray(data.results) ? data.results.length : ((data.results.songs?.length || 0) + (data.results.artists?.length || 0) + (data.results.albums?.length || 0));
        Analytics.trackMusicSearch(cleanQuery, count);
        renderResults();
      } else {
        renderNotice('empty', 'No results found', 'Try another song, artist, album or video.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') renderNotice('notice', 'Notice', 'Couldn\'t search right now.', true);
    }
  }

  function setFilter(filter) {
    if (activeFilter === filter) return;
    activeFilter = filter;
    document.querySelectorAll('.music-search-filter-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-filter') === filter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (lastSearchedQuery) performSearch(lastSearchedQuery);
  }

  function renderLoadingState() {
    const el = document.getElementById('music-search-results');
    if (!el) return;
    el.innerHTML = `<div class="music-search-skeletons space-y-3 p-4">${[1, 2, 3, 4].map(() => `<div class="flex items-center gap-3 p-2 rounded-lg bg-white/5 animate-pulse"><div class="w-12 h-12 rounded bg-white/10 shrink-0"></div><div class="flex-1 space-y-2"><div class="h-3.5 bg-white/10 rounded w-3/5"></div><div class="h-2.5 bg-white/5 rounded w-2/5"></div></div></div>`).join('')}</div>`;
  }

  function renderNotice(type, title, desc, retry = false) {
    const el = document.getElementById('music-search-results');
    if (!el) return;
    el.innerHTML = `
      <div class="music-search-empty-state text-center py-16 px-4">
        <div class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 ${type === 'start' ? 'text-[var(--accent)]' : 'text-white/40'}">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
        <h3 class="text-sm font-semibold text-white mb-1">${escapeHtml(title)}</h3>
        <p class="text-xs text-white/50 max-w-xs mx-auto mb-3">${escapeHtml(desc)}</p>
        ${retry ? '<button type="button" class="btn-subtle text-xs px-3 py-1" onclick="MusicSearchEngine.retrySearch()">Retry</button>' : ''}
      </div>
    `;
  }

  function renderEmptyState() { renderNotice('start', 'Search millions of songs & artists', 'Explore songs, artists, albums, and videos.'); }

  function navigateToEntity(path) {
    close();
    if (window.GullyRouter?.navigateTo) window.GullyRouter.navigateTo(path);
    else window.location.href = path;
  }

  async function getDiscoveryEngine() {
    if (window.MusicDiscoveryEngine) return window.MusicDiscoveryEngine;
    try {
      const m = await import('./discovery.js');
      return m.MusicDiscoveryEngine || window.MusicDiscoveryEngine;
    } catch (_) {
      return null;
    }
  }

  async function renderResults() {
    const el = document.getElementById('music-search-results');
    if (!el || !currentResults) return;

    const callbacks = {
      onNotice: renderNotice,
      onOpenArtist: (id, idx) => { Analytics.trackArtistResultClick(id, lastSearchedQuery, idx + 1); navigateToEntity(`/music/artist/${id}`); },
      onOpenAlbum: (id, idx) => { Analytics.trackAlbumResultClick(id, lastSearchedQuery, idx + 1); navigateToEntity(`/music/album/${id}`); },
      onSetFilter: setFilter,
      onPlayTrack: (track, idx) => playTrackImmediately(track, idx),
      onPlayNext: (track) => insertTrackPlayNext(track),
      onAddQueue: (track) => appendTrackToQueue(track),
      onAddPlaylist: (track) => promptAddToPlaylist(track)
    };

    const engine = await getDiscoveryEngine();
    if (!engine) return;

    if (activeFilter === 'all' && typeof currentResults === 'object' && !Array.isArray(currentResults)) {
      engine.renderGrouped(currentResults, el, callbacks);
    } else if (activeFilter === 'artists' && Array.isArray(currentResults)) {
      engine.renderArtists(currentResults, el, callbacks);
    } else if (activeFilter === 'albums' && Array.isArray(currentResults)) {
      engine.renderAlbums(currentResults, el, callbacks);
    } else {
      const tracks = Array.isArray(currentResults) ? currentResults : (currentResults.songs || []);
      engine.renderTracks(tracks, el, callbacks);
    }
  }

  function normalizeTrackItem(track) {
    return {
      id: track.videoId || track.id,
      videoId: track.videoId || track.id,
      title: track.title,
      artist: track.artist || 'GULLYGANG',
      thumbnail: normalizeThumbnailUrl(track.thumbnail, track.videoId || track.id),
      duration: track.duration || '0:00',
      duration_seconds: track.duration_seconds || 0,
      source: 'ytmusic'
    };
  }

  function playTrackImmediately(track, position = 1) {
    if (!track) return;
    Analytics.trackMusicSearchResultClick(track.videoId || track.id, lastSearchedQuery, position + 1);
    Analytics.trackMusic('track_play', 'search', track.videoId || track.id, track.title);

    const normTrack = normalizeTrackItem(track);
    if (!Array.isArray(state.tracks)) state.tracks = [];

    const curIdx = state.currentIndex || 0;
    state.tracks.splice(curIdx, 0, normTrack);
    state.currentIndex = curIdx;

    if (window.GullyMusic?.loadTrackAtIndex) {
      window.GullyMusic.loadTrackAtIndex(curIdx, true, 'direct');
    } else if (typeof window.loadTrackAtIndex === 'function') {
      window.loadTrackAtIndex(curIdx, true, 'direct');
    } else if (state.ytPlayer?.loadVideoById) {
      state.ytPlayer.loadVideoById(normTrack.id, 0);
      state.isPlaying = true;
    }

    showToast(`Playing "${normTrack.title}"`);
    close();
  }

  function insertTrackPlayNext(track) {
    if (!track) return;
    const normTrack = normalizeTrackItem(track);
    if (!Array.isArray(state.tracks)) state.tracks = [];
    state.tracks.splice((state.currentIndex || 0) + 1, 0, normTrack);
    showToast(`"${normTrack.title}" will play next`);
  }

  function appendTrackToQueue(track) {
    if (!track) return;
    const normTrack = normalizeTrackItem(track);
    if (!Array.isArray(state.tracks)) state.tracks = [];
    state.tracks.push(normTrack);
    showToast(`Added "${normTrack.title}" to queue`);
  }

  function promptAddToPlaylist(track) {
    if (window.UserPlaylistEngine?.openAddTrackModal) {
      window.UserPlaylistEngine.openAddTrackModal(track);
    } else {
      showToast(`Track saved: "${track.title}"`);
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

  function retrySearch() {
    if (lastSearchedQuery) performSearch(lastSearchedQuery);
  }

  return {
    init,
    open,
    close,
    toggle,
    performSearch,
    retrySearch,
    setFilter,
    playTrackImmediately,
    insertTrackPlayNext,
    appendTrackToQueue,
    isOpen: () => isModalOpen
  };
})();

if (typeof window !== 'undefined') window.MusicSearchEngine = MusicSearchEngine;
