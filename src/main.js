// ============================================================
// GULLYGANG — MAIN ENTRY POINT & APPLICATION BOOTSTRAP
// ============================================================

import { state, DOM, escapeHtml, formatTime, normalizeThumbnailUrl } from './core/state.js';
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

export function bootstrap() {
  let clockTimer = null;
  function startClockTimer() {
    if (clockTimer) clearInterval(clockTimer);
    updateLiveDateTime();
    clockTimer = setInterval(() => {
      if (!document.hidden) updateLiveDateTime();
    }, 1000);
  }
  startClockTimer();

  restoreCachedWeatherIfValid();

  // Initialize First-Party Analytics Engine & Track Initial Page View
  Analytics.init();
  Analytics.trackPageView();

  // Initialize Router and persistent engines
  GullyRouter.init(() => {
    Analytics.trackPageView();
    ThemeEngine.init();
    BlogEngine.init();
    ArticleEngine.init();
    LegalPagesEngine.init();
    UserPlaylistEngine.init();
    SupportEngine.init();
    PlaylistPreviewEngine.init();
    initEditorialExperienceAccordion();
    initFaqAccordion();
  });

  // Native Push Realtime Manager (Zero 3s/5s polling loops!)
  RealtimeManager.init();

  // Modular engines initialization
  ThemeEngine.init();
  BlogEngine.init();
  ArticleEngine.init();
  LegalPagesEngine.init();
  UserPlaylistEngine.init();
  SupportEngine.init();
  PlaylistPreviewEngine.init();
  AmbientAtmosphereEngine.init();
  loadInsForgePlaylists();
  loadInsForgeVisuals();
  initEditorialExperienceAccordion();
  initFaqAccordion();
}

if (typeof window !== 'undefined') {
  window.GullyGang = {
    state,
    RealtimeManager,
    GullyRouter,
    BlogEngine,
    ArticleEngine,
    PlaylistPreviewEngine,
    ThemeEngine
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
