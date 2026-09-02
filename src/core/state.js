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

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

export function normalizeTagSlug(tag) {
  if (!tag || typeof tag !== 'string') return '';
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
