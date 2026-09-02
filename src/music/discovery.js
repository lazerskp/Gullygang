// ============================================================
// GULLYGANG — MUSIC DISCOVERY RENDERING ENGINE (STEP 15)
// ============================================================

import { escapeHtml, normalizeThumbnailUrl } from '../core/state.js';

export const MusicDiscoveryEngine = (function () {
  function renderGrouped(grouped, el, callbacks) {
    const { top = [], songs = [], artists = [], albums = [], videos = [] } = grouped;
    const topItem = top[0];
    if (!topItem && !songs.length && !artists.length && !albums.length && !videos.length) {
      callbacks?.onNotice('empty', 'No results found', 'Try another search query.');
      return;
    }

    let topHtml = '';
    if (topItem) {
      const isArtist = topItem.resultType === 'artist';
      const isAlbum = topItem.resultType === 'album';
      const title = escapeHtml(topItem.name || topItem.title || 'Result');
      const thumb = normalizeThumbnailUrl(topItem.thumbnail, topItem.videoId);
      const badge = isArtist ? 'Artist' : (isAlbum ? 'Album' : 'Song');
      const sub = isArtist ? (topItem.subscribers ? `${escapeHtml(topItem.subscribers)} subs` : 'Artist') : escapeHtml(topItem.artist || 'GULLYGANG');
      const act = isArtist ? `data-action="open-artist" data-id="${escapeHtml(topItem.id)}"` : (isAlbum ? `data-action="open-album" data-id="${escapeHtml(topItem.id)}"` : `data-action="play-top" data-id="${escapeHtml(topItem.videoId || topItem.id)}"`);

      topHtml = `
        <div class="space-y-2">
          <h4 class="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider px-1">Top Result</h4>
          <div class="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] transition-all cursor-pointer" ${act}>
            <div class="${isArtist ? 'w-16 h-16 rounded-full' : 'w-16 h-16 rounded-xl'} overflow-hidden bg-black/40 shrink-0">
              <img src="${thumb}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="eager" onerror="this.src='https://gullygang.in/brand-cover.png'" />
            </div>
            <div class="flex-1 min-w-0">
              <span class="inline-block px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-mono uppercase tracking-widest text-[var(--accent)] mb-1">${badge}</span>
              <h3 class="text-base font-bold text-white truncate group-hover:text-[var(--accent)]">${title}</h3>
              <p class="text-xs text-white/60 truncate">${sub}</p>
            </div>
            <div class="shrink-0 text-white/40 group-hover:text-[var(--accent)]">
              ${isArtist ? '<span class="text-xs font-semibold text-[var(--accent)]">View Artist →</span>' : (isAlbum ? '<span class="text-xs font-semibold text-[var(--accent)]">View Album →</span>' : '<div class="w-9 h-9 rounded-full bg-[var(--accent)] text-black flex items-center justify-center font-bold">▶</div>')}
            </div>
          </div>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="space-y-6 p-2">
        ${topHtml}
        ${songs.length ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1"><h4 class="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider">Songs</h4><button type="button" class="text-[11px] text-[var(--accent)] font-semibold" data-action="filter-tab" data-filter="songs">See All</button></div>
            <div class="divide-y divide-white/5 bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">${songs.slice(0, 4).map((s, idx) => renderSongRow(s, idx)).join('')}</div>
          </div>
        ` : ''}
        ${albums.length ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1"><h4 class="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider">Albums</h4><button type="button" class="text-[11px] text-[var(--accent)] font-semibold" data-action="filter-tab" data-filter="albums">See All</button></div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${albums.slice(0, 3).map(a => renderAlbumCard(a)).join('')}</div>
          </div>
        ` : ''}
        ${artists.length ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1"><h4 class="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider">Artists</h4><button type="button" class="text-[11px] text-[var(--accent)] font-semibold" data-action="filter-tab" data-filter="artists">See All</button></div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${artists.slice(0, 3).map(a => renderArtistCard(a)).join('')}</div>
          </div>
        ` : ''}
        ${videos.length ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1"><h4 class="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider">Videos</h4><button type="button" class="text-[11px] text-[var(--accent)] font-semibold" data-action="filter-tab" data-filter="videos">See All</button></div>
            <div class="divide-y divide-white/5 bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">${videos.slice(0, 3).map((v, idx) => renderSongRow(v, idx)).join('')}</div>
          </div>
        ` : ''}
      </div>
    `;

    attachGroupedHandlers(el, grouped, callbacks);
  }

  function renderSongRow(track, idx) {
    const title = escapeHtml(track.title);
    const meta = escapeHtml(track.album ? `${track.artist} • ${track.album}` : track.artist);
    const thumb = normalizeThumbnailUrl(track.thumbnail, track.videoId);
    return `
      <div class="group flex items-center gap-3 p-2.5 hover:bg-white/5 transition-colors cursor-pointer" data-action="play-song-item" data-id="${escapeHtml(track.videoId || track.id)}">
        <div class="relative w-11 h-11 rounded-lg overflow-hidden bg-black/40 shrink-0">
          <img src="${thumb}" class="w-full h-full object-cover" alt="${title}" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-xs sm:text-sm font-medium text-white truncate group-hover:text-[var(--accent)]">${title}</h4>
          <p class="text-[11px] text-white/50 truncate">${meta}</p>
        </div>
        <span class="text-[11px] text-white/40 tabular-nums shrink-0">${track.duration || '0:00'}</span>
      </div>
    `;
  }

  function renderAlbumCard(alb) {
    const title = escapeHtml(alb.title);
    return `
      <div class="group flex flex-col p-2 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-all cursor-pointer" data-action="open-album" data-id="${escapeHtml(alb.id)}">
        <div class="aspect-square w-full rounded-lg overflow-hidden mb-2 bg-black/40">
          <img src="${normalizeThumbnailUrl(alb.thumbnail)}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <h5 class="text-xs font-semibold text-white truncate group-hover:text-[var(--accent)]">${title}</h5>
        <span class="text-[10px] text-white/50 truncate">${escapeHtml(alb.artist)}</span>
      </div>
    `;
  }

  function renderArtistCard(art) {
    const name = escapeHtml(art.name);
    return `
      <div class="group flex flex-col items-center text-center p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-all cursor-pointer" data-action="open-artist" data-id="${escapeHtml(art.id)}">
        <div class="w-16 h-16 rounded-full overflow-hidden mb-2 bg-black/40 ring-2 ring-white/10 group-hover:ring-[var(--accent)] transition-all">
          <img src="${normalizeThumbnailUrl(art.thumbnail)}" alt="${name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <h5 class="text-xs font-semibold text-white truncate max-w-full group-hover:text-[var(--accent)]">${name}</h5>
        <span class="text-[10px] text-white/40">Artist</span>
      </div>
    `;
  }

  function renderTracks(tracks, el, callbacks) {
    if (!tracks?.length) { callbacks?.onNotice('empty', 'No tracks found', 'Try another search query.'); return; }
    el.innerHTML = `
      <div class="music-search-results-list divide-y divide-white/5" role="list">
        ${tracks.map((track, idx) => {
          const title = escapeHtml(track.title);
          const meta = escapeHtml(track.album ? `${track.artist} • ${track.album}` : track.artist);
          const thumb = normalizeThumbnailUrl(track.thumbnail, track.videoId);
          return `
            <div class="music-search-result-row group flex items-center gap-3 p-3 hover:bg-white/5 transition-colors rounded-xl" data-index="${idx}">
              <div class="relative w-12 h-12 rounded-lg overflow-hidden bg-black/40 shrink-0">
                <img src="${thumb}" class="w-full h-full object-cover" alt="${title}" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
                <button type="button" class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white" data-action="play" data-index="${idx}">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
              </div>
              <div class="flex-1 min-w-0 cursor-pointer" data-action="play" data-index="${idx}">
                <h4 class="text-sm font-medium text-white truncate group-hover:text-[var(--accent)]">${title}</h4>
                <p class="text-xs text-white/50 truncate">${meta}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs text-white/40 tabular-nums hidden sm:inline-block">${track.duration || '0:00'}</span>
                <div class="relative">
                  <button type="button" class="btn-track-action-menu p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg" data-track-index="${idx}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>
                  </button>
                  <div class="music-search-action-dropdown hidden absolute right-0 top-full mt-1 w-40 bg-[#141414] border border-white/10 rounded-xl shadow-2xl p-1 z-30 space-y-0.5">
                    <button type="button" class="action-dropdown-item" data-action="play" data-index="${idx}">Play Now</button>
                    <button type="button" class="action-dropdown-item" data-action="play-next" data-index="${idx}">Play Next</button>
                    <button type="button" class="action-dropdown-item" data-action="add-queue" data-index="${idx}">Add to Queue</button>
                    <button type="button" class="action-dropdown-item" data-action="add-playlist" data-index="${idx}">Save to Playlist</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    attachTrackListHandlers(el, tracks, callbacks);
  }

  function renderArtists(artists, el, callbacks) {
    if (!artists?.length) { callbacks?.onNotice('empty', 'No artists found', 'Try another artist name.'); return; }
    el.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3" role="list">${artists.map(a => renderArtistCard(a)).join('')}</div>`;
    attachEntityHandlers(el, callbacks);
  }

  function renderAlbums(albums, el, callbacks) {
    if (!albums?.length) { callbacks?.onNotice('empty', 'No albums found', 'Try another album name.'); return; }
    el.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3" role="list">${albums.map(a => renderAlbumCard(a)).join('')}</div>`;
    attachEntityHandlers(el, callbacks);
  }

  function attachEntityHandlers(el, callbacks) {
    el.querySelectorAll('[data-action="open-artist"]').forEach((item, idx) => {
      item.onclick = () => {
        const id = item.getAttribute('data-id');
        if (id && callbacks?.onOpenArtist) callbacks.onOpenArtist(id, idx);
      };
    });

    el.querySelectorAll('[data-action="open-album"]').forEach((item, idx) => {
      item.onclick = () => {
        const id = item.getAttribute('data-id');
        if (id && callbacks?.onOpenAlbum) callbacks.onOpenAlbum(id, idx);
      };
    });
  }

  function attachGroupedHandlers(el, grouped, callbacks) {
    attachEntityHandlers(el, callbacks);

    el.querySelectorAll('[data-action="filter-tab"]').forEach(btn => {
      btn.onclick = () => {
        const filter = btn.getAttribute('data-filter');
        if (filter && callbacks?.onSetFilter) callbacks.onSetFilter(filter);
      };
    });

    const allTracks = [...(grouped.top || []), ...(grouped.songs || []), ...(grouped.videos || [])];
    el.querySelectorAll('[data-action="play-top"], [data-action="play-song-item"]').forEach((item, idx) => {
      item.onclick = () => {
        const id = item.getAttribute('data-id');
        const track = allTracks.find(s => (s.videoId === id || s.id === id));
        if (track && callbacks?.onPlayTrack) callbacks.onPlayTrack(track, idx);
      };
    });
  }

  function attachTrackListHandlers(el, tracks, callbacks) {
    el.querySelectorAll('[data-action="play"]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (tracks[idx] && callbacks?.onPlayTrack) callbacks.onPlayTrack(tracks[idx], idx);
      };
    });

    el.querySelectorAll('.btn-track-action-menu').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.music-search-result-row')?.querySelector('.music-search-action-dropdown');
        el.querySelectorAll('.music-search-action-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
        dropdown?.classList.toggle('hidden');
      };
    });

    el.querySelectorAll('.action-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const action = item.getAttribute('data-action');
        const idx = parseInt(item.getAttribute('data-index'), 10);
        const track = tracks[idx];
        if (!track) return;
        item.closest('.music-search-action-dropdown')?.classList.add('hidden');

        if (action === 'play') callbacks?.onPlayTrack(track, idx);
        else if (action === 'play-next') callbacks?.onPlayNext(track);
        else if (action === 'add-queue') callbacks?.onAddQueue(track);
        else if (action === 'add-playlist') callbacks?.onAddPlaylist(track);
      };
    });

    document.addEventListener('click', () => {
      el.querySelectorAll('.music-search-action-dropdown').forEach(d => d.classList.add('hidden'));
    }, { once: true });
  }

  return {
    renderGrouped,
    renderTracks,
    renderArtists,
    renderAlbums,
    renderArtistCard,
    renderAlbumCard
  };
})();

if (typeof window !== 'undefined') window.MusicDiscoveryEngine = MusicDiscoveryEngine;
