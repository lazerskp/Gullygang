// ============================================================
// GULLYGANG — PLAYLIST MANAGER & USER CUSTOM PLAYLISTS
// ============================================================

import { state } from '../core/state.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';

export async function loadInsForgePlaylists() {
  try {
    const res = await fetch('/api/public?type=playlists');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        state.playlists = data;
        return data;
      }
    }
  } catch (err) {
    console.warn('[Playlists] Failed to load playlists from InsForge:', err.message);
  }
  return [];
}

export const UserPlaylistEngine = (function () {
  const STORAGE_KEY = 'gullygang_user_playlists';

  function getPlaylists() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      return val ? JSON.parse(val) : [];
    } catch (_) {
      return [];
    }
  }

  function savePlaylists(playlists) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
    } catch (_) {}
  }

  function init() {
    // Attach realtime listeners
    RealtimeManager.on('playlist.*', () => {
      loadInsForgePlaylists();
    });
  }

  return { init, getPlaylists, savePlaylists };
})();
