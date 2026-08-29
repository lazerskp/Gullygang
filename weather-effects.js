/**
 * GULLYGANG — Atmospheric Weather Effects Engine
 * Hyper-realistic 4K Cinematic Rain & Snow simulation with motion-blur gradients,
 * ground ripple physics, dynamic wind turbulence, and ultra-smooth 60fps rendering.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WeatherEffects = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'odiverse_weather_mode';
  const VALID_MODES = ['off', 'rain', 'snow'];

  let canvas = null;
  let ctx = null;
  let ambientOverlay = null;
  let currentMode = 'off';
  let isPlayingMusic = false;
  let animationFrameId = null;
  let lastTimestamp = 0;
  let dpr = 1;
  let width = 0;
  let height = 0;
  let isTabActive = true;
  let prefersReducedMotion = false;

  // Particle pools
  let rainDrops = [];
  let rainSplashes = [];
  let rainRipples = [];
  let snowflakes = [];

  // Lightning state
  let lightningTimer = 0;
  let lightningAlpha = 0;
  let lightningStep = 0;

  // Pre-rendered offscreen sprite cache for 60fps snow rendering
  let snowSprites = [];

  // --- Initialize Snow Sprites ---
  function initSnowSprites() {
    snowSprites = [];

    function makeSprite(size, drawFn) {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = size * 2;
      offCanvas.height = size * 2;
      const offCtx = offCanvas.getContext('2d');
      drawFn(offCtx, size);
      return offCanvas;
    }

    // Tier 0: Tiny dust
    snowSprites[0] = makeSprite(8, (c, s) => {
      const grad = c.createRadialGradient(s, s, 0, s, s, s);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.5, 'rgba(235, 245, 255, 0.8)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(s, s, s, 0, Math.PI * 2);
      c.fill();
    });

    // Tier 1: Midground crisp flake
    snowSprites[1] = makeSprite(16, (c, s) => {
      const grad = c.createRadialGradient(s, s, 0, s, s, s);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.4, 'rgba(240, 248, 255, 0.88)');
      grad.addColorStop(0.75, 'rgba(210, 235, 255, 0.35)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(s, s, s, 0, Math.PI * 2);
      c.fill();
    });

    // Tier 2: Foreground luminous flake
    snowSprites[2] = makeSprite(32, (c, s) => {
      const grad = c.createRadialGradient(s, s, 0, s, s, s);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.28, 'rgba(250, 252, 255, 0.94)');
      grad.addColorStop(0.6, 'rgba(205, 235, 255, 0.45)');
      grad.addColorStop(0.88, 'rgba(185, 220, 255, 0.15)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(s, s, s, 0, Math.PI * 2);
      c.fill();
    });

    // Tier 3: Cinematic Camera Bokeh Orb
    snowSprites[3] = makeSprite(64, (c, s) => {
      const grad = c.createRadialGradient(s, s, 0, s, s, s);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
      grad.addColorStop(0.35, 'rgba(235, 245, 255, 0.25)');
      grad.addColorStop(0.7, 'rgba(205, 230, 255, 0.1)');
      grad.addColorStop(0.95, 'rgba(180, 215, 255, 0.02)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(s, s, s, 0, Math.PI * 2);
      c.fill();
    });
  }

  // --- Rain Generator: 4 Depth Layers with Tapered Motion Blur ---
  function createRainDrop(randomY = true) {
    const isMobile = width < 768;
    const r = Math.random();

    let layer, speed, length, thickness, opacity;

    if (r < 0.4) {
      // Layer 0: Background fine mist drizzle
      layer = 0;
      speed = (isMobile ? 7 : 9.5) + Math.random() * 3.5;
      length = 10 + Math.random() * 8;
      thickness = 0.7;
      opacity = 0.18 + Math.random() * 0.16;
    } else if (r < 0.78) {
      // Layer 1: Midground gentle rainfall
      layer = 1;
      speed = (isMobile ? 11 : 14.5) + Math.random() * 4.5;
      length = 18 + Math.random() * 12;
      thickness = 1.05;
      opacity = 0.38 + Math.random() * 0.22;
    } else if (r < 0.94) {
      // Layer 2: Foreground smooth streaks
      layer = 2;
      speed = (isMobile ? 15 : 19.5) + Math.random() * 5.5;
      length = 26 + Math.random() * 16;
      thickness = 1.5;
      opacity = 0.62 + Math.random() * 0.25;
    } else {
      // Layer 3: Lens streak (close to camera)
      layer = 3;
      speed = (isMobile ? 18 : 23.5) + Math.random() * 6.5;
      length = 36 + Math.random() * 20;
      thickness = 2.2;
      opacity = 0.2 + Math.random() * 0.18;
    }

    return {
      x: Math.random() * (width + 160) - 80,
      y: randomY ? Math.random() * height : -length - Math.random() * 60,
      speed,
      length,
      thickness,
      opacity,
      layer,
      swayOffset: Math.random() * Math.PI * 2
    };
  }

  // --- Rain Splash Sparks & Water Rings ---
  function createRainImpact(x, y) {
    // 1. Water Ripple Ring
    if (Math.random() < 0.55) {
      rainRipples.push({
        x,
        y,
        radius: 1.5,
        maxRadius: 8 + Math.random() * 10,
        growth: 0.45 + Math.random() * 0.35,
        alpha: 0.55 + Math.random() * 0.25,
        decay: 0.025 + Math.random() * 0.02
      });
    }

    // 2. Micro-splash particles
    const splashCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < splashCount; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * 1.5;
      const speed = 1.8 + Math.random() * 3.6;
      rainSplashes.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 0.6 + Math.random() * 0.8,
        alpha: 0.65,
        decay: 0.045 + Math.random() * 0.035
      });
    }
  }

  // --- 4-Tier 4K Snowflake Generator ---
  function createSnowflake(randomY = true) {
    const isMobile = width < 768;
    const r = Math.random();

    let layer, radius, speed, opacity, spriteIdx;

    if (r < 0.42) {
      // Tier 0: Deep Background Snow Dust
      layer = 0;
      radius = 0.8 + Math.random() * 1.0;
      speed = 0.35 + Math.random() * 0.45;
      opacity = 0.25 + Math.random() * 0.25;
      spriteIdx = 0;
    } else if (r < 0.76) {
      // Tier 1: Crisp Midground Floating Flakes
      layer = 1;
      radius = 1.8 + Math.random() * 1.6;
      speed = 0.75 + Math.random() * 0.75;
      opacity = 0.55 + Math.random() * 0.3;
      spriteIdx = 1;
    } else if (r < 0.92) {
      // Tier 2: Foreground Luminous Flakes
      layer = 2;
      radius = 3.8 + Math.random() * 3.2;
      speed = 1.5 + Math.random() * 1.0;
      opacity = 0.75 + Math.random() * 0.22;
      spriteIdx = 2;
    } else {
      // Tier 3: Cinematic Camera Bokeh Orb
      layer = 3;
      radius = (isMobile ? 8 : 12) + Math.random() * (isMobile ? 8 : 14);
      speed = 2.2 + Math.random() * 1.6;
      opacity = 0.1 + Math.random() * 0.14;
      spriteIdx = 3;
    }

    return {
      x: Math.random() * (width + 120) - 60,
      y: randomY ? Math.random() * height : -radius * 2.5 - Math.random() * 40,
      radius,
      speed,
      opacity,
      layer,
      spriteIdx,
      swayOffset: Math.random() * Math.PI * 2,
      swaySpeed1: 0.0014 + Math.random() * 0.0016,
      swaySpeed2: 0.0008 + Math.random() * 0.0012,
      swayAmp: 0.8 + Math.random() * 1.8,
      windDrift: 0.18 + Math.random() * 0.25,
      twinkleOffset: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.002 + Math.random() * 0.003
    };
  }

  // --- Initialize particles ---
  function initParticles() {
    rainDrops = [];
    rainSplashes = [];
    rainRipples = [];
    snowflakes = [];
    lightningTimer = 350 + Math.random() * 500;
    lightningAlpha = 0;
    lightningStep = 0;

    const isMobile = width < 768;

    if (currentMode === 'rain') {
      const dropCount = isMobile ? 85 : 190;
      for (let i = 0; i < dropCount; i++) {
        rainDrops.push(createRainDrop(true));
      }
    } else if (currentMode === 'snow') {
      const flakeCount = isMobile ? 75 : 180;
      for (let i = 0; i < flakeCount; i++) {
        snowflakes.push(createSnowflake(true));
      }
    }
  }

  // --- Resize canvas to viewport ---
  function resizeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- Update & render Hyper-Realistic Rain ---
  function renderRain(timestamp, dt, intensityFactor) {
    ctx.clearRect(0, 0, width, height);

    // 1. Cinematic Thunderstorm Double-Lightning
    if (lightningAlpha > 0) {
      ctx.fillStyle = `rgba(220, 235, 255, ${lightningAlpha})`;
      ctx.fillRect(0, 0, width, height);
      lightningAlpha = Math.max(0, lightningAlpha - dt * 0.007);
    } else {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        if (lightningStep === 0) {
          // Primary flash
          lightningAlpha = 0.06 + Math.random() * 0.06;
          lightningStep = 1;
          lightningTimer = 60 + Math.random() * 40; // quick gap
        } else if (lightningStep === 1) {
          // Secondary echo flash
          lightningAlpha = 0.03 + Math.random() * 0.04;
          lightningStep = 0;
          lightningTimer = 1200 + Math.random() * 1800; // Next thunder
        }
      }
    }

    // Dynamic wind angle with gentle undulating oscillation
    const windAngle = 0.13 + Math.sin(timestamp * 0.0006) * 0.035;
    const sinA = Math.sin(windAngle);
    const cosA = Math.cos(windAngle);

    ctx.lineCap = 'round';

    const speedMultiplier = (isPlayingMusic ? 1.05 : 0.85) * intensityFactor;
    const frameFactor = dt / 16.67;

    // 2. Draw Rain Drops with Tapered Head/Tail Gradients
    for (let i = 0; i < rainDrops.length; i++) {
      const drop = rainDrops[i];
      const step = drop.speed * speedMultiplier * frameFactor;

      drop.x += sinA * step;
      drop.y += cosA * step;

      const tailX = drop.x - sinA * drop.length;
      const tailY = drop.y - cosA * drop.length;

      // Draw tapered rain streak (bright at leading head, transparent at trailing tail)
      const grad = ctx.createLinearGradient(tailX, tailY, drop.x, drop.y);
      grad.addColorStop(0, 'rgba(180, 215, 255, 0)');
      grad.addColorStop(0.65, `rgba(200, 230, 255, ${drop.opacity * 0.65})`);
      grad.addColorStop(1, `rgba(240, 250, 255, ${drop.opacity})`);

      ctx.strokeStyle = grad;
      ctx.lineWidth = drop.thickness;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(drop.x, drop.y);
      ctx.stroke();

      // Check ground collision
      if (drop.y > height - 8) {
        if (drop.layer >= 1 && Math.random() < 0.42) {
          createRainImpact(drop.x, height - 2 - Math.random() * 6);
        }
        rainDrops[i] = createRainDrop(false);
      } else if (drop.x > width + 70) {
        rainDrops[i] = createRainDrop(false);
      }
    }

    // 3. Render Ground Ripples
    for (let r = rainRipples.length - 1; r >= 0; r--) {
      const rp = rainRipples[r];
      rp.radius += rp.growth * frameFactor;
      rp.alpha -= rp.decay * frameFactor;

      if (rp.alpha <= 0 || rp.radius >= rp.maxRadius) {
        rainRipples.splice(r, 1);
        continue;
      }

      ctx.strokeStyle = `rgba(195, 225, 255, ${rp.alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.radius, rp.radius * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Render Splashes
    for (let s = rainSplashes.length - 1; s >= 0; s--) {
      const sp = rainSplashes[s];
      sp.x += sp.vx * frameFactor;
      sp.y += sp.vy * frameFactor;
      sp.vy += 0.22 * frameFactor; // gravity
      sp.alpha -= sp.decay * frameFactor;

      if (sp.alpha <= 0 || sp.y > height) {
        rainSplashes.splice(s, 1);
        continue;
      }

      ctx.fillStyle = `rgba(205, 230, 255, ${sp.alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Update & render 4K Snow Overlay with Depth & Bokeh ---
  function renderSnow(timestamp, dt, intensityFactor) {
    ctx.clearRect(0, 0, width, height);

    const speedMultiplier = (isPlayingMusic ? 1.12 : 0.85) * intensityFactor;
    const timeSec = timestamp * 0.001;
    const frameFactor = dt / 16.67;

    for (let i = 0; i < snowflakes.length; i++) {
      const flake = snowflakes[i];
      const step = flake.speed * speedMultiplier * frameFactor;

      // Downward floating movement
      flake.y += step;

      // Dual harmonic sinusoidal swaying + gentle natural wind drift
      const sway1 = Math.sin(flake.swayOffset + timestamp * flake.swaySpeed1) * flake.swayAmp;
      const sway2 = Math.cos(flake.swayOffset * 1.4 + timestamp * flake.swaySpeed2) * (flake.swayAmp * 0.45);
      flake.x += (flake.windDrift + (sway1 + sway2)) * frameFactor;

      // Soft twinkle pulse
      const twinkle = 0.88 + 0.12 * Math.sin(flake.twinkleOffset + timeSec * 2);
      const alpha = Math.min(1, Math.max(0, flake.opacity * twinkle));

      // Draw cached GPU offscreen sprite
      const sprite = snowSprites[flake.spriteIdx];
      if (sprite) {
        const drawSize = flake.radius * 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sprite,
          flake.x - flake.radius,
          flake.y - flake.radius,
          drawSize,
          drawSize
        );
      }

      // Check viewport boundaries
      if (flake.y > height + flake.radius * 2.5) {
        snowflakes[i] = createSnowflake(false);
      } else if (flake.x < -60) {
        flake.x = width + 50;
      } else if (flake.x > width + 60) {
        flake.x = -50;
      }
    }

    ctx.globalAlpha = 1.0;
  }

  // --- Main Animation Loop with Time Normalization ---
  function animationLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = Math.min(timestamp - lastTimestamp, 33.3); // Cap max frame delta to ~30fps floor
    lastTimestamp = timestamp;

    if (!isTabActive || prefersReducedMotion) {
      animationFrameId = requestAnimationFrame(animationLoop);
      return;
    }

    const intensityFactor = isPlayingMusic ? 1.0 : 0.82;

    if (currentMode === 'rain') {
      renderRain(timestamp, dt, intensityFactor);
    } else if (currentMode === 'snow') {
      renderSnow(timestamp, dt, intensityFactor);
    } else {
      ctx?.clearRect(0, 0, width, height);
      return;
    }

    animationFrameId = requestAnimationFrame(animationLoop);
  }

  // --- Start / Stop Loop ---
  function startLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    lastTimestamp = 0;
    initParticles();
    if (currentMode !== 'off' && !prefersReducedMotion) {
      animationFrameId = requestAnimationFrame(animationLoop);
    } else if (ctx) {
      ctx.clearRect(0, 0, width, height);
    }
  }

  function stopLoop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
    }
  }

  // --- Update Ambient Overlay ---
  function updateAmbientOverlay() {
    if (!ambientOverlay) return;
    ambientOverlay.classList.remove('ambient-rain', 'ambient-snow', 'is-active');

    if (currentMode === 'rain') {
      ambientOverlay.classList.add('ambient-rain', 'is-active');
    } else if (currentMode === 'snow') {
      ambientOverlay.classList.add('ambient-snow', 'is-active');
    }
  }

  // --- Public API ---
  return {
    init: function () {
      canvas = document.getElementById('weather-canvas');
      ambientOverlay = document.getElementById('weather-ambient-overlay');

      initSnowSprites();

      if (canvas) {
        ctx = canvas.getContext('2d', { alpha: true });
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas, { passive: true });
      }

      // Check motion preference
      try {
        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        prefersReducedMotion = motionQuery.matches;
        motionQuery.addEventListener('change', (e) => {
          prefersReducedMotion = e.matches;
          if (prefersReducedMotion) stopLoop();
          else if (currentMode !== 'off') startLoop();
        });
      } catch (e) {}

      // Handle tab visibility pause/resume
      document.addEventListener('visibilitychange', () => {
        isTabActive = !document.hidden;
        if (isTabActive && currentMode !== 'off') {
          lastTimestamp = performance.now();
        }
      });

      // Restore persisted mode from localStorage
      let savedMode = 'off';
      try {
        savedMode = localStorage.getItem(STORAGE_KEY) || 'off';
        if (!VALID_MODES.includes(savedMode)) savedMode = 'off';
      } catch (e) {}

      this.setMode(savedMode, false);
    },

    setMode: function (mode, persist = true) {
      if (!VALID_MODES.includes(mode)) mode = 'off';
      currentMode = mode;

      if (persist) {
        try {
          localStorage.setItem(STORAGE_KEY, mode);
        } catch (e) {}
      }

      updateAmbientOverlay();

      if (mode === 'off') {
        stopLoop();
      } else {
        startLoop();
      }

      // Dispatch custom event for UI updates
      window.dispatchEvent(new CustomEvent('odiverse:weather-mode-change', {
        detail: { mode }
      }));
    },

    getMode: function () {
      return currentMode;
    },

    setMusicPlaying: function (isPlaying) {
      isPlayingMusic = Boolean(isPlaying);
    },

    destroy: function () {
      stopLoop();
      window.removeEventListener('resize', resizeCanvas);
    }
  };
});
