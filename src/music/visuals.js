// ============================================================
// GULLYGANG — VISUAL ATMOSPHERE & BACKGROUND SYSTEM
// ============================================================

import { state } from '../core/state.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';

export const AmbientAtmosphereEngine = (function () {
  let isInit = false;

  function init() {
    if (isInit) return;
    isInit = true;

    // Listen to realtime visual updates
    RealtimeManager.on('visual.*', () => {
      loadInsForgeVisuals(true);
    });
  }

  return { init };
})();

export async function loadInsForgeVisuals(force = false) {
  try {
    const res = await fetch('/api/public?type=visuals');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        state.visuals = data;
      }
    }
  } catch (err) {
    console.warn('[Visuals] Failed to load visuals:', err.message);
  }
}
