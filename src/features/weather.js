// ============================================================
// GULLYGANG — ATMOSPHERIC WEATHER & LIVE TIME MODULE
// ============================================================

export function updateLiveDateTime() {
  const timeEl = document.getElementById('live-time');
  const clockEl = document.getElementById('weather-clock');
  if (!timeEl && !clockEl) return;

  const timeStr = new Date().toLocaleTimeString('en-US', {
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
      const p = JSON.parse(cached);
      if (Date.now() - p.timestamp < 1800000) {
        const loc = document.getElementById('weather-location');
        const temp = document.getElementById('weather-temp');
        const cond = document.getElementById('weather-condition');
        if (loc && p.city) loc.textContent = p.city;
        if (temp && p.temp) temp.textContent = p.temp;
        if (cond && p.desc) cond.textContent = p.desc;
        return true;
      }
    }
  } catch (_) {}
  return false;
}
