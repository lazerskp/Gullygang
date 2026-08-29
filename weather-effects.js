/**
 * GULLYGANG — Atmospheric Weather Effects Engine
 * Hyper-realistic 4K Cinematic Rain & Snow simulation with motion-blur gradients,
 * multi-layered crystalline snowflake physics, 3D tumbling rotation, aerodynamic harmonic sway,
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

  // Particle pools (pre-allocated to avoid GC churn)
  let rainDrops = [];
  let rainSplashes = [];
  let rainRipples = [];
  let snowflakes = [];

  // Lightning state
  let lightningTimer = 0;
  let lightningAlpha = 0;
  let lightningStep = 0;

  // Pre-rendered offscreen sprite cache for 60fps realistic snow rendering
  let snowSprites = [];

  // --- Initialize Realistic Snow Crystal Sprites ---
  function initSnowSprites() {
    snowSprites = [];

    function makeSprite(size, drawFn) {
      const offCanvas = document.createElement('canvas');
      const s = Math.ceil(size * 2);
      offCanvas.width = s;
      offCanvas.height = s;
      const offCtx = offCanvas.getContext('2d');
      offCtx.imageSmoothingEnabled = true;
      drawFn(offCtx, size, size);
      return offCanvas;
    }

    // Sprite 0: Micro atmospheric dust motes (ultra-distant background)
    snowSprites[0] = makeSprite(6, (c, cx, cy) => {
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 5);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.5, 'rgba(235, 245, 255, 0.7)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 5, 0, Math.PI * 2);
      c.fill();
    });

    // Sprite 1: Background soft circular flake with subtle outer aura
    snowSprites[1] = makeSprite(12, (c, cx, cy) => {
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 10);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.45, 'rgba(240, 248, 255, 0.85)');
      grad.addColorStop(0.8, 'rgba(215, 238, 255, 0.3)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 10, 0, Math.PI * 2);
      c.fill();
    });

    // Sprite 2: Midground 6-pointed crystalline star snowflake
    snowSprites[2] = makeSprite(20, (c, cx, cy) => {
      // Soft radial bloom underlay
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 16);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.35, 'rgba(240, 248, 255, 0.6)');
      grad.addColorStop(0.75, 'rgba(220, 240, 255, 0.2)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 16, 0, Math.PI * 2);
      c.fill();

      // Sharp crystalline 6-arm geometry
      c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      c.lineWidth = 1.4;
      c.lineCap = 'round';
      const armLen = 14;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + cos * armLen, cy + sin * armLen);
        c.stroke();

        // Sub-branch v-prongs
        const branchDist = armLen * 0.6;
        const bx = cx + cos * branchDist;
        const by = cy + sin * branchDist;
        const bAngle1 = angle + Math.PI / 4;
        const bAngle2 = angle - Math.PI / 4;
        const bLen = 4;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(bAngle1) * bLen, by + Math.sin(bAngle1) * bLen);
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(bAngle2) * bLen, by + Math.sin(bAngle2) * bLen);
        c.stroke();
      }
      // Center nucleus
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(cx, cy, 2.2, 0, Math.PI * 2);
      c.fill();
    });

    // Sprite 3: Foreground intricate dendritic snow crystal
    snowSprites[3] = makeSprite(36, (c, cx, cy) => {
      // Atmospheric bloom glow
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      grad.addColorStop(0.3, 'rgba(240, 250, 255, 0.6)');
      grad.addColorStop(0.7, 'rgba(210, 235, 255, 0.18)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 32, 0, Math.PI * 2);
      c.fill();

      // Intricate 6-arm crystal structure
      c.strokeStyle = 'rgba(255, 255, 255, 0.98)';
      c.lineWidth = 1.8;
      c.lineCap = 'round';
      const armLen = 28;

      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Main arm
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + cos * armLen, cy + sin * armLen);
        c.stroke();

        // 2 tiers of chevron branches
        [0.45, 0.75].forEach((ratio, idx) => {
          const bDist = armLen * ratio;
          const bx = cx + cos * bDist;
          const by = cy + sin * bDist;
          const bLen = idx === 0 ? 8 : 6;
          const bAngle1 = angle + Math.PI / 3.5;
          const bAngle2 = angle - Math.PI / 3.5;

          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx + Math.cos(bAngle1) * bLen, by + Math.sin(bAngle1) * bLen);
          c.moveTo(bx, by);
          c.lineTo(bx + Math.cos(bAngle2) * bLen, by + Math.sin(bAngle2) * bLen);
          c.stroke();
        });
      }

      // Central hexagonal crystal plate
      c.fillStyle = 'rgba(255, 255, 255, 0.95)';
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const hx = cx + Math.cos(angle) * 4;
        const hy = cy + Math.sin(angle) * 4;
        if (i === 0) c.moveTo(hx, hy);
        else c.lineTo(hx, hy);
      }
      c.closePath();
      c.fill();
    });

    // Sprite 4: Lens Bokeh orb (ultra close out-of-focus foreground)
    snowSprites[4] = makeSprite(64, (c, cx, cy) => {
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 58);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
      grad.addColorStop(0.35, 'rgba(235, 245, 255, 0.22)');
      grad.addColorStop(0.7, 'rgba(205, 230, 255, 0.09)');
      grad.addColorStop(0.92, 'rgba(180, 215, 255, 0.02)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 58, 0, Math.PI * 2);
      c.fill();
    });
  }

  // --- Rain Splash Sparks & Water Rings ---
  function createRainImpact(x, y) {
    if (rainRipples.length < 16 && Math.random() < 0.45) {
      rainRipples.push({
        x,
        y,
        radius: 1.5,
        maxRadius: 8 + Math.random() * 9,
        growth: 0.45 + Math.random() * 0.35,
        alpha: 0.55,
        decay: 0.035
      });
    }

    if (rainSplashes.length < 22) {
      const angle = Math.PI + (Math.random() - 0.5) * 1.5;
      const speed = 1.8 + Math.random() * 2.8;
      rainSplashes.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 0.6 + Math.random() * 0.6,
        alpha: 0.65,
        decay: 0.05
      });
    }
  }

  function resetRainDrop(drop, randomY = false) {
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const r = Math.random();
    let layer, speed, length, thickness, opacity;

    if (r < 0.50) {
      // Layer 0: Background fine drizzle
      layer = 0;
      speed = 18 + Math.random() * 12;
      length = 16 + Math.random() * 16;
      thickness = 0.9;
      opacity = 0.22 + Math.random() * 0.18;
    } else if (r < 0.84) {
      // Layer 1: Midground raindrops
      layer = 1;
      speed = 28 + Math.random() * 16;
      length = 28 + Math.random() * 22;
      thickness = 1.3;
      opacity = 0.52 + Math.random() * 0.24;
    } else {
      // Layer 2: Foreground prominent rain streaks
      layer = 2;
      speed = (isMobile ? 36 : 44) + Math.random() * 18;
      length = (isMobile ? 42 : 56) + Math.random() * 32;
      thickness = 1.8;
      opacity = 0.80 + Math.random() * 0.20;
    }

    drop.x = Math.random() * (width + 160) - 80;
    drop.y = randomY ? Math.random() * height : -length - Math.random() * 60;
    drop.speed = speed;
    drop.length = length;
    drop.thickness = thickness;
    drop.opacity = opacity;
    drop.layer = layer;
    return drop;
  }

  function createRainDrop(randomY = true) {
    const drop = {};
    return resetRainDrop(drop, randomY);
  }

  function resetSnowflake(flake, randomY = true) {
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const r = Math.random();
    let layer, radius, speed, opacity, spriteIdx, rotatable;

    if (r < 0.35) {
      // Layer 0: Distant micro dust motes
      layer = 0;
      radius = 0.8 + Math.random() * 1.0;
      speed = 0.28 + Math.random() * 0.35;
      opacity = 0.20 + Math.random() * 0.25;
      spriteIdx = 0;
      rotatable = false;
    } else if (r < 0.68) {
      // Layer 1: Background soft flakes
      layer = 1;
      radius = 1.6 + Math.random() * 1.6;
      speed = 0.55 + Math.random() * 0.55;
      opacity = 0.45 + Math.random() * 0.30;
      spriteIdx = 1;
      rotatable = false;
    } else if (r < 0.88) {
      // Layer 2: Midground crisp 6-point stellar crystals
      layer = 2;
      radius = 3.2 + Math.random() * 2.8;
      speed = 0.95 + Math.random() * 0.85;
      opacity = 0.70 + Math.random() * 0.25;
      spriteIdx = 2;
      rotatable = true;
    } else if (r < 0.96) {
      // Layer 3: Foreground prominent dendritic snow crystals
      layer = 3;
      radius = 5.8 + Math.random() * 4.2;
      speed = 1.6 + Math.random() * 1.1;
      opacity = 0.82 + Math.random() * 0.18;
      spriteIdx = 3;
      rotatable = true;
    } else {
      // Layer 4: Cinematic Camera Bokeh Orb
      layer = 4;
      radius = (isMobile ? 12 : 18) + Math.random() * (isMobile ? 10 : 18);
      speed = 2.0 + Math.random() * 1.4;
      opacity = 0.06 + Math.random() * 0.08;
      spriteIdx = 4;
      rotatable = false;
    }

    flake.x = Math.random() * (width + 160) - 80;
    flake.y = randomY ? Math.random() * height : -radius * 3 - Math.random() * 60;
    flake.radius = radius;
    flake.speed = speed;
    flake.opacity = opacity;
    flake.layer = layer;
    flake.spriteIdx = spriteIdx;
    flake.rotatable = rotatable;
    flake.rot = Math.random() * Math.PI * 2;
    flake.rotSpeed = (Math.random() - 0.5) * (0.015 + Math.random() * 0.025);
    flake.swayOffset1 = Math.random() * Math.PI * 2;
    flake.swayOffset2 = Math.random() * Math.PI * 2;
    flake.swayOffset3 = Math.random() * Math.PI * 2;
    flake.swaySpeed1 = 0.0012 + Math.random() * 0.0018;
    flake.swaySpeed2 = 0.0007 + Math.random() * 0.0011;
    flake.swaySpeed3 = 0.0022 + Math.random() * 0.0015;
    flake.swayAmp = 0.6 + Math.random() * 1.6;
    flake.windDrift = 0.12 + Math.random() * 0.22;
    flake.twinkleOffset = Math.random() * Math.PI * 2;
    flake.twinkleSpeed = 0.0018 + Math.random() * 0.0028;
    return flake;
  }

  function createSnowflake(randomY = true) {
    const flake = {};
    return resetSnowflake(flake, randomY);
  }

  // --- Initialize particles ---
  function initParticles() {
    rainDrops = [];
    rainSplashes = [];
    rainRipples = [];
    snowflakes = [];
    lightningTimer = 400 + Math.random() * 600;
    lightningAlpha = 0;
    lightningStep = 0;

    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

    if (currentMode === 'rain') {
      const dropCount = isMobile ? 32 : 105;
      for (let i = 0; i < dropCount; i++) {
        rainDrops.push(createRainDrop(true));
      }
    } else if (currentMode === 'snow') {
      const flakeCount = isMobile ? 36 : 95;
      for (let i = 0; i < flakeCount; i++) {
        snowflakes.push(createSnowflake(true));
      }
    }
  }

  // --- Resize canvas to viewport ---
  function resizeCanvas() {
    if (!canvas) return;
    const isMobile = window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.0 : 1.5);
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

    if (lightningAlpha > 0) {
      ctx.fillStyle = `rgba(220, 235, 255, ${lightningAlpha})`;
      ctx.fillRect(0, 0, width, height);
      lightningAlpha = Math.max(0, lightningAlpha - dt * 0.007);
    } else {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        if (lightningStep === 0) {
          lightningAlpha = 0.06 + Math.random() * 0.06;
          lightningStep = 1;
          lightningTimer = 60 + Math.random() * 40;
        } else if (lightningStep === 1) {
          lightningAlpha = 0.03 + Math.random() * 0.04;
          lightningStep = 0;
          lightningTimer = 1200 + Math.random() * 1800;
        }
      }
    }

    const windAngle = 0.12 + Math.sin(timestamp * 0.00045) * 0.032;
    const sinA = Math.sin(windAngle);
    const cosA = Math.cos(windAngle);

    ctx.lineCap = 'round';
    const speedMultiplier = (isPlayingMusic ? 1.05 : 0.85) * intensityFactor;
    const frameFactor = dt / 16.67;

    // Batched rain streaks
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(215, 238, 255, 0.55)';
    ctx.lineWidth = 1.2;

    for (let i = 0; i < rainDrops.length; i++) {
      const drop = rainDrops[i];
      const step = drop.speed * speedMultiplier * frameFactor;

      drop.x += sinA * step;
      drop.y += cosA * step;

      const tailX = drop.x - sinA * drop.length;
      const tailY = drop.y - cosA * drop.length;

      ctx.moveTo(tailX, tailY);
      ctx.lineTo(drop.x, drop.y);

      if (drop.y > height - 8) {
        if (drop.layer >= 1 && Math.random() < 0.35) {
          createRainImpact(drop.x, height - 2 - Math.random() * 6);
        }
        resetRainDrop(drop, false);
      } else if (drop.x > width + 70) {
        resetRainDrop(drop, false);
      }
    }
    ctx.stroke();

    // Render Ground Ripples
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

    // Render Splashes
    for (let s = rainSplashes.length - 1; s >= 0; s--) {
      const sp = rainSplashes[s];
      sp.x += sp.vx * frameFactor;
      sp.y += sp.vy * frameFactor;
      sp.vy += 0.22 * frameFactor;
      sp.alpha -= sp.decay * frameFactor;

      if (sp.alpha <= 0 || sp.y > height) {
        rainSplashes.splice(s, 1);
        continue;
      }

      ctx.fillStyle = `rgba(235, 248, 255, ${sp.alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Update & render Hyper-Realistic Snow ---
  function renderSnow(timestamp, dt, intensityFactor) {
    ctx.clearRect(0, 0, width, height);

    const speedMultiplier = (isPlayingMusic ? 1.0 : 0.82) * intensityFactor;
    const frameFactor = dt / 16.67;
    const globalWind = Math.sin(timestamp * 0.00035) * 0.25;

    for (let i = 0; i < snowflakes.length; i++) {
      const flake = snowflakes[i];

      // Multi-harmonic aerodynamic sway
      const s1 = Math.sin(timestamp * flake.swaySpeed1 + flake.swayOffset1);
      const s2 = Math.cos(timestamp * flake.swaySpeed2 + flake.swayOffset2);
      const s3 = Math.sin(timestamp * flake.swaySpeed3 + flake.swayOffset3);
      const sway = (s1 * 0.55 + s2 * 0.32 + s3 * 0.13) * flake.swayAmp;

      flake.x += (sway + flake.windDrift + globalWind) * frameFactor;
      flake.y += flake.speed * speedMultiplier * frameFactor;

      // Subtle rotation for midground and foreground crystalline flakes
      if (flake.rotatable) {
        flake.rot += flake.rotSpeed * frameFactor;
      }

      // Natural luminosity twinkling
      const twinkle = 0.82 + 0.18 * Math.sin(timestamp * flake.twinkleSpeed + flake.twinkleOffset);
      const alpha = Math.max(0, Math.min(1, flake.opacity * twinkle));

      const sprite = snowSprites[flake.spriteIdx];
      if (sprite) {
        ctx.globalAlpha = alpha;

        if (flake.rotatable) {
          ctx.save();
          ctx.translate(flake.x, flake.y);
          ctx.rotate(flake.rot);
          ctx.drawImage(
            sprite,
            -flake.radius,
            -flake.radius,
            flake.radius * 2,
            flake.radius * 2
          );
          ctx.restore();
        } else {
          ctx.drawImage(
            sprite,
            flake.x - flake.radius,
            flake.y - flake.radius,
            flake.radius * 2,
            flake.radius * 2
          );
        }
      }

      // Wrap / Respawn boundaries
      if (flake.y > height + flake.radius * 3) {
        resetSnowflake(flake, false);
      } else if (flake.x < -80) {
        flake.x = width + 60;
      } else if (flake.x > width + 80) {
        flake.x = -60;
      }
    }
    ctx.globalAlpha = 1.0;
  }

  // --- Main Animation Loop with Time Normalization ---
  function animationLoop(timestamp) {
    if (!isTabActive || prefersReducedMotion || currentMode === 'off') {
      stopLoop();
      return;
    }

    if (!lastTimestamp) lastTimestamp = timestamp;
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const minDelta = isMobile ? 24 : 14;

    if (timestamp - lastTimestamp < minDelta) {
      animationFrameId = requestAnimationFrame(animationLoop);
      return;
    }

    const dt = Math.min(timestamp - lastTimestamp, 40);
    lastTimestamp = timestamp;

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
    if (currentMode !== 'off' && !prefersReducedMotion && isTabActive) {
      initParticles();
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
        if (isTabActive) {
          if (currentMode !== 'off') startLoop();
        } else {
          stopLoop();
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

      if (mode === 'snow' && snowSprites.length === 0) {
        initSnowSprites();
      }

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
