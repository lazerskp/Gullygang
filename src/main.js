// ============================================================
// GULLYGANG — MAIN ENTRY POINT & APPLICATION BOOTSTRAP
// ============================================================

import { state } from './core/state.js';
import { GullyRouter } from './core/router.js';
import { RealtimeManager } from './realtime/realtime-manager.js';
import { Analytics } from './analytics/analytics.js';
import { BlogEngine } from './blog/feed.js';
import { ArticleEngine } from './blog/article.js';
import { PlaylistPreviewEngine } from './music/queue.js';
import { ThemeEngine, LegalPagesEngine, SupportEngine, initFaqAccordion, initEditorialExperienceAccordion } from './features/modals.js';
import { updateLiveDateTime, restoreCachedWeatherIfValid } from './features/weather.js';
import { loadInsForgePlaylists, UserPlaylistEngine } from './music/playlists.js';
import { loadInsForgeVisuals, AmbientAtmosphereEngine } from './music/visuals.js';
import { MusicSearchEngine } from './music/search.js';

export { MusicSearchEngine };

function initPageModules() {
  Analytics.trackPageView();
  ThemeEngine.init();
  BlogEngine.init();
  ArticleEngine.init();
  LegalPagesEngine.init();
  UserPlaylistEngine.init();
  SupportEngine.init();
  PlaylistPreviewEngine.init();
  MusicSearchEngine.init();
  initEditorialExperienceAccordion();
  initFaqAccordion();

  if (document.getElementById('artist-page-container')) {
    if (window.ArtistPageEngine) window.ArtistPageEngine.init();
    else {
      import('./music/artist.js').then(m => m.ArtistPageEngine?.init());
    }
  }

  if (document.getElementById('album-page-container')) {
    if (window.AlbumPageEngine) window.AlbumPageEngine.init();
    else {
      import('./music/album.js').then(m => m.AlbumPageEngine?.init());
    }
  }
}

export function bootstrap() {
  updateLiveDateTime();
  setInterval(() => { if (!document.hidden) updateLiveDateTime(); }, 1000);
  restoreCachedWeatherIfValid();

  Analytics.init();
  GullyRouter.init(initPageModules);
  RealtimeManager.init();

  initPageModules();
  AmbientAtmosphereEngine.init();
  loadInsForgePlaylists();
  loadInsForgeVisuals();
}

if (typeof window !== 'undefined') {
  window.GullyGang = {
    state,
    RealtimeManager,
    GullyRouter,
    BlogEngine,
    ArticleEngine,
    PlaylistPreviewEngine,
    MusicSearchEngine,
    ThemeEngine
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
