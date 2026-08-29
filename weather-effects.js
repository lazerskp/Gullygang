/**
 * GULLYGANG — Atmospheric Weather Effects Engine
 * Selectable simulations:
 *  - 🌧️ Realistic Rain (multi-depth layers, wind angle, surface splashes & ripples, rain mist)
 *  - ⛈️ Heavy Rain (dense downpour, high velocity, mist overlay)
 *  - ⚡ Thunderstorm (fast 1–3s initial strike, dark storm clouds, wind turbulence, multi-stage lightning & distant branching bolts)
 *  - ❄️ Realistic Snow (multi-layered crystalline sprites, 3D rotation, aerodynamic sway)
 *  - 🌨️ Blizzard (dense flakes, lateral wind gusts, cold haze)
 *  - 💨 Shared Dynamic Wind Vector (smooth continuous wind oscillations across all modes)
 *  - ⭕ Off (immediate canvas clearing & loop cancellation)
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
  const VALID_MODES = ['off', 'rain', 'heavy_rain', 'snow', 'blizzard', 'storm'];

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
  let stormClouds = [];

  // Multi-stage Lightning State
  let lightningState = {
    timer: 1500, // First strike in 1.2–2.7s
    stage: 0,    // 0: idle, 1: pre-glow, 2: main flash, 3: return flicker, 4: fading
    stageTimer: 0,
    alpha: 0,
    bolt: null,
    boltLife: 0,
    cloudIllumination: 0
  };

  // Shared dynamic wind vector
  let sharedWind = 0;

  // Pre-rendered offscreen sprite cache for realistic crystalline snow
  let snowSprites = [];

  // --- Initialize Realistic Snow Crystal Sprites ---
  function initSnowSprites() {
    snowSprites = [];
    if (typeof document === 'undefined') return;

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

    // Sprite 0: Micro atmospheric dust motes
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

    // Sprite 1: Background soft circular flake
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

    // Sprite 2: Midground 6-pointed crystalline star
    snowSprites[2] = makeSprite(20, (c, cx, cy) => {
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 16);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.35, 'rgba(240, 248, 255, 0.6)');
      grad.addColorStop(0.75, 'rgba(220, 240, 255, 0.2)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 16, 0, Math.PI * 2);
      c.fill();

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
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(cx, cy, 2.2, 0, Math.PI * 2);
      c.fill();
    });

    // Sprite 3: Foreground dendritic crystal
    snowSprites[3] = makeSprite(36, (c, cx, cy) => {
      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      grad.addColorStop(0.3, 'rgba(240, 250, 255, 0.6)');
      grad.addColorStop(0.7, 'rgba(210, 235, 255, 0.18)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 32, 0, Math.PI * 2);
      c.fill();

      c.strokeStyle = 'rgba(255, 255, 255, 0.98)';
      c.lineWidth = 1.8;
      c.lineCap = 'round';
      const armLen = 28;

      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + cos * armLen, cy + sin * armLen);
        c.stroke();

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

    // Sprite 4: Lens Bokeh orb
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

  // --- Rain Impact Ripples & Splashes ---
  function createRainImpact(x, y) {
    if (rainRipples.length < 24 && Math.random() < 0.45) {
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

    if (rainSplashes.length < 30) {
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

  function resetRainDrop(drop, randomY = false, mode = 'rain') {
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const isHeavy = mode === 'heavy_rain' || mode === 'storm';
    const r = Math.random();
    let layer, speed, length, thickness, opacity;

    if (r < 0.45) {
      // Layer 0: Background fine drizzle
      layer = 0;
      speed = (isHeavy ? 26 : 18) + Math.random() * 14;
      length = (isHeavy ? 24 : 16) + Math.random() * 18;
      thickness = 0.9;
      opacity = (isHeavy ? 0.32 : 0.22) + Math.random() * 0.18;
    } else if (r < 0.82) {
      // Layer 1: Midground raindrops
      layer = 1;
      speed = (isHeavy ? 38 : 28) + Math.random() * 18;
      length = (isHeavy ? 42 : 28) + Math.random() * 24;
      thickness = isHeavy ? 1.5 : 1.3;
      opacity = (isHeavy ? 0.65 : 0.52) + Math.random() * 0.24;
    } else {
      // Layer 2: Foreground prominent rain streaks
      layer = 2;
      speed = (isHeavy ? 54 : (isMobile ? 36 : 44)) + Math.random() * 22;
      length = (isHeavy ? 72 : (isMobile ? 42 : 56)) + Math.random() * 36;
      thickness = isHeavy ? 2.2 : 1.8;
      opacity = 0.80 + Math.random() * 0.20;
    }

    drop.x = Math.random() * (width + 240) - 120;
    drop.y = randomY ? Math.random() * height : -length - Math.random() * 60;
    drop.speed = speed;
    drop.length = length;
    drop.thickness = thickness;
    drop.opacity = opacity;
    drop.layer = layer;
    return drop;
  }

  function createRainDrop(randomY = true, mode = 'rain') {
    const drop = {};
    return resetRainDrop(drop, randomY, mode);
  }

  function resetSnowflake(flake, randomY = true, mode = 'snow') {
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const isBlizzard = mode === 'blizzard';
    const r = Math.random();
    let layer, radius, speed, opacity, spriteIdx, rotatable;

    if (r < 0.35) {
      layer = 0;
      radius = 0.8 + Math.random() * 1.0;
      speed = (isBlizzard ? 0.7 : 0.28) + Math.random() * 0.45;
      opacity = (isBlizzard ? 0.35 : 0.20) + Math.random() * 0.25;
      spriteIdx = 0;
      rotatable = false;
    } else if (r < 0.68) {
      layer = 1;
      radius = 1.6 + Math.random() * 1.6;
      speed = (isBlizzard ? 1.4 : 0.55) + Math.random() * 0.75;
      opacity = (isBlizzard ? 0.60 : 0.45) + Math.random() * 0.30;
      spriteIdx = 1;
      rotatable = false;
    } else if (r < 0.88) {
      layer = 2;
      radius = 3.2 + Math.random() * 2.8;
      speed = (isBlizzard ? 2.2 : 0.95) + Math.random() * 1.1;
      opacity = 0.70 + Math.random() * 0.25;
      spriteIdx = 2;
      rotatable = true;
    } else if (r < 0.96) {
      layer = 3;
      radius = 5.8 + Math.random() * 4.2;
      speed = (isBlizzard ? 3.4 : 1.6) + Math.random() * 1.4;
      opacity = 0.82 + Math.random() * 0.18;
      spriteIdx = 3;
      rotatable = true;
    } else {
      layer = 4;
      radius = (isMobile ? 12 : 18) + Math.random() * (isMobile ? 10 : 18);
      speed = (isBlizzard ? 4.0 : 2.0) + Math.random() * 1.6;
      opacity = (isBlizzard ? 0.12 : 0.06) + Math.random() * 0.08;
      spriteIdx = 4;
      rotatable = false;
    }

    flake.x = Math.random() * (width + 240) - 120;
    flake.y = randomY ? Math.random() * height : -radius * 3 - Math.random() * 60;
    flake.radius = radius;
    flake.speed = speed;
    flake.opacity = opacity;
    flake.layer = layer;
    flake.spriteIdx = spriteIdx;
    flake.rotatable = rotatable;
    flake.rot = Math.random() * Math.PI * 2;
    flake.rotSpeed = (Math.random() - 0.5) * (0.015 + Math.random() * (isBlizzard ? 0.05 : 0.025));
    flake.swayOffset1 = Math.random() * Math.PI * 2;
    flake.swayOffset2 = Math.random() * Math.PI * 2;
    flake.swayOffset3 = Math.random() * Math.PI * 2;
    flake.swaySpeed1 = 0.0012 + Math.random() * 0.0018;
    flake.swaySpeed2 = 0.0007 + Math.random() * 0.0011;
    flake.swaySpeed3 = 0.0022 + Math.random() * 0.0015;
    flake.swayAmp = (isBlizzard ? 1.4 : 0.6) + Math.random() * 1.6;
    flake.windDrift = (isBlizzard ? 1.8 : 0.12) + Math.random() * (isBlizzard ? 1.4 : 0.22);
    flake.twinkleOffset = Math.random() * Math.PI * 2;
    flake.twinkleSpeed = 0.0018 + Math.random() * 0.0028;
    return flake;
  }

  function createSnowflake(randomY = true, mode = 'snow') {
    const flake = {};
    return resetSnowflake(flake, randomY, mode);
  }

  // --- Dark Storm Atmospheric Clouds ---
  function initStormClouds() {
    stormClouds = [];
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const count = isMobile ? 5 : 9;

    for (let i = 0; i < count; i++) {
      stormClouds.push({
        baseX: (i / count) + (Math.random() - 0.5) * 0.2,
        baseY: 0.05 + Math.random() * 0.45,
        radiusRatio: 0.45 + Math.random() * 0.35,
        speedX: 0.00012 + (i % 3) * 0.00006,
        phaseX: Math.random() * 6.28,
        phaseY: Math.random() * 6.28,
        baseAlpha: 0.32 + Math.random() * 0.22
      });
    }
  }

  // --- Procedural Branching Distant Lightning Bolt Generator ---
  function generateLightningBolt() {
    const isLeft = Math.random() < 0.5;
    const startX = isLeft
      ? width * (0.08 + Math.random() * 0.26)
      : width * (0.66 + Math.random() * 0.26);
    const startY = 0;
    const endX = startX + (Math.random() - 0.5) * (width * 0.22);
    const endY = height * (0.28 + Math.random() * 0.32);

    const segments = [];

    function buildBranch(x1, y1, x2, y2, depth, maxDepth) {
      if (depth >= maxDepth) {
        segments.push({ x1, y1, x2, y2, depth });
        return;
      }

      const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * (width * 0.04);
      const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * (height * 0.02);

      buildBranch(x1, y1, midX, midY, depth + 1, maxDepth);
      buildBranch(midX, midY, x2, y2, depth + 1, maxDepth);

      if (depth === 2 && Math.random() < 0.65) {
        const forkEndX = midX + (Math.random() - 0.5) * (width * 0.10);
        const forkEndY = midY + height * (0.08 + Math.random() * 0.12);
        buildBranch(midX, midY, forkEndX, forkEndY, depth + 1, maxDepth);
      }
    }

    buildBranch(startX, startY, endX, endY, 0, 4);
    return segments;
  }

  // --- Initialize particles per mode ---
  function initParticles() {
    rainDrops = [];
    rainSplashes = [];
    rainRipples = [];
    snowflakes = [];
    stormClouds = [];

    // Responsive initial strike: first lightning occurs within 1.2 to 2.7 seconds
    lightningState = {
      timer: 1200 + Math.random() * 1500,
      stage: 0,
      stageTimer: 0,
      alpha: 0,
      bolt: null,
      boltLife: 0,
      cloudIllumination: 0
    };

    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

    if (currentMode === 'rain') {
      const count = isMobile ? 36 : 110;
      for (let i = 0; i < count; i++) rainDrops.push(createRainDrop(true, 'rain'));
    } else if (currentMode === 'heavy_rain') {
      const count = isMobile ? 75 : 220;
      for (let i = 0; i < count; i++) rainDrops.push(createRainDrop(true, 'heavy_rain'));
    } else if (currentMode === 'storm') {
      const count = isMobile ? 85 : 240;
      for (let i = 0; i < count; i++) rainDrops.push(createRainDrop(true, 'storm'));
      initStormClouds();
    } else if (currentMode === 'snow') {
      const count = isMobile ? 38 : 105;
      for (let i = 0; i < count; i++) snowflakes.push(createSnowflake(true, 'snow'));
    } else if (currentMode === 'blizzard') {
      const count = isMobile ? 70 : 190;
      for (let i = 0; i < count; i++) snowflakes.push(createSnowflake(true, 'blizzard'));
    }
  }

  // --- Resize canvas to viewport (Full Hero Coverage on Mobile & Desktop) ---
  function resizeCanvas() {
    if (!canvas) return;
    const isMobile = (typeof window !== 'undefined') && (window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1));
    dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, isMobile ? 1.0 : 1.5);

    // Guaranteed full viewport coverage across all device screens & orientation changes
    width = Math.max(window.innerWidth, document.documentElement.clientWidth || 0);
    height = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- Update Multi-Stage Thunderstorm Lightning Events ---
  function updateLightning(dt) {
    const ls = lightningState;

    if (ls.stage === 0) {
      ls.timer -= dt;
      if (ls.timer <= 0) {
        // Stage 1: Subtle pre-glow (30–60ms)
        ls.stage = 1;
        ls.stageTimer = 35 + Math.random() * 30;
        ls.alpha = 0.09 + Math.random() * 0.05;
        ls.cloudIllumination = 0.45;
      }
    } else if (ls.stage === 1) {
      ls.stageTimer -= dt;
      if (ls.stageTimer <= 0) {
        // Stage 2: Main bright lightning flash & branching bolt (60–110ms)
        ls.stage = 2;
        ls.stageTimer = 65 + Math.random() * 45;
        ls.alpha = 0.34 + Math.random() * 0.22;
        ls.cloudIllumination = 0.95;
        ls.bolt = (Math.random() < 0.75) ? generateLightningBolt() : null;
        ls.boltLife = ls.stageTimer;
      }
    } else if (ls.stage === 2) {
      ls.stageTimer -= dt;
      if (ls.stageTimer <= 0) {
        // Stage 3: Occasional rapid secondary pulse / return stroke (35–55ms)
        if (Math.random() < 0.65) {
          ls.stage = 3;
          ls.stageTimer = 35 + Math.random() * 25;
          ls.alpha = 0.16 + Math.random() * 0.08;
          ls.cloudIllumination = 0.6;
        } else {
          ls.stage = 4;
          ls.stageTimer = 160;
        }
        ls.bolt = null;
      }
    } else if (ls.stage === 3) {
      ls.stageTimer -= dt;
      if (ls.stageTimer <= 0) {
        ls.stage = 4;
        ls.stageTimer = 160;
      }
    } else if (ls.stage === 4) {
      // Stage 4: Rapid smooth decay back to dark storm atmosphere
      ls.alpha = Math.max(0, ls.alpha - dt * 0.004);
      ls.cloudIllumination = Math.max(0, ls.cloudIllumination - dt * 0.005);
      ls.stageTimer -= dt;
      if (ls.stageTimer <= 0 && ls.alpha <= 0.01) {
        ls.stage = 0;
        ls.alpha = 0;
        ls.cloudIllumination = 0;
        ls.bolt = null;

        // Natural strike frequency: 4–8 seconds, with occasional 8–12 second pause
        const useLongerGap = Math.random() < 0.25;
        ls.timer = useLongerGap
          ? (8000 + Math.random() * 4000)
          : (4000 + Math.random() * 4000);
      }
    }
  }

  // --- Render Rain, Heavy Rain & Thunderstorm ---
  function renderRainSystem(timestamp, dt, intensityFactor, mode) {
    ctx.clearRect(0, 0, width, height);

    const isStorm = mode === 'storm';
    const isHeavy = mode === 'heavy_rain' || isStorm;
    const minDim = Math.min(width, height);

    // 1. STORM DARK ATMOSPHERE & DRIFTING STORM CLOUDS
    if (isStorm) {
      updateLightning(dt);

      // Dark storm ambient sky underlay
      ctx.fillStyle = 'rgba(4, 7, 14, 0.48)';
      ctx.fillRect(0, 0, width, height);

      // Drifting dark storm clouds
      for (let i = 0; i < stormClouds.length; i++) {
        const cloud = stormClouds[i];
        const cx = (cloud.baseX + Math.sin(timestamp * cloud.speedX + cloud.phaseX) * 0.15) * width;
        const cy = (cloud.baseY + Math.cos(timestamp * 0.00008 + cloud.phaseY) * 0.06) * height;
        const cr = minDim * cloud.radiusRatio;

        const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        const ill = lightningState.cloudIllumination;
        const rC = Math.round(18 + ill * 160);
        const gC = Math.round(24 + ill * 180);
        const bC = Math.round(38 + ill * 220);
        const aC = Math.min(0.85, cloud.baseAlpha + ill * 0.25);

        cGrad.addColorStop(0, `rgba(${rC}, ${gC}, ${bC}, ${aC.toFixed(3)})`);
        cGrad.addColorStop(0.5, `rgba(${rC}, ${gC}, ${bC}, ${(aC * 0.5).toFixed(3)})`);
        cGrad.addColorStop(1, `rgba(${rC}, ${gC}, ${bC}, 0)`);

        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Distant Branching Lightning Bolt
      if (lightningState.bolt && lightningState.bolt.length > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(235, 248, 255, ${Math.min(1, lightningState.alpha * 2.2).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = 'rgba(180, 225, 255, 0.9)';
        ctx.shadowBlur = 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        for (let b = 0; b < lightningState.bolt.length; b++) {
          const seg = lightningState.bolt[b];
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Ambient Lightning Sheet Illumination
      if (lightningState.alpha > 0) {
        ctx.fillStyle = `rgba(215, 235, 255, ${lightningState.alpha.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
    }

    // 2. SHARED DYNAMIC WIND & ANGLE
    const baseWind = isStorm ? 0.38 : (isHeavy ? 0.24 : 0.12);
    sharedWind = baseWind + Math.sin(timestamp * 0.00035) * (isStorm ? 0.16 : 0.04);
    const sinA = Math.sin(sharedWind);
    const cosA = Math.cos(sharedWind);

    ctx.lineCap = 'round';
    const speedMultiplier = (isPlayingMusic ? 1.05 : 0.85) * intensityFactor;
    const frameFactor = dt / 16.67;

    // 3. BATCHED RAIN STREAKS
    ctx.beginPath();
    ctx.strokeStyle = isHeavy ? 'rgba(210, 235, 255, 0.65)' : 'rgba(215, 238, 255, 0.55)';
    ctx.lineWidth = isHeavy ? 1.4 : 1.2;

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
        if (drop.layer >= 1 && Math.random() < (isHeavy ? 0.55 : 0.35)) {
          createRainImpact(drop.x, height - 2 - Math.random() * 6);
        }
        resetRainDrop(drop, false, mode);
      } else if (drop.x > width + 120) {
        resetRainDrop(drop, false, mode);
      }
    }
    ctx.stroke();

    // 4. RAIN MIST LAYER
    if (isHeavy) {
      const mistGrad = ctx.createLinearGradient(0, height * 0.5, 0, height);
      mistGrad.addColorStop(0, 'rgba(180, 215, 245, 0)');
      mistGrad.addColorStop(1, 'rgba(180, 215, 245, 0.045)');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, height * 0.5, width, height * 0.5);
    }

    // 5. GROUND RIPPLES
    for (let r = rainRipples.length - 1; r >= 0; r--) {
      const rp = rainRipples[r];
      rp.radius += rp.growth * frameFactor;
      rp.alpha -= rp.decay * frameFactor;

      if (rp.alpha <= 0 || rp.radius >= rp.maxRadius) {
        rainRipples.splice(r, 1);
        continue;
      }

      ctx.strokeStyle = `rgba(195, 225, 255, ${rp.alpha.toFixed(3)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.radius, rp.radius * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 6. SPLASHES
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

      ctx.fillStyle = `rgba(235, 248, 255, ${sp.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Render Snow & Blizzard ---
  function renderSnowSystem(timestamp, dt, intensityFactor, mode) {
    ctx.clearRect(0, 0, width, height);

    const isBlizzard = mode === 'blizzard';
    const speedMultiplier = (isPlayingMusic ? 1.0 : 0.82) * intensityFactor;
    const frameFactor = dt / 16.67;

    sharedWind = (isBlizzard ? 1.4 : 0.22) + Math.sin(timestamp * 0.00035) * (isBlizzard ? 0.65 : 0.25);

    for (let i = 0; i < snowflakes.length; i++) {
      const flake = snowflakes[i];

      const s1 = Math.sin(timestamp * flake.swaySpeed1 + flake.swayOffset1);
      const s2 = Math.cos(timestamp * flake.swaySpeed2 + flake.swayOffset2);
      const s3 = Math.sin(timestamp * flake.swaySpeed3 + flake.swayOffset3);
      const sway = (s1 * 0.55 + s2 * 0.32 + s3 * 0.13) * flake.swayAmp;

      flake.x += (sway + flake.windDrift + sharedWind) * frameFactor;
      flake.y += flake.speed * speedMultiplier * frameFactor;

      if (flake.rotatable) {
        flake.rot += flake.rotSpeed * frameFactor;
      }

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

      if (flake.y > height + flake.radius * 3) {
        resetSnowflake(flake, false, mode);
      } else if (flake.x < -100) {
        flake.x = width + 80;
      } else if (flake.x > width + 100) {
        flake.x = -80;
      }
    }
    ctx.globalAlpha = 1.0;
  }

  // --- Main Animation Loop with Frame Budgeting (30 FPS mobile, 60 FPS desktop) ---
  function animationLoop(timestamp) {
    if (!isTabActive || prefersReducedMotion || currentMode === 'off') {
      stopLoop();
      return;
    }

    if (!lastTimestamp) lastTimestamp = timestamp;
    const isMobile = width < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const minDelta = isMobile ? 32 : 14;

    if (timestamp - lastTimestamp < minDelta) {
      animationFrameId = requestAnimationFrame(animationLoop);
      return;
    }

    const dt = Math.min(timestamp - lastTimestamp, 40);
    lastTimestamp = timestamp;

    const intensityFactor = isPlayingMusic ? 1.0 : 0.85;

    if (currentMode === 'rain' || currentMode === 'heavy_rain' || currentMode === 'storm') {
      renderRainSystem(timestamp, dt, intensityFactor, currentMode);
    } else if (currentMode === 'snow' || currentMode === 'blizzard') {
      renderSnowSystem(timestamp, dt, intensityFactor, currentMode);
    } else {
      ctx?.clearRect(0, 0, width, height);
      return;
    }

    animationFrameId = requestAnimationFrame(animationLoop);
  }

  // --- Start / Stop Loop ---
  function startLoop() {
    if (animationFrameId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrameId);
    }
    lastTimestamp = 0;
    if (currentMode !== 'off' && !prefersReducedMotion && isTabActive) {
      initParticles();
      if (typeof requestAnimationFrame === 'function') {
        animationFrameId = requestAnimationFrame(animationLoop);
      }
    } else if (ctx) {
      ctx.clearRect(0, 0, width, height);
    }
  }

  function stopLoop() {
    if (animationFrameId && typeof cancelAnimationFrame === 'function') {
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
    ambientOverlay.classList.remove(
      'ambient-rain', 'ambient-heavy-rain', 'ambient-storm',
      'ambient-snow', 'ambient-blizzard', 'is-active'
    );

    if (currentMode === 'rain') {
      ambientOverlay.classList.add('ambient-rain', 'is-active');
    } else if (currentMode === 'heavy_rain') {
      ambientOverlay.classList.add('ambient-heavy-rain', 'is-active');
    } else if (currentMode === 'storm') {
      ambientOverlay.classList.add('ambient-storm', 'is-active');
    } else if (currentMode === 'snow') {
      ambientOverlay.classList.add('ambient-snow', 'is-active');
    } else if (currentMode === 'blizzard') {
      ambientOverlay.classList.add('ambient-blizzard', 'is-active');
    }
  }

  // --- Public API ---
  return {
    init: function () {
      if (typeof document === 'undefined') return;
      canvas = document.getElementById('weather-canvas');
      ambientOverlay = document.getElementById('weather-ambient-overlay');

      if (canvas) {
        ctx = canvas.getContext('2d', { alpha: true });
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas, { passive: true });
        window.addEventListener('orientationchange', resizeCanvas, { passive: true });
      }

      try {
        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        prefersReducedMotion = motionQuery.matches;
        motionQuery.addEventListener('change', (e) => {
          prefersReducedMotion = e.matches;
          if (prefersReducedMotion) stopLoop();
          else if (currentMode !== 'off') startLoop();
        });
      } catch (e) {}

      document.addEventListener('visibilitychange', () => {
        isTabActive = !document.hidden;
        if (isTabActive) {
          if (currentMode !== 'off') startLoop();
        } else {
          stopLoop();
        }
      });

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

      if ((mode === 'snow' || mode === 'blizzard') && snowSprites.length === 0) {
        initSnowSprites();
      }

      if (persist && typeof localStorage !== 'undefined') {
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

      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('odiverse:weather-mode-change', {
          detail: { mode }
        }));
      }
    },

    getMode: function () {
      return currentMode;
    },

    setMusicPlaying: function (isPlaying) {
      isPlayingMusic = Boolean(isPlaying);
    },

    destroy: function () {
      stopLoop();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resizeCanvas);
        window.removeEventListener('orientationchange', resizeCanvas);
      }
    }
  };
});
