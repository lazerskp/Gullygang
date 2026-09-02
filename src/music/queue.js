// ============================================================
// GULLYGANG — PLAYLIST QUEUE & PREVIEW SYSTEM
// ============================================================

import { state, escapeHtml, normalizeThumbnailUrl } from '../core/state.js';
import { Analytics } from '../analytics/analytics.js';

export const PlaylistPreviewEngine = (function () {
  let isOpen = false;
  let onTrackSelectHandler = null;

  function setTrackSelectHandler(fn) {
    onTrackSelectHandler = fn;
  }

  function render() {
    const panel = document.getElementById('playlist-preview-panel');
    const listEl = document.getElementById('playlist-preview-list');
    const titleEl = document.getElementById('playlist-preview-title');
    const badgeEl = document.getElementById('playlist-preview-badge') || document.getElementById('playlist-preview-count-badge');
    if (!panel || !listEl) return;

    const currentPlaylist = state.currentPlaylist || { name: 'GULLYGANG Station' };
    const tracks = state.tracks || [];

    if (titleEl) titleEl.textContent = currentPlaylist.name || 'Current Playlist';
    if (badgeEl) badgeEl.textContent = `${tracks.length} ${tracks.length === 1 ? 'SONG' : 'SONGS'}`;

    if (tracks.length === 0) {
      listEl.innerHTML = '<div class="py-8 text-center text-xs text-white/40 uppercase tracking-widest">No songs loaded in active playlist</div>';
      return;
    }

    const activeIdx = state.currentIndex || 0;
    listEl.innerHTML = tracks.map((track, idx) => {
      const isActive = idx === activeIdx;
      const cleanTitle = escapeHtml(track.title || 'Untitled Track');
      const cleanArtist = escapeHtml(track.artist || 'GULLYGANG');
      const artworkUrl = normalizeThumbnailUrl(track.thumbnail, track.id);
      const statusIcon = isActive
        ? '<span class="preview-playing-bars" aria-label="Currently Playing"><span class="bar bar-1"></span><span class="bar bar-2"></span><span class="bar bar-3"></span></span>'
        : `<span class="preview-track-num">${idx + 1}</span>`;

      return `
        <div class="playlist-preview-item" role="option" aria-selected="${isActive}">
          <button type="button" class="playlist-preview-row ${isActive ? 'is-active' : ''}" data-track-index="${idx}" aria-label="Play ${cleanTitle} by ${cleanArtist}">
            <div class="playlist-preview-idx-col">${statusIcon}</div>
            <img src="${artworkUrl}" class="playlist-preview-thumb" alt="${cleanTitle}" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
            <div class="playlist-preview-meta">
              <span class="playlist-preview-track-title">${cleanTitle}</span>
              <span class="playlist-preview-track-artist">${cleanArtist}</span>
            </div>
          </button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.playlist-preview-row').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const targetIdx = parseInt(btn.getAttribute('data-track-index'), 10);
        if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < tracks.length) {
          if (typeof onTrackSelectHandler === 'function') onTrackSelectHandler(targetIdx);
          const clickedTrack = tracks[targetIdx];
          if (clickedTrack) Analytics.trackMusic('track_play', state.currentPlaylist?.id, clickedTrack.id, clickedTrack.title);
          updateActiveState();
        }
      };
    });
  }

  function updateActiveState() {
    const listEl = document.getElementById('playlist-preview-list');
    const badgeEl = document.getElementById('playlist-preview-badge') || document.getElementById('playlist-preview-count-badge');
    const titleEl = document.getElementById('playlist-preview-title');

    if (titleEl && state.currentPlaylist) titleEl.textContent = state.currentPlaylist.name || 'Current Playlist';
    if (badgeEl && state.tracks) badgeEl.textContent = `${state.tracks.length} ${state.tracks.length === 1 ? 'SONG' : 'SONGS'}`;

    if (!listEl) return;
    const activeIdx = state.currentIndex || 0;
    listEl.querySelectorAll('.playlist-preview-row').forEach((row) => {
      const idx = parseInt(row.getAttribute('data-track-index'), 10);
      const isActive = idx === activeIdx;
      row.classList.toggle('is-active', isActive);
      row.closest('.playlist-preview-item')?.setAttribute('aria-selected', isActive ? 'true' : 'false');
      const idxCol = row.querySelector('.playlist-preview-idx-col');
      if (idxCol) {
        idxCol.innerHTML = isActive
          ? '<span class="preview-playing-bars" aria-label="Currently Playing"><span class="bar bar-1"></span><span class="bar bar-2"></span><span class="bar bar-3"></span></span>'
          : `<span class="preview-track-num">${idx + 1}</span>`;
      }
    });
  }

  function open() {
    const panel = document.getElementById('playlist-preview-panel');
    const backdrop = document.getElementById('playlist-preview-backdrop');
    if (!panel) return;

    render();
    isOpen = true;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('#btn-playlist-preview, #btn-playlist-preview-mobile').forEach(b => {
      b.setAttribute('aria-expanded', 'true');
      b.classList.add('is-active');
    });

    if (window.innerWidth < 768) {
      backdrop?.classList.remove('hidden');
      panel.classList.add('is-mobile-sheet');
    } else {
      backdrop?.classList.add('hidden');
      panel.classList.remove('is-mobile-sheet');
      positionDesktop();
    }
  }

  function close() {
    const panel = document.getElementById('playlist-preview-panel');
    if (!panel) return;
    isOpen = false;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('playlist-preview-backdrop')?.classList.add('hidden');
    document.querySelectorAll('#btn-playlist-preview, #btn-playlist-preview-mobile').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
      b.classList.remove('is-active');
    });
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function positionDesktop() {
    const panel = document.getElementById('playlist-preview-panel');
    if (!panel) return;

    const trigger = document.getElementById('btn-playlist-preview') || document.getElementById('player-right-controls');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = 340;
    const pad = 16;
    let bottom = 80;
    let right = 24;

    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        right = Math.max(pad, Math.min(vw - rect.right, vw - width - pad));
        bottom = vh - rect.top + 12;
      }
    }

    panel.style.position = 'fixed';
    panel.style.bottom = `${Math.round(bottom)}px`;
    panel.style.right = `${Math.round(right)}px`;
    panel.style.left = 'auto';
    panel.style.top = 'auto';
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.min(420, vh - bottom - pad)}px`;
    panel.style.zIndex = '9999999';
  }

  function init() {
    if (!window.__gullygang_preview_global_attached) {
      window.__gullygang_preview_global_attached = true;
      document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-playlist-preview, #btn-playlist-preview-mobile')) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
          return;
        }
        if (e.target.closest('#btn-close-playlist-preview, #playlist-preview-backdrop')) {
          e.preventDefault();
          close();
          return;
        }
        if (isOpen) {
          const panel = document.getElementById('playlist-preview-panel');
          if (panel && !panel.contains(e.target)) close();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) close();
      });

      window.addEventListener('resize', () => {
        if (isOpen) {
          if (window.innerWidth < 768) {
            document.getElementById('playlist-preview-backdrop')?.classList.remove('hidden');
            document.getElementById('playlist-preview-panel')?.classList.add('is-mobile-sheet');
          } else {
            document.getElementById('playlist-preview-backdrop')?.classList.add('hidden');
            document.getElementById('playlist-preview-panel')?.classList.remove('is-mobile-sheet');
            positionDesktop();
          }
        }
      });
    }
  }

  const engineInstance = {
    init,
    open,
    close,
    toggle,
    render,
    updateActiveState,
    setTrackSelectHandler,
    attachListeners: () => {},
    isOpen: () => isOpen
  };

  if (typeof window !== 'undefined') window.PlaylistPreviewEngine = engineInstance;
  return engineInstance;
})();
