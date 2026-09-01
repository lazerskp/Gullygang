// ============================================================
// GULLYGANG — CORE AUTHORITATIVE APPLICATION STATE & UTILITIES
// ============================================================

export const state = {
  isPlaying: false,
  currentIndex: 0,
  currentPlaylist: null,
  playlists: [],
  tracks: [],
  isShuffle: false,
  isRepeat: false,
  volume: 1,
  isMuted: false,
  userInteracted: false,
  currentTrackDuration: 0,
  isSeeking: false,
  visuals: [],
  activeVisualId: 'default',
  currentStationId: 'station-1'
};

export const DOM = {};

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function normalizeThumbnailUrl(url, videoId) {
  if (url && typeof url === 'string' && url.trim().length > 0 && !url.includes('placeholder')) {
    return url.trim();
  }
  if (videoId && typeof videoId === 'string' && videoId.trim().length > 0) {
    return `https://i.ytimg.com/vi/${videoId.trim()}/hqdefault.jpg`;
  }
  return 'https://gullygang.in/brand-cover.png';
}

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export async function publicDataFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        ...(options.headers || {})
      }
    });
    return res;
  } catch (err) {
    console.warn('[PublicData] Network request notice:', err.message);
    throw err;
  }
}
