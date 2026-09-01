// ============================================================
// GULLYGANG — ATMOSPHERIC WEATHER & LIVE TIME MODULE
// ============================================================

export function updateLiveDateTime() {
  const timeEl = document.getElementById('live-time');
  const clockEl = document.getElementById('weather-clock');
  if (!timeEl && !clockEl) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  if (timeEl) timeEl.textContent = timeStr;
  if (clockEl) clockEl.textContent = timeStr;
}

export function restoreCachedWeatherIfValid() {
  try {
    const cached = sessionStorage.getItem('gullygang_cached_weather');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < 1800000) {
        const locEl = document.getElementById('weather-location');
        const tempEl = document.getElementById('weather-temp');
        const descEl = document.getElementById('weather-condition');
        if (locEl && parsed.city) locEl.textContent = parsed.city;
        if (tempEl && parsed.temp) tempEl.textContent = parsed.temp;
        if (descEl && parsed.desc) descEl.textContent = parsed.desc;
        return true;
      }
    }
  } catch (_) {}
  return false;
}
