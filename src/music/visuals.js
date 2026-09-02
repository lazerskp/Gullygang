// ============================================================
// GULLYGANG — VISUAL ATMOSPHERE & BACKGROUND SYSTEM
// ============================================================

import { state } from '../core/state.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';

export const AmbientAtmosphereEngine = {
  init() {
    RealtimeManager.on('visual.*', () => loadInsForgeVisuals(true));
  }
};

export async function loadInsForgeVisuals() {
  try {
    const res = await fetch('/api/public?type=visuals');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) state.visuals = data;
    }
  } catch (_) {}
}
