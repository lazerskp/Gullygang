// ============================================================
// GULLYGANG — PLAYLIST PREVIEW & NOW PLAYING QUEUE ENGINE
// Authoritative track list, active row indicator, and slideout panel
// ============================================================

import { state } from '../core/state.js';

export const PlaylistPreviewEngine = (function () {
  let isOpen = false;
  let onTrackSelectHandler = null;

  function setTrackSelectHandler(fn) {
    onTrackSelectHandler = fn;
  }

  function getTrackArtworkUrl(track) {
    if (track.thumbnail && track.thumbnail.trim().length > 0 && !track.thumbnail.includes('placeholder')) {
      return track.thumbnail.trim();
    }
    if (track.id && typeof track.id === 'string' && track.id.trim().length > 0) {
      return `https://i.ytimg.com/vi/${track.id.trim()}/hqdefault.jpg`;
    }
    return 'https://gullygang.in/brand-cover.png';
  }

  function render() {
    const panel = document.getElementById('playlist-preview-panel');
    const listEl = document.getElementById('playlist-preview-list');
    const titleEl = document.getElementById('playlist-preview-title');
    const badgeEl = document.getElementById('playlist-preview-badge') || document.getElementById('playlist-preview-count-badge');
    if (!panel || !listEl) return;

    const currentPlaylist = state.currentPlaylist || { name: 'GULLYGANG Station' };
    const tracks = state.tracks || [];

    if (titleEl) {
      titleEl.textContent = currentPlaylist.name || 'Current Playlist';
    }
    if (badgeEl) {
      const count = tracks.length;
      badgeEl.textContent = `${count} ${count === 1 ? 'SONG' : 'SONGS'}`;
    }

    if (tracks.length === 0) {
      listEl.innerHTML = `
        <div class="py-8 text-center text-xs text-white/40 uppercase tracking-widest">
          No songs loaded in active playlist
        </div>
      `;
      return;
    }

    const activeIdx = state.currentIndex || 0;
    const html = tracks.map((track, idx) => {
      const isActive = idx === activeIdx;
      const cleanTitle = (track.title || 'Untitled Track').replace(/"/g, '&quot;');
      const cleanArtist = (track.artist || 'GULLYGANG').replace(/"/g, '&quot;');
      const artworkUrl = getTrackArtworkUrl(track);

      const thumbHtml = artworkUrl ? `
        <img src="${artworkUrl}" class="playlist-preview-thumb" alt="${cleanTitle}" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
      ` : '';

      const statusIcon = isActive ? `
        <span class="preview-playing-bars" aria-label="Currently Playing">
          <span class="bar bar-1"></span>
          <span class="bar bar-2"></span>
          <span class="bar bar-3"></span>
        </span>
      ` : `
        <span class="preview-track-num">${idx + 1}</span>
      `;

      return `
        <div class="playlist-preview-item" role="option" aria-selected="${isActive}">
          <button type="button" class="playlist-preview-row ${isActive ? 'is-active' : ''}" data-track-index="${idx}" aria-label="Play ${cleanTitle} by ${cleanArtist}">
            <div class="playlist-preview-idx-col">
              ${statusIcon}
            </div>
            ${thumbHtml}
            <div class="playlist-preview-meta">
              <span class="playlist-preview-track-title">${cleanTitle}</span>
              <span class="playlist-preview-track-artist">${cleanArtist}</span>
            </div>
          </button>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    const rowBtns = listEl.querySelectorAll('.playlist-preview-row');
    rowBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetIdx = parseInt(btn.getAttribute('data-track-index'), 10);
        if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < tracks.length) {
          if (typeof onTrackSelectHandler === 'function') {
            onTrackSelectHandler(targetIdx);
          }
          updateActiveState();
        }
      });
    });
  }

  function updateActiveState() {
    const listEl = document.getElementById('playlist-preview-list');
    const badgeEl = document.getElementById('playlist-preview-badge') || document.getElementById('playlist-preview-count-badge');
    const titleEl = document.getElementById('playlist-preview-title');

    if (titleEl && state.currentPlaylist) {
      titleEl.textContent = state.currentPlaylist.name || 'Current Playlist';
    }
    if (badgeEl && state.tracks) {
      const count = state.tracks.length;
      badgeEl.textContent = `${count} ${count === 1 ? 'SONG' : 'SONGS'}`;
    }

    if (!listEl) return;
    const activeIdx = state.currentIndex || 0;
    const rows = listEl.querySelectorAll('.playlist-preview-row');
    rows.forEach((row) => {
      const idx = parseInt(row.getAttribute('data-track-index'), 10);
      const isActive = idx === activeIdx;
      row.classList.toggle('is-active', isActive);
      row.closest('.playlist-preview-item')?.setAttribute('aria-selected', isActive ? 'true' : 'false');

      const idxCol = row.querySelector('.playlist-preview-idx-col');
      if (idxCol) {
        if (isActive) {
          idxCol.innerHTML = `
            <span class="preview-playing-bars" aria-label="Currently Playing">
              <span class="bar bar-1"></span>
              <span class="bar bar-2"></span>
              <span class="bar bar-3"></span>
            </span>
          `;
        } else {
          idxCol.innerHTML = `<span class="preview-track-num">${idx + 1}</span>`;
        }
      }
    });
  }

  function open() {
    const panel = document.getElementById('playlist-preview-panel');
    const backdrop = document.getElementById('playlist-preview-backdrop');
    const btnPreview = document.getElementById('btn-playlist-preview');
    const btnPreviewMob = document.getElementById('btn-playlist-preview-mobile');
    if (!panel) return;

    render();

    isOpen = true;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    btnPreview?.setAttribute('aria-expanded', 'true');
    btnPreviewMob?.setAttribute('aria-expanded', 'true');
    btnPreview?.classList.add('is-active');
    btnPreviewMob?.classList.add('is-active');

    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      backdrop?.classList.remove('hidden');
      panel.classList.add('is-mobile-sheet');
    } else {
      backdrop?.classList.add('hidden');
      panel.classList.remove('is-mobile-sheet');
      positionDesktop();
    }

    setTimeout(() => {
      const activeRow = panel.querySelector('.playlist-preview-row.is-active');
      if (activeRow) {
        activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 50);
  }

  function close() {
    const panel = document.getElementById('playlist-preview-panel');
    const backdrop = document.getElementById('playlist-preview-backdrop');
    const btnPreview = document.getElementById('btn-playlist-preview');
    const btnPreviewMob = document.getElementById('btn-playlist-preview-mobile');
    if (!panel) return;

    isOpen = false;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    backdrop?.classList.add('hidden');
    btnPreview?.setAttribute('aria-expanded', 'false');
    btnPreviewMob?.setAttribute('aria-expanded', 'false');
    btnPreview?.classList.remove('is-active');
    btnPreviewMob?.classList.remove('is-active');
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function positionDesktop() {
    const panel = document.getElementById('playlist-preview-panel');
    if (!panel) return;

    const trigger = document.getElementById('btn-playlist-preview') || document.getElementById('player-right-controls');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = 340;
    const padding = 16;
    const gap = 12;

    let bottom = 80;
    let right = 24;

    if (trigger) {
      const triggerRect = trigger.getBoundingClientRect();
      if (triggerRect.width > 0 && triggerRect.height > 0) {
        right = viewportWidth - triggerRect.right;
        if (right < padding) right = padding;
        if (right + panelWidth > viewportWidth - padding) {
          right = viewportWidth - panelWidth - padding;
        }
        bottom = viewportHeight - triggerRect.top + gap;
      }
    }

    panel.style.position = 'fixed';
    panel.style.bottom = `${Math.round(bottom)}px`;
    panel.style.right = `${Math.round(right)}px`;
    panel.style.left = 'auto';
    panel.style.top = 'auto';
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${Math.min(420, viewportHeight - bottom - padding)}px`;
    panel.style.zIndex = '9999999';
  }

  function init() {
    if (!window.__gullygang_preview_global_attached) {
      window.__gullygang_preview_global_attached = true;

      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('#btn-playlist-preview, #btn-playlist-preview-mobile');
        if (trigger) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
          return;
        }

        const closeBtn = e.target.closest('#btn-close-playlist-preview');
        if (closeBtn) {
          e.preventDefault();
          e.stopPropagation();
          close();
          return;
        }

        const backdrop = e.target.closest('#playlist-preview-backdrop');
        if (backdrop) {
          close();
          return;
        }

        if (isOpen) {
          const panel = document.getElementById('playlist-preview-panel');
          if (panel && !panel.contains(e.target)) {
            close();
          }
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
          close();
        }
      });

      window.addEventListener('resize', () => {
        if (isOpen) {
          const isMobile = window.innerWidth < 768;
          const backdrop = document.getElementById('playlist-preview-backdrop');
          const panel = document.getElementById('playlist-preview-panel');
          if (isMobile) {
            backdrop?.classList.remove('hidden');
            panel?.classList.add('is-mobile-sheet');
            panel.style.bottom = '';
            panel.style.right = '';
            panel.style.left = '';
            panel.style.width = '';
            panel.style.maxHeight = '';
          } else {
            backdrop?.classList.add('hidden');
            panel?.classList.remove('is-mobile-sheet');
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

  if (typeof window !== 'undefined') {
    window.PlaylistPreviewEngine = engineInstance;
  }

  return engineInstance;
})();
