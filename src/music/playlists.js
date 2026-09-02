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
  } catch (_) {}
  return [];
}

export const UserPlaylistEngine = {
  getPlaylists() {
    try {
      const val = localStorage.getItem('gullygang_user_playlists');
      return val ? JSON.parse(val) : [];
    } catch (_) {
      return [];
    }
  },
  savePlaylists(p) {
    try { localStorage.setItem('gullygang_user_playlists', JSON.stringify(p)); } catch (_) {}
  },
  init() {
    RealtimeManager.on('playlist.*', loadInsForgePlaylists);
  }
};
