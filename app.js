/**
 * GULLYGANG — Audio Engine & InsForge Live Cloud Sync
 */

(function () {
  'use strict';

  // Production-grade Environment Configuration
  const INSFORGE_CONFIG = {
    baseUrl: (typeof window !== 'undefined' && (window.__ENV__?.INSFORGE_BASE_URL || window.ENV?.INSFORGE_BASE_URL)) || 'https://i7i9c74c.ap-southeast.insforge.app',
    apiKey: (typeof window !== 'undefined' && (window.__ENV__?.INSFORGE_API_KEY || window.ENV?.INSFORGE_API_KEY)) || 'ik_3394ff1ae476e1e5bbabce8593040c1e'
  };

  const API_BASE = (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'))
    ? 'https://i7i9c74c.insforge.site'
    : '';

  // --- Production Security Utilities ---
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  const escapeHtml = escapeHTML;

  function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim().toLowerCase();
    if (clean.startsWith('javascript:') || clean.startsWith('data:text/html') || clean.startsWith('vbscript:')) {
      return false;
    }
    return true;
  }

  // --- PostHog Product Analytics Helper ---
  function trackEvent(eventName, properties = {}) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(eventName, properties);
      }
    } catch (e) {}
  }

  // Seed configuration for instant 0ms cold-start hydration (SWR)
  const DEFAULT_SEED_PLAYLIST = {
    id: '25217e19-6e46-4e64-8d34-14a697b56f63',
    name: 'GullyGang Special',
    icon: 'bolt',
    youtube_playlist_url: 'https://youtube.com/playlist?list=PLIQS0Hg0bqrV8JDs67xuNRI0C5UTfGAyt',
    bg_image: 'favicon.png'
  };

  const DEFAULT_SEED_TRACKS = [
    {
      id: 'thS3-dmUvlg',
      title: 'Ore Mora Saiyana',
      artist: 'Aseema Panda',
      thumbnail: 'https://i.ytimg.com/vi/thS3-dmUvlg/hqdefault.jpg',
      playlistId: '25217e19-6e46-4e64-8d34-14a697b56f63',
      position: 1
    },
    {
      id: '1usErKKsNGM',
      title: 'Suna Jhia',
      artist: 'Humane Sagar',
      thumbnail: 'https://i.ytimg.com/vi/1usErKKsNGM/hqdefault.jpg',
      playlistId: '25217e19-6e46-4e64-8d34-14a697b56f63',
      position: 2
    },
    {
      id: '0DS5jYQeiw0',
      title: 'Hai To Premare',
      artist: 'Kuldeep Pattanaik',
      thumbnail: 'https://i.ytimg.com/vi/0DS5jYQeiw0/hqdefault.jpg',
      playlistId: '25217e19-6e46-4e64-8d34-14a697b56f63',
      position: 3
    }
  ];

  // Global State
  const state = {
    playlists: [DEFAULT_SEED_PLAYLIST],
    currentPlaylist: DEFAULT_SEED_PLAYLIST,
    tracks: DEFAULT_SEED_TRACKS,
    currentIndex: 0,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 'all',
    volume: 1,
    isMuted: false,
    ytPlayer: null,
    isPlayerReady: false,
    pendingAction: null,
    progressTimer: null,
    isSeeking: false,
    isVolSliderOpen: false
  };

  // DOM Elements
  const DOM = {
    // Dynamic Artwork Background Layer
    dynamicArtworkBg: document.getElementById('dynamic-artwork-bg'),
    ambientCanvas: document.getElementById('ambient-canvas'),

    liveTime: document.getElementById('live-time'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnWeather: document.getElementById('btn-weather'),
    weatherDropdown: document.getElementById('weather-dropdown'),
    weatherClock: document.getElementById('weather-clock'),

    // Playlist Selector
    btnPlaylistSelector: document.getElementById('btn-playlist-selector'),
    activePlaylistLabel: document.getElementById('active-playlist-label'),
    playlistChevron: document.getElementById('playlist-chevron'),
    playlistDropdown: document.getElementById('playlist-dropdown'),

    // 3D Carousel Stage & Cards
    carouselStage: document.getElementById('carousel-stage'),
    cardP2: document.getElementById('card-p2'),
    cardP1: document.getElementById('card-p1'),
    cardCurr: document.getElementById('card-curr'),
    cardN1: document.getElementById('card-n1'),
    cardN2: document.getElementById('card-n2'),

    // Music Control Bar
    btnPrev: document.getElementById('btn-prev'),
    btnPlay: document.getElementById('btn-play'),
    playIcon: document.getElementById('play-icon'),
    btnNext: document.getElementById('btn-next'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnRepeat: document.getElementById('btn-repeat'),
    dockThumb: document.getElementById('dock-thumb'),
    dockTitle: document.getElementById('dock-title'),
    dockArtist: document.getElementById('dock-artist'),
    dockCurrentTime: document.getElementById('dock-current-time'),
    dockDuration: document.getElementById('dock-duration'),
    dockTimeCombined: document.getElementById('dock-time-combined'),
    dockRail: document.getElementById('dock-rail'),
    dockFill: document.getElementById('dock-fill'),
    dockThumbHandle: document.getElementById('dock-thumb-handle'),
    btnVol: document.getElementById('btn-vol'),
    volIcon: document.getElementById('vol-icon'),
    volSlider: document.getElementById('vol-slider'),
    playerRightControls: document.getElementById('player-right-controls')
  };

  // Card Ring for 3D Carousel
  let cardRing = [DOM.cardP2, DOM.cardP1, DOM.cardCurr, DOM.cardN1, DOM.cardN2];
  const POS_NAMES = ['previous-2', 'previous-1', 'current', 'next-1', 'next-2'];

  // ============================================================
  // ARTWORK COLOR EXTRACTION & DYNAMIC PALETTE ENGINE
  // Extracts dominant, secondary, accent, and deep shadow tones directly
  // from the active song's center artwork (100% dynamic, no hardcoded colors)
  // ============================================================
  const ArtworkColorEngine = (function () {
    const paletteCache = new Map();
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 48;
    sampleCanvas.height = 48;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    // Neutral dark fallback — used only when image loading fails entirely
    const DEFAULT_PALETTE = {
      dominant: 'rgb(28, 32, 42)',
      secondary: 'rgb(18, 22, 28)',
      accent: 'rgb(55, 65, 80)',
      darkBase: 'rgb(6, 7, 9)'
    };

    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
    }

    function extractFromImageData(imgData) {
      if (!imgData || imgData.length === 0) return DEFAULT_PALETTE;

      const pixels = [];
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      let whiteCount = 0, blackCount = 0;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];
        if (a < 128) continue;

        sumR += r;
        sumG += g;
        sumB += b;
        count++;

        const [h, s, l] = rgbToHsl(r, g, b);

        if (l >= 90 && s < 12) whiteCount++;
        if (l <= 8) blackCount++;

        // Only include chromatic / non-blown-out pixels in vibrant hue clustering
        if (l >= 8 && l <= 88) {
          const score = (s * 2.2) + (100 - Math.abs(50 - l) * 1.3);
          pixels.push({ r, g, b, h, s, l, score });
        }
      }

      if (count === 0) return DEFAULT_PALETTE;

      // Handle predominantly monochromatic, black-and-white, or minimalist covers
      if (pixels.length < 20) {
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);
        const isWhiteDom = (whiteCount / count) > 0.45;
        const isBlackDom = (blackCount / count) > 0.45;

        if (isWhiteDom) {
          return {
            dominant: 'rgb(200, 205, 215)',
            secondary: 'rgb(140, 145, 155)',
            accent: 'rgb(235, 240, 250)',
            darkBase: 'rgb(12, 14, 18)'
          };
        }

        return {
          dominant: `rgb(${Math.max(20, avgR)}, ${Math.max(22, avgG)}, ${Math.max(26, avgB)})`,
          secondary: `rgb(${Math.max(12, Math.round(avgR * 0.7))}, ${Math.max(14, Math.round(avgG * 0.7))}, ${Math.max(18, Math.round(avgB * 0.7))})`,
          accent: `rgb(${Math.min(255, avgR + 35)}, ${Math.min(255, avgG + 35)}, ${Math.min(255, avgB + 35)})`,
          darkBase: `rgb(${Math.max(4, Math.round(avgR * 0.08))}, ${Math.max(4, Math.round(avgG * 0.08))}, ${Math.max(6, Math.round(avgB * 0.08))})`
        };
      }

      // Group into 12 hue bins (30 degrees each) to filter out single logo outliers
      const bins = Array.from({ length: 12 }, () => ({
        pixels: [],
        totalScore: 0
      }));

      for (let i = 0; i < pixels.length; i++) {
        const p = pixels[i];
        const binIdx = Math.floor((p.h % 360) / 30);
        bins[binIdx].pixels.push(p);
        bins[binIdx].totalScore += p.score;
      }

      // Filter out bins that have less than 3% of the image's pixels (eliminates small logos/badges)
      const minClusterSize = Math.max(4, Math.floor(pixels.length * 0.035));
      const validBins = bins.filter(b => b.pixels.length >= minClusterSize);

      for (const bin of validBins) {
        let r = 0, g = 0, b = 0, h = 0, s = 0, l = 0;
        const len = bin.pixels.length;
        for (const p of bin.pixels) {
          r += p.r; g += p.g; b += p.b; h += p.h; s += p.s; l += p.l;
        }
        bin.avgR = Math.round(r / len);
        bin.avgG = Math.round(g / len);
        bin.avgB = Math.round(b / len);
        bin.avgH = Math.round(h / len);
        bin.avgS = Math.round(s / len);
        bin.avgL = Math.round(l / len);
        // Cluster strength = score weighted by cluster volume
        bin.weightedScore = bin.totalScore * Math.sqrt(len);
      }

      if (validBins.length === 0) {
        pixels.sort((a, b) => b.score - a.score);
        const top = pixels[0];
        const darkR = Math.max(4, Math.min(22, Math.round(top.r * 0.07 + 2)));
        const darkG = Math.max(4, Math.min(22, Math.round(top.g * 0.07 + 2)));
        const darkB = Math.max(5, Math.min(26, Math.round(top.b * 0.07 + 3)));
        return {
          dominant: `rgb(${top.r}, ${top.g}, ${top.b})`,
          secondary: `rgb(${Math.round(top.r * 0.7)}, ${Math.round(top.g * 0.7)}, ${Math.round(top.b * 0.7)})`,
          accent: `rgb(${Math.min(255, top.r + 30)}, ${Math.min(255, top.g + 30)}, ${Math.min(255, top.b + 30)})`,
          darkBase: `rgb(${darkR}, ${darkG}, ${darkB})`
        };
      }

      validBins.sort((a, b) => b.weightedScore - a.weightedScore);
      const domBin = validBins[0];

      // Secondary: distinct chromatic bin with hue difference >= 30 degrees
      const secBin = validBins.find(b => Math.abs(b.avgH - domBin.avgH) >= 30)
                  || validBins[1]
                  || domBin;

      // Accent: highest saturation bin
      const accBin = validBins.reduce((best, b) => (b.avgS > best.avgS ? b : best), domBin);

      const domR = domBin.avgR, domG = domBin.avgG, domB = domBin.avgB;
      const secR = secBin.avgR, secG = secBin.avgG, secB = secBin.avgB;
      const accR = accBin.avgR, accG = accBin.avgG, accB = accBin.avgB;

      // Dark Base: deep shadow tint matching the extracted dominant hue
      const darkR = Math.max(4, Math.min(22, Math.round(domR * 0.07 + 2)));
      const darkG = Math.max(4, Math.min(22, Math.round(domG * 0.07 + 2)));
      const darkB = Math.max(5, Math.min(26, Math.round(domB * 0.07 + 3)));

      return {
        dominant: `rgb(${domR}, ${domG}, ${domB})`,
        secondary: `rgb(${secR}, ${secG}, ${secB})`,
        accent: `rgb(${accR}, ${accG}, ${accB})`,
        darkBase: `rgb(${darkR}, ${darkG}, ${darkB})`
      };
    }

    function extractFromImageElement(imgEl) {
      if (!imgEl) return null;
      try {
        if (!imgEl.complete || imgEl.naturalWidth === 0) return null;
        sampleCtx.clearRect(0, 0, 48, 48);
        sampleCtx.drawImage(imgEl, 0, 0, 48, 48);
        const imgData = sampleCtx.getImageData(0, 0, 48, 48).data;
        return extractFromImageData(imgData);
      } catch (e) {
        return null;
      }
    }

    function extractPalette(imgUrl, track = null, onReadyCallback = null) {
      const cacheKey = (typeof imgUrl === 'string' && imgUrl) ? imgUrl : (track?.id || String(track));
      if (paletteCache.has(cacheKey)) {
        return Promise.resolve(paletteCache.get(cacheKey));
      }

      // Check if center card image is already in the DOM and loaded
      const centerCardImg = document.querySelector('.carousel-card[data-pos="current"] .card-cover')
                         || DOM.dockThumb;
      if (centerCardImg) {
        const domPal = extractFromImageElement(centerCardImg);
        if (domPal) {
          paletteCache.set(cacheKey, domPal);
          return Promise.resolve(domPal);
        }
      }

      return new Promise((resolve) => {
        if (!imgUrl) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        const img = new Image();
        img.decoding = 'async';
        img.crossOrigin = 'anonymous';

        let resolved = false;
        const handleDone = (pal) => {
          if (resolved) return;
          resolved = true;
          paletteCache.set(cacheKey, pal);
          if (onReadyCallback) onReadyCallback(pal);
          resolve(pal);
        };

        const timer = setTimeout(() => {
          handleDone(DEFAULT_PALETTE);
        }, 1200);

        img.onload = () => {
          clearTimeout(timer);
          try {
            sampleCtx.clearRect(0, 0, 48, 48);
            sampleCtx.drawImage(img, 0, 0, 48, 48);
            const imgData = sampleCtx.getImageData(0, 0, 48, 48).data;
            const extracted = extractFromImageData(imgData);
            handleDone(extracted);
          } catch (e) {
            handleDone(DEFAULT_PALETTE);
          }
        };

        img.onerror = () => {
          clearTimeout(timer);
          handleDone(DEFAULT_PALETTE);
        };

        img.src = imgUrl;
      });
    }

    return {
      extractPalette,
      extractFromImageElement,
      DEFAULT_PALETTE
    };
  })();

  // ============================================================
  // CINEMATIC LIQUID ARTWORK ATMOSPHERE ENGINE (Dual Canvas)
  // Continuous, visibly moving, non-linear Apple Music-style ambient flow
  // ============================================================
  const AmbientAtmosphereEngine = (function () {
    let canvasA = null, ctxA = null;
    let canvasB = null, ctxB = null;
    let activeLayer = 'a'; // 'a' or 'b'
    let animId = null;
    let lastTime = 0;
    let isRunning = false;
    let isVisible = true;
    let prefersReducedMotion = false;
    let crossfadeTimeout = null;

    // Node blueprint with non-linear irrational harmonic frequencies
    const NODE_CONFIGS = [
      {
        role: 'dominant',
        baseRadiusRatio: 0.75,
        baseAlpha: 0.65,
        speed: 0.0012,
        spreadX: 0.40,
        spreadY: 0.35,
        cx: 0.32, cy: 0.38,
        fx1: 0.13, fx2: 0.21, fx3: 0.34,
        fy1: 0.17, fy2: 0.29, fy3: 0.43,
        fr1: 0.11, fr2: 0.22, fa: 0.14,
        px1: 0.5, px2: 1.8, px3: 3.2,
        py1: 2.1, py2: 0.7, py3: 4.4,
        pr: 1.2, pa: 0.9
      },
      {
        role: 'accent',
        baseRadiusRatio: 0.68,
        baseAlpha: 0.68,
        speed: 0.0016,
        spreadX: 0.44,
        spreadY: 0.38,
        cx: 0.70, cy: 0.32,
        fx1: 0.19, fx2: 0.31, fx3: 0.52,
        fy1: 0.13, fy2: 0.23, fy3: 0.38,
        fr1: 0.16, fr2: 0.29, fa: 0.18,
        px1: 3.4, px2: 0.9, px3: 2.1,
        py1: 1.1, py2: 4.2, py3: 0.3,
        pr: 2.7, pa: 1.8
      },
      {
        role: 'secondary',
        baseRadiusRatio: 0.72,
        baseAlpha: 0.62,
        speed: 0.0010,
        spreadX: 0.42,
        spreadY: 0.36,
        cx: 0.45, cy: 0.68,
        fx1: 0.11, fx2: 0.18, fx3: 0.29,
        fy1: 0.21, fy2: 0.34, fy3: 0.55,
        fr1: 0.13, fr2: 0.24, fa: 0.15,
        px1: 1.7, px2: 4.1, px3: 0.8,
        py1: 3.3, py2: 1.5, py3: 2.9,
        pr: 0.4, pa: 3.1
      },
      {
        role: 'highlight',
        baseRadiusRatio: 0.55,
        baseAlpha: 0.68,
        speed: 0.0020,
        spreadX: 0.46,
        spreadY: 0.40,
        cx: 0.58, cy: 0.46,
        fx1: 0.23, fx2: 0.37, fx3: 0.61,
        fy1: 0.19, fy2: 0.31, fy3: 0.48,
        fr1: 0.20, fr2: 0.35, fa: 0.24,
        px1: 4.8, px2: 2.3, px3: 5.1,
        py1: 0.4, py2: 3.9, py3: 1.7,
        pr: 3.9, pa: 0.2
      },
      {
        role: 'mid',
        baseRadiusRatio: 0.65,
        baseAlpha: 0.58,
        speed: 0.0014,
        spreadX: 0.38,
        spreadY: 0.42,
        cx: 0.25, cy: 0.70,
        fx1: 0.15, fx2: 0.26, fx3: 0.41,
        fy1: 0.11, fy2: 0.21, fy3: 0.33,
        fr1: 0.12, fr2: 0.20, fa: 0.16,
        px1: 2.9, px2: 5.4, px3: 1.3,
        py1: 4.7, py2: 0.2, py3: 3.6,
        pr: 1.8, pa: 2.4
      },
      {
        role: 'dominant',
        baseRadiusRatio: 0.82,
        baseAlpha: 0.52,
        speed: 0.0009,
        spreadX: 0.35,
        spreadY: 0.30,
        cx: 0.78, cy: 0.72,
        fx1: 0.09, fx2: 0.15, fx3: 0.24,
        fy1: 0.14, fy2: 0.24, fy3: 0.39,
        fr1: 0.09, fr2: 0.18, fa: 0.11,
        px1: 0.2, px2: 3.1, px3: 4.9,
        py1: 2.6, py2: 4.8, py3: 1.1,
        pr: 4.2, pa: 1.5
      }
    ];

    function createParticles(count) {
      const particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          baseX: 0.1 + (i / count) * 0.8 + (Math.random() - 0.5) * 0.1,
          baseY: 0.15 + (Math.random() * 0.7),
          speedX: 0.00018 + (i % 5) * 0.00008,
          speedY: 0.00015 + ((i + 2) % 5) * 0.00007,
          phaseX: (i * 1.37) % 6.28,
          phaseY: (i * 2.19) % 6.28,
          spreadX: 0.07 + (i % 4) * 0.03,
          spreadY: 0.06 + ((i + 1) % 4) * 0.025,
          baseRadiusRatio: 0.035 + ((i * 7) % 10) * 0.006,
          baseAlpha: 0.05 + ((i * 11) % 10) * 0.012,
          role: i % 3 === 0 ? 'accent' : (i % 3 === 1 ? 'highlight' : 'secondary')
        });
      }
      return particles;
    }

    function createFogNodes() {
      return [
        {
          cx: 0.32, cy: 0.42,
          speedX: 0.00014, speedY: 0.00011,
          phaseX: 1.2, phaseY: 2.8,
          spreadX: 0.22, spreadY: 0.18,
          radiusRatio: 0.82,
          baseAlpha: 0.16,
          role: 'dominant'
        },
        {
          cx: 0.72, cy: 0.58,
          speedX: 0.00011, speedY: 0.00015,
          phaseX: 3.7, phaseY: 0.9,
          spreadX: 0.24, spreadY: 0.20,
          radiusRatio: 0.92,
          baseAlpha: 0.14,
          role: 'secondary'
        }
      ];
    }

    function createLayerState(timeSeed) {
      return {
        img: null,
        imgLoaded: false,
        darkBase: { r: 6, g: 7, b: 9 },
        targetDarkBase: { r: 6, g: 7, b: 9 },
        timeOffset: timeSeed,
        coreDrift: {
          speedX: 0.0008, speedY: 0.0007, speedScale: 0.0006, speedRot: 0.0005,
          px1: Math.random() * 6.28, px2: Math.random() * 6.28,
          py1: Math.random() * 6.28, py2: Math.random() * 6.28,
          ps: Math.random() * 6.28, pr: Math.random() * 6.28
        },
        nodes: NODE_CONFIGS.map(cfg => ({
          ...cfg,
          current: { r: 28, g: 32, b: 42 },
          target: { r: 28, g: 32, b: 42 }
        })),
        fogNodes: createFogNodes(),
        particles: createParticles(14)
      };
    }

    let stateA = createLayerState(0);
    let stateB = createLayerState(10000);
    let liveAudioPulse = 1.0;

    function parseRgb(colorStr) {
      if (!colorStr) return { r: 28, g: 32, b: 42 };
      const m = colorStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) {
        return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
      }
      return { r: 28, g: 32, b: 42 };
    }

    let crossfadeEndTime = 0;
    let lastRenderTime = 0;

    function init() {
      canvasA = document.getElementById('ambient-canvas-a');
      canvasB = document.getElementById('ambient-canvas-b');
      if (!canvasA || !canvasB) return;

      ctxA = canvasA.getContext('2d', { alpha: false, desynchronized: true });
      ctxB = canvasB.getContext('2d', { alpha: false, desynchronized: true });

      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        prefersReducedMotion = true;
      }

      resize();
      window.addEventListener('resize', resize, { passive: true });

      document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
        if (isVisible) {
          if (!isRunning) {
            start();
          }
        } else {
          stop();
        }
      });

      // Off-screen viewport culling: pause RAF when scrolled past the hero stage
      if ('IntersectionObserver' in window) {
        const stageContainer = document.getElementById('stage-hero') || document.querySelector('.stage-section') || canvasA.parentElement;
        if (stageContainer) {
          const obs = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const inView = entry.isIntersecting;
            if (inView && isVisible) {
              if (!isRunning) start();
            } else {
              stop();
            }
          }, { threshold: 0.05 });
          obs.observe(stageContainer);
        }
      }

      // Initialize default atmosphere with neutral palette
      loadLayerArtwork(stateA, '', ArtworkColorEngine.DEFAULT_PALETTE);

      start();
    }

    function resize() {
      if (!canvasA || !canvasB) return;
      const isMobile = window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
      const aspect = (window.innerWidth && window.innerHeight) ? (window.innerWidth / window.innerHeight) : (16 / 9);
      const targetW = isMobile ? 320 : 460;
      const targetH = Math.max(200, Math.round(targetW / aspect));

      [canvasA, canvasB].forEach(c => {
        if (c.width !== targetW || c.height !== targetH) {
          c.width = targetW;
          c.height = targetH;
        }
      });
    }

    function loadLayerArtwork(layerState, imgUrl, palette) {
      if (palette) {
        applyPaletteToLayer(layerState, palette);
      }

      if (!imgUrl) return;

      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        layerState.img = img;
        layerState.imgLoaded = true;
      };
      img.onerror = () => {
        if (imgUrl !== 'favicon.png') {
          img.src = 'favicon.png';
        }
      };
      img.src = imgUrl;
    }

    function applyPaletteToLayer(layerState, palette) {
      const dom = parseRgb(palette.dominant);
      const sec = parseRgb(palette.secondary);
      const acc = parseRgb(palette.accent);
      const dark = parseRgb(palette.darkBase);

      layerState.targetDarkBase = dark;

      const highlight = {
        r: Math.min(255, Math.round(acc.r * 0.85 + dom.r * 0.15)),
        g: Math.min(255, Math.round(acc.g * 0.85 + dom.g * 0.15)),
        b: Math.min(255, Math.round(acc.b * 0.85 + dom.b * 0.15))
      };

      const mid = {
        r: Math.round(dom.r * 0.60 + sec.r * 0.40),
        g: Math.round(dom.g * 0.60 + sec.g * 0.40),
        b: Math.round(dom.b * 0.60 + sec.b * 0.40)
      };

      layerState.paletteColors = { dom, sec, acc, highlight, mid };

      layerState.nodes.forEach(node => {
        if (node.role === 'dominant') node.target = { ...dom };
        else if (node.role === 'secondary') node.target = { ...sec };
        else if (node.role === 'accent') node.target = { ...acc };
        else if (node.role === 'highlight') node.target = { ...highlight };
        else if (node.role === 'mid') node.target = { ...mid };
      });
    }

    function transitionToTrack(artworkUrl, palette) {
      const targetLayerName = (activeLayer === 'a') ? 'b' : 'a';
      const targetState = (targetLayerName === 'b') ? stateB : stateA;
      const targetCanvas = (targetLayerName === 'b') ? canvasB : canvasA;
      const currentCanvas = (targetLayerName === 'b') ? canvasA : canvasB;

      if (!targetCanvas || !currentCanvas) return;

      // Prepare target canvas with new artwork and palette
      loadLayerArtwork(targetState, artworkUrl, palette);

      // Smooth crossfade: target layer fades in, current layer fades out
      targetCanvas.classList.add('is-active');
      currentCanvas.classList.remove('is-active');

      activeLayer = targetLayerName;
      crossfadeEndTime = performance.now() + 2300;
    }

    function start() {
      if (isRunning || !isVisible) return;
      isRunning = true;
      lastTime = performance.now();
      lastRenderTime = lastTime;
      animId = requestAnimationFrame(loop);
    }

    function stop() {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      isRunning = false;
    }

    function loop(now) {
      if (!isRunning || !isVisible) return;

      const isMobile = window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
      const minFrameInterval = isMobile ? 32 : 16; // 30fps budget on mobile reduces thermal load drastically

      if (now - lastRenderTime < minFrameInterval) {
        animId = requestAnimationFrame(loop);
        return;
      }

      const dt = Math.min(100, now - (lastRenderTime || now));
      lastRenderTime = now;
      lastTime = now;

      // Smooth audio-reactive pulse transition
      const isMusicActive = Boolean(state.isPlaying);
      const targetPulse = isMusicActive ? (1.0 + 0.045 * Math.sin(now * 0.0032) + 0.025 * Math.cos(now * 0.0055)) : 1.0;
      liveAudioPulse += (targetPulse - liveAudioPulse) * Math.min(1.0, (dt / 1000) * 3.5);

      // Only render crossfading inactive layer during active transition
      const isCrossfading = now < crossfadeEndTime;
      if (activeLayer === 'a') {
        if (canvasA && ctxA) renderLayer(ctxA, canvasA, stateA, now, dt, isMobile);
        if (isCrossfading && canvasB && ctxB) renderLayer(ctxB, canvasB, stateB, now, dt, isMobile);
      } else {
        if (canvasB && ctxB) renderLayer(ctxB, canvasB, stateB, now, dt, isMobile);
        if (isCrossfading && canvasA && ctxA) renderLayer(ctxA, canvasA, stateA, now, dt, isMobile);
      }

      animId = requestAnimationFrame(loop);
    }

    function renderLayer(ctx, canvas, state, now, dt, isMobile) {
      const w = canvas.width;
      const h = canvas.height;
      const minDim = Math.min(w, h);

      const colorLerp = Math.min(1.0, (dt / 1000) * 2.5);
      state.darkBase.r += (state.targetDarkBase.r - state.darkBase.r) * colorLerp;
      state.darkBase.g += (state.targetDarkBase.g - state.darkBase.g) * colorLerp;
      state.darkBase.b += (state.targetDarkBase.b - state.darkBase.b) * colorLerp;

      const speedScale = prefersReducedMotion ? 0.2 : 1.0;
      const t = (now + state.timeOffset) * speedScale;

      // 1. BASE BACKGROUND FILL
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgb(${Math.round(state.darkBase.r)}, ${Math.round(state.darkBase.g)}, ${Math.round(state.darkBase.b)})`;
      ctx.fillRect(0, 0, w, h);

      // 2. FLOWING ARTWORK IMAGE CORE (Animated organic drift & liquid scale)
      if (state.imgLoaded && state.img) {
        ctx.save();
        const cd = state.coreDrift;

        // Non-linear organic position displacement (noticeable ±6% to ±10% drift)
        const artX = w * (0.5 + 0.08 * Math.sin(t * cd.speedX + cd.px1) + 0.05 * Math.cos(t * cd.speedX * 1.618 + cd.px2));
        const artY = h * (0.5 + 0.07 * Math.cos(t * cd.speedY + cd.py1) + 0.05 * Math.sin(t * cd.speedY * 1.414 + cd.py2));

        // Organic pulsating scale
        const artScale = 1.18 + 0.08 * Math.sin(t * cd.speedScale + cd.ps) + 0.04 * Math.cos(t * cd.speedScale * 2.236);

        // Subtle fluid rotation
        const artRot = 0.045 * Math.sin(t * cd.speedRot + cd.pr);

        ctx.translate(artX, artY);
        ctx.rotate(artRot);
        ctx.scale(artScale, artScale);

        // Fill canvas maintaining aspect ratio
        const imgAspect = state.img.width / state.img.height;
        const canvasAspect = w / h;
        let drawW, drawH;
        if (canvasAspect > imgAspect) {
          drawW = w * 1.35;
          drawH = drawW / imgAspect;
        } else {
          drawH = h * 1.35;
          drawW = drawH * imgAspect;
        }

        ctx.globalAlpha = 0.78;
        ctx.drawImage(state.img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      // 3. ATMOSPHERIC DRIFTING HAZE / VOLUMETRIC FOG BLOOMS
      ctx.globalCompositeOperation = 'screen';
      if (state.fogNodes && state.paletteColors) {
        for (let i = 0; i < state.fogNodes.length; i++) {
          const fog = state.fogNodes[i];
          const colorObj = fog.role === 'dominant' ? state.paletteColors.dom : state.paletteColors.sec;
          const fx = (fog.cx + Math.sin(t * fog.speedX + fog.phaseX) * fog.spreadX) * w;
          const fy = (fog.cy + Math.cos(t * fog.speedY + fog.phaseY) * fog.spreadY) * h;
          const fRadius = minDim * fog.radiusRatio * (1.0 + 0.08 * Math.sin(t * 0.0004 + fog.phaseX));

          const fogGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fRadius);
          fogGrad.addColorStop(0, `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, ${fog.baseAlpha.toFixed(3)})`);
          fogGrad.addColorStop(0.5, `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, ${(fog.baseAlpha * 0.4).toFixed(3)})`);
          fogGrad.addColorStop(1, `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, 0)`);

          ctx.fillStyle = fogGrad;
          ctx.beginPath();
          ctx.arc(fx, fy, fRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. MOVING CHROMATIC FLUID LIGHT BLOOMS (Liquid Additive/Screen Overlay)
      for (let i = 0; i < state.nodes.length; i++) {
        const node = state.nodes[i];

        // Lerp color
        node.current.r += (node.target.r - node.current.r) * colorLerp;
        node.current.g += (node.target.g - node.current.g) * colorLerp;
        node.current.b += (node.target.b - node.current.b) * colorLerp;

        const cR = Math.round(node.current.r);
        const cG = Math.round(node.current.g);
        const cB = Math.round(node.current.b);

        // Active non-linear harmonic motion (visibly shifts bright regions over 3–5 seconds)
        const st = t * node.speed;

        const dx = Math.sin(st * node.fx1 + node.px1) * 0.44
                 + Math.cos(st * node.fx2 * 1.6180339 + node.px2) * 0.36
                 + Math.sin(st * node.fx3 * 2.2360679 + node.px3) * 0.24;

        const dy = Math.cos(st * node.fy1 + node.py1) * 0.44
                 + Math.sin(st * node.fy2 * 1.4142135 + node.py2) * 0.36
                 + Math.cos(st * node.fy3 * 1.7320508 + node.py3) * 0.24;

        const posX = (node.cx + dx * node.spreadX) * w;
        const posY = (node.cy + dy * node.spreadY) * h;

        // Dynamic breathing radius modulated by music activity pulse
        const rPulse = (1.0 + 0.26 * Math.sin(st * node.fr1 * 1.3247 + node.pr) + 0.14 * Math.cos(st * node.fr2 * 2.71828)) * liveAudioPulse;
        const radius = Math.max(40, node.baseRadiusRatio * minDim * rPulse);

        // Dynamic luminescence pulse
        const aPulse = (1.0 + 0.20 * Math.sin(st * node.fa * 1.61803 + node.pa)) * liveAudioPulse;
        const alpha = Math.max(0.20, Math.min(0.98, node.baseAlpha * aPulse));

        // Soft volumetric radial gradient bloom
        const grad = ctx.createRadialGradient(posX, posY, 0, posX, posY, radius);
        grad.addColorStop(0, `rgba(${cR}, ${cG}, ${cB}, ${(alpha * 0.95).toFixed(3)})`);
        grad.addColorStop(0.35, `rgba(${cR}, ${cG}, ${cB}, ${(alpha * 0.65).toFixed(3)})`);
        grad.addColorStop(0.70, `rgba(${cR}, ${cG}, ${cB}, ${(alpha * 0.25).toFixed(3)})`);
        grad.addColorStop(1.0, `rgba(${cR}, ${cG}, ${cB}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(posX, posY, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. SOFT FLOATING LIGHT PARTICLES (Dreamy Ambient Motility)
      if (state.particles && state.paletteColors) {
        const pCount = isMobile ? 7 : state.particles.length;
        for (let i = 0; i < pCount; i++) {
          const p = state.particles[i];
          const col = p.role === 'highlight' ? state.paletteColors.highlight : (p.role === 'accent' ? state.paletteColors.acc : state.paletteColors.sec);

          const px = (p.baseX + Math.sin(t * p.speedX + p.phaseX) * p.spreadX) * w;
          const py = (p.baseY + Math.cos(t * p.speedY + p.phaseY) * p.spreadY) * h;
          const pr = Math.max(8, minDim * p.baseRadiusRatio * (1.0 + 0.15 * Math.sin(t * 0.001 + p.phaseX)));
          const pa = p.baseAlpha * (1.0 + 0.25 * Math.sin(t * 0.0015 + p.phaseY)) * liveAudioPulse;

          const pGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
          pGrad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, ${(pa * 0.8).toFixed(3)})`);
          pGrad.addColorStop(0.45, `rgba(${col.r}, ${col.g}, ${col.b}, ${(pa * 0.35).toFixed(3)})`);
          pGrad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);

          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    function updateCurrentLayerPalette(palette) {
      const currentState = (activeLayer === 'b') ? stateB : stateA;
      if (currentState && palette) {
        applyPaletteToLayer(currentState, palette);
      }
    }

    return {
      init,
      transitionToTrack,
      updateCurrentLayerPalette
    };
  })();

  // Track Artwork Dynamic Atmosphere Dispatcher
  let lastAppliedArtworkKey = '';

  async function updateDynamicArtworkBackground(track) {
    if (!track) return;
    const artworkUrl = getTrackArtworkUrl(track);
    const trackKey = (track.id || track.youtubeId || track.title) + '_' + artworkUrl;
    if (trackKey === lastAppliedArtworkKey) return;
    lastAppliedArtworkKey = trackKey;

    const applyPalette = (palette) => {
      if (!palette || !palette.dominant) return;
      AmbientAtmosphereEngine.transitionToTrack(artworkUrl, palette);

      const accRgb = palette.accent ? palette.accent.replace(/rgb\(|\)/g, '') : '225, 45, 65';
      const domRgb = palette.dominant ? palette.dominant.replace(/rgb\(|\)/g, '') : '185, 28, 45';

      const root = document.documentElement;
      if (root) {
        root.style.setProperty('--track-accent-glow', `rgba(${accRgb}, 0.25)`);
        root.style.setProperty('--track-dominant-glow', `rgba(${domRgb}, 0.18)`);
      }

      const stageContainer = document.getElementById('stage-carousel-container');
      if (stageContainer) {
        stageContainer.style.setProperty('--track-accent-glow', `rgba(${accRgb}, 0.25)`);
        stageContainer.style.setProperty('--track-dominant-glow', `rgba(${domRgb}, 0.18)`);
      }
    };

    const palette = await ArtworkColorEngine.extractPalette(artworkUrl, track, (finePalette) => {
      applyPalette(finePalette);
    });

    applyPalette(palette);
  }

  // --- Resilient Network Fetcher (Timeout, Exponential Backoff Retry & In-Flight Deduplication) ---
  const inFlightRequests = new Map();

  async function fetchWithRetryAndTimeout(url, options = {}, maxRetries = 2, timeoutMs = 12000) {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const dedupeKey = isGet ? `${url}__${JSON.stringify(options.headers || {})}` : null;

    if (dedupeKey && inFlightRequests.has(dedupeKey)) {
      return inFlightRequests.get(dedupeKey).then(res => res.clone());
    }

    const execPromise = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(url, {
            ...options,
            signal: controller.signal
          });
          clearTimeout(timer);

          // Retry on 5xx or server gateway errors with backoff
          if (!res.ok && res.status >= 500 && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 400));
            continue;
          }

          return res;
        } catch (err) {
          clearTimeout(timer);
          lastError = err;
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 400));
          }
        }
      }
      throw lastError || new Error(`Network request timed out or failed: ${url}`);
    })();

    if (dedupeKey) {
      inFlightRequests.set(dedupeKey, execPromise);
      execPromise.finally(() => inFlightRequests.delete(dedupeKey));
    }

    return execPromise;
  }

  // --- InsForge REST Helper with Automatic Retry & Timeout ---
  async function insforgeFetch(path, options = {}) {
    const url = `${INSFORGE_CONFIG.baseUrl}${path}`;
    const headers = {
      'apikey': INSFORGE_CONFIG.apiKey,
      'Authorization': `Bearer ${INSFORGE_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    return fetchWithRetryAndTimeout(url, { ...options, headers }, 2, 12000);
  }

  // --- Google Drive & Media URL Normalizer ---
  function normalizeDriveImageUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const clean = url.trim();

    // 1. Google Drive Share Link Converter
    const driveMatch = clean.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.+&)?id=)|lh3\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]{20,})/);
    if (driveMatch) {
      const fileId = driveMatch[1];
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }

    // 2. Dropbox Direct Download Link Converter
    if (clean.includes('dropbox.com')) {
      return clean.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=0/, '');
    }

    return clean;
  }

  // --- Dynamic InsForge Cloud Playlists Sync with SWR (Stale-While-Revalidate) ---
  const CACHED_PLAYLISTS_KEY = 'gullygang_cached_playlists';

  async function loadInsForgePlaylists(isBackgroundSync = false) {
    // 1. Instant Cache Hydration: Render cached playlists in 0ms so UI is never blank
    if (!state.playlists || state.playlists.length === 0) {
      try {
        const cached = localStorage.getItem(CACHED_PLAYLISTS_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            state.playlists = parsed;
            renderPlaylistMenus();
            if (!state.currentPlaylist) {
              selectPlaylist(parsed[0]);
            }
          }
        }
      } catch (e) {}
    }

    // 2. Background Revalidation from InsForge
    try {
      const res = await insforgeFetch('/api/database/records/playlists?is_active=eq.true&order=display_order.asc');
      if (res.ok) {
        const playlists = await res.json();
        if (Array.isArray(playlists) && playlists.length > 0) {
          try {
            localStorage.setItem(CACHED_PLAYLISTS_KEY, JSON.stringify(playlists));
          } catch (e) {}

          const prevId = state.currentPlaylist?.id;
          state.playlists = playlists;
          renderPlaylistMenus();

          if (prevId) {
            const updatedCurrent = playlists.find(p => String(p.id) === String(prevId));
            if (updatedCurrent) {
              state.currentPlaylist = updatedCurrent;
              updatePlaylistLabels(updatedCurrent.name, updatedCurrent.icon);
              // CANONICAL BOOT SYNC: previously this branch returned early and
              // NEVER loaded real playlist songs — seed tracks (and hardcoded
              // dock metadata) stayed visible until the user changed playlist.
              // Now hydrate the real songs via SWR; loadPlaylistSongs
              // reconciles state.currentIndex with the ACTUAL YouTube video,
              // so the playing track is preserved and metadata always matches.
              if (!isBackgroundSync) {
                loadPlaylistSongs(updatedCurrent, false, false, true);
              }
              return;
            }
          }

          if (!isBackgroundSync || !state.currentPlaylist) {
            selectPlaylist(playlists[0]);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[InsForge] Playlists sync notice (offline/slow connection):', e);
    }

    // 3. Fallback only if no playlists exist at all
    if (!state.currentPlaylist && (!state.playlists || state.playlists.length === 0)) {
      state.playlists = [
        {
          id: '25217e19-6e46-4e64-8d34-14a697b56f63',
          name: 'GullyGang Special',
          icon: 'bolt',
          youtube_playlist_url: 'https://youtube.com/playlist?list=PLIQS0Hg0bqrV8JDs67xuNRI0C5UTfGAyt',
          bg_image: 'favicon.png'
        },
        {
          id: '79baaf20-b9b9-44c6-b38c-193f2aa8efbf',
          name: 'Odia Romantic',
          icon: 'heart',
          youtube_playlist_url: 'https://youtube.com/playlist?list=PLIQS0Hg0bqrUpax63Fk7i7XjGa5a-9Av1',
          bg_image: 'favicon.png'
        }
      ];
      renderPlaylistMenus();
      selectPlaylist(state.playlists[0]);
    }
  }

  // --- Inline SVG Icon System (replaces emoji) ---
  function svgIcon(paths, size = 12, cls = '') {
    const classAttr = cls ? ` class="${cls}"` : '';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"${classAttr} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  const PLAYLIST_ICON_SVGS = {
    bolt: { paths: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />', size: 12 },
    heart: { paths: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />', size: 12 },
    music: { paths: '<path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />', size: 12 }
  };
  // Legacy aliases so icons stored in the database (e.g. emoji values) still resolve
  const PLAYLIST_ICON_ALIASES = { '⚡️': 'bolt', '⚡': 'bolt', 'bolt': 'bolt', '💝': 'heart', '❤️': 'heart', 'heart': 'heart', '🎵': 'music', '🎶': 'music', 'music': 'music' };

  function playlistIconSvg(icon) {
    const key = PLAYLIST_ICON_ALIASES[icon] || 'music';
    const def = PLAYLIST_ICON_SVGS[key];
    return svgIcon(def.paths, def.size);
  }

  function updatePlaylistLabels(name) {
    if (!DOM.activePlaylistLabel) return;
    DOM.activePlaylistLabel.textContent = name || 'GullyGang Special';
  }

  function renderPlaylistMenus() {
    const container = DOM.playlistDropdown;
    if (!container) return;

    const itemsHtml = state.playlists.map(pl => {
      const isActive = state.currentPlaylist?.id === pl.id;
      const safeName = escapeHTML(pl.name);
      const safeId = escapeHTML(String(pl.id));
      const isCustomBadge = pl.isCustomUserPlaylist ? ` <span style="font-size:8px;padding:1px 4px;border-radius:4px;background:rgba(52,211,153,0.2);color:#34d399;font-weight:700;margin-left:4px;">YOURS</span>` : '';
      return `
        <button type="button" class="playlist-option-btn ${isActive ? 'is-active' : ''}" data-pl-id="${safeId}">
          <span class="text-[12px] truncate flex-1">${safeName}${isCustomBadge}</span>
        </button>
      `;
    }).join('');

    const customEntryHtml = `
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding:5px 6px 3px;">
        <button type="button" id="btn-open-user-playlist-modal" class="playlist-custom-entry-btn">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span style="flex:1;text-align:left;">Listen Your Playlist</span>
        </button>
      </div>
    `;

    const isOfficialCurrent = !state.currentPlaylist?.isCustomUserPlaylist;
    const syncFooterHtml = isOfficialCurrent ? `
      <div style="padding:2px 6px 4px;">
        <button type="button" id="btn-refresh-playlist" class="playlist-refresh-btn playlist-sync-btn">
          <svg class="refresh-icon sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;max-width:12px;max-height:12px;flex-shrink:0;display:inline-block;">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span id="refresh-playlist-status" style="font-size:11px;font-weight:600;">Refresh Playlist</span>
        </button>
      </div>
    ` : '';

    container.innerHTML = itemsHtml + customEntryHtml + syncFooterHtml;
  }

  async function selectPlaylist(playlist, isInitialBootHydration = false) {
    state.currentPlaylist = playlist;
    updatePlaylistLabels(playlist.name, playlist.icon);

    trackEvent('playlist_selected', {
      name: playlist.name,
      slug: playlist.slug,
      id: playlist.id
    });

    renderPlaylistMenus();

    if (playlist.isCustomUserPlaylist) {
      state.tracks = playlist.tracks || [];
      state.currentIndex = 0;
      setupCardsInitial();
      updateDockUI();
      if (state.tracks.length > 0) {
        loadTrackAtIndex(0, true, 'direct');
      }
      return;
    }

    await loadPlaylistSongs(playlist, false, false, isInitialBootHydration);
  }

  // ============================================================
  // AUTHORITATIVE YOUTUBE PLAYLIST PAGINATED SYNC ENGINE
  // ============================================================
  // CANONICAL ARTWORK NORMALIZATION & QUALITY WATERFALL
  // Guaranteed thumbnail resolution, format conversion, and auto-failover
  // ============================================================
  // ============================================================
  // CANONICAL ARTWORK NORMALIZATION & CLEAN ID EXTRACTION
  // Guaranteed video ID sanitization and thumbnail waterfall resolution
  // ============================================================
  function extractCleanYouTubeId(rawId) {
    if (!rawId || typeof rawId !== 'string') return '';
    const trimmed = rawId.trim();
    // 1. Match YouTube URL formats (youtu.be/xxx, youtube.com/watch?v=xxx, youtube.com/embed/xxx)
    const urlMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([A-Za-z0-9_-]{11})/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
    // 2. Direct 11-char YouTube Video ID
    const directMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
    if (directMatch) return directMatch[0];
    return trimmed;
  }

  // ============================================================
  // CANONICAL CURRENT-TRACK RECONCILIATION ENGINE
  // Single source of truth: the ACTUAL video loaded in the YouTube player.
  // YouTube video ID -> track object -> state.currentIndex -> cards/dock/
  // thumbnail/artwork/MediaSession must NEVER initialize or drift apart.
  // ============================================================
  function getActualPlayingVideoId() {
    try {
      if (state.ytPlayer && typeof state.ytPlayer.getVideoData === 'function') {
        const videoData = state.ytPlayer.getVideoData();
        if (videoData && videoData.video_id) return videoData.video_id;
      }
    } catch (e) {}
    return null;
  }

  function findTrackIndexByVideoId(tracks, videoId) {
    if (!videoId || !Array.isArray(tracks) || tracks.length === 0) return -1;
    const cleanId = extractCleanYouTubeId(videoId);
    if (!cleanId) return -1;
    return tracks.findIndex(t => {
      const trackId = extractCleanYouTubeId((t && (t.id || t.youtubeId || t.youtube_id)) || '');
      return trackId && trackId === cleanId;
    });
  }

  // True when the player holds a user-paused song (must never be restarted by
  // background revalidation). CUED/unstarted videos MAY be auto-started.
  function isPlayerLoadedButPaused() {
    try {
      if (state.ytPlayer && typeof state.ytPlayer.getPlayerState === 'function') {
        return state.ytPlayer.getPlayerState() === 2; // PAUSED
      }
    } catch (e) {}
    return false;
  }

  // Resolve the canonical current track from the REAL YouTube video and
  // re-render every metadata surface (cards, dock, artwork, MediaSession)
  // when the index had drifted. Never touches playback itself.
  function reconcileCurrentTrack(renderIfChanged = true) {
    const actualVideoId = getActualPlayingVideoId();
    if (!actualVideoId) return null;
    const matchIdx = findTrackIndexByVideoId(state.tracks, actualVideoId);
    if (matchIdx < 0) return null;
    if (matchIdx !== state.currentIndex) {
      state.currentIndex = matchIdx;
      if (renderIfChanged) {
        setupCardsInitial();
        updateDockUI();
      }
    }
    return state.tracks[matchIdx];
  }

  function normalizeThumbnailUrl(thumb, videoId) {
    const cleanId = extractCleanYouTubeId(videoId);
    if (cleanId) {
      if (thumb && typeof thumb === 'string') {
        const trimmed = thumb.trim();
        if (trimmed.includes('maxresdefault.jpg') || trimmed.includes('sddefault.jpg') || trimmed.includes('hqdefault.jpg')) {
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          }
        }
      }
      return `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
    }

    if (thumb && typeof thumb === 'string') {
      const trimmed = thumb.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.endsWith('.png') || trimmed.endsWith('.jpg') || trimmed.endsWith('.webp')) {
        return trimmed;
      }
    }

    return 'favicon.png';
  }

  function getTrackArtworkUrl(track) {
    if (!track) return 'favicon.png';
    return normalizeThumbnailUrl(track.thumbnail, track.id);
  }

  function getArtworkWaterfallCandidates(track) {
    const candidates = [];
    if (!track) {
      candidates.push('favicon.png');
      return candidates;
    }

    if (track.id) {
      // 1. Guaranteed high-quality YouTube thumbnail (100% available)
      const hq = `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
      candidates.push(hq);

      // 2. High-res candidate
      const maxres = `https://i.ytimg.com/vi/${track.id}/maxresdefault.jpg`;
      candidates.push(maxres);

      // 3. Medium & standard fallbacks
      const sd = `https://i.ytimg.com/vi/${track.id}/sddefault.jpg`;
      const mq = `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`;
      candidates.push(sd);
      candidates.push(mq);
    } else if (track.thumbnail) {
      candidates.push(track.thumbnail);
    }

    const playlistCover = state.currentPlaylist?.bg_image || 'favicon.png';
    if (!candidates.includes(playlistCover)) candidates.push(playlistCover);
    if (!candidates.includes('favicon.png')) candidates.push('favicon.png');

    return candidates;
  }

  function setupImageWithWaterfall(imgEl, track, isCritical = false) {
    if (!imgEl) return;
    imgEl.decoding = 'async';
    imgEl.crossOrigin = 'anonymous';
    const isLcpElement = isCritical || imgEl.id === 'curr-cover-img' || (imgEl.parentElement && imgEl.parentElement.closest('#card-curr'));
    if (isLcpElement) {
      imgEl.removeAttribute('loading');
      imgEl.setAttribute('fetchpriority', 'high');
      if ('fetchPriority' in imgEl) imgEl.fetchPriority = 'high';
    } else {
      imgEl.setAttribute('loading', 'lazy');
      if ('fetchPriority' in imgEl) imgEl.fetchPriority = 'low';
    }
    const candidates = getArtworkWaterfallCandidates(track);
    imgEl._waterfallCandidates = candidates;
    imgEl._waterfallIndex = 0;

    imgEl.onerror = function () {
      imgEl._waterfallIndex = (imgEl._waterfallIndex || 0) + 1;
      if (imgEl._waterfallCandidates && imgEl._waterfallIndex < imgEl._waterfallCandidates.length) {
        imgEl.src = imgEl._waterfallCandidates[imgEl._waterfallIndex];
      } else {
        imgEl.onerror = null;
      }
    };

    const targetSrc = candidates[0];
    if (targetSrc && imgEl.getAttribute('src') !== targetSrc && imgEl.src !== targetSrc) {
      imgEl.src = targetSrc;
    }
  }

  // ============================================================
  // GULLYGANG RELIABLE PLAYLIST SYNCHRONIZATION ENGINE
  // First-party InsForge database retrieval & YouTube Data API v3
  // (Zero external CORS proxies or unreliable Invidious scrapers)
  // ============================================================
  async function fetchViaYouTubeDataAPI(listId, apiKey) {
    if (!listId || !apiKey) return [];
    const allTracks = [];
    const seenIds = new Set();
    let nextPageToken = '';
    let pageCount = 0;

    try {
      do {
        pageCount++;
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&playlistId=${encodeURIComponent(listId)}&maxResults=50${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ''}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) break;

        const data = await res.json();
        const items = data.items || [];
        for (const item of items) {
          const vidId = item.snippet?.resourceId?.videoId;
          const title = item.snippet?.title || '';
          const isUnavailable = (
            !title ||
            title === 'Private video' ||
            title === 'Deleted video' ||
            title === '[Deleted video]' ||
            title === '[Private video]' ||
            title.toLowerCase().includes('unavailable video') ||
            title.toLowerCase().includes('video unavailable')
          );

          if (!vidId || seenIds.has(vidId) || isUnavailable) continue;
          seenIds.add(vidId);

          const artist = item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Odia Artist';
          const thumbs = item.snippet?.thumbnails || {};
          const thumbUrl = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '';

          allTracks.push({
            id: vidId,
            title: title.trim() || 'Untitled Track',
            artist: artist.trim() || 'Odia Artist',
            thumbnail: normalizeThumbnailUrl(thumbUrl, vidId)
          });
        }
        nextPageToken = data.nextPageToken || '';
      } while (nextPageToken && pageCount < 200);
    } catch (e) {
      console.warn('[Sync] YouTube Data API notice:', e);
    }

    return allTracks;
  }

  // --- Authoritative YouTube Synchronization & Reconciliation Engine ---
  // ============================================================
  // PLAYLIST RUNTIME CACHE ENGINE
  // High-performance 10-minute cache with in-memory Map & sessionStorage
  // ============================================================
  // ============================================================
  // DURABLE PLAYLIST CACHE ENGINE (Stale-While-Revalidate)
  // Persistent localStorage + in-memory Map for instantaneous 0ms cold-start
  // ============================================================
  const PlaylistCacheEngine = (function () {
    const memoryCache = new Map();

    function getCacheKey(listId) {
      return `gullygang_pl_cache_${listId}`;
    }

    function get(listId) {
      if (!listId) return null;
      const key = getCacheKey(listId);

      // 1. Check in-memory map
      if (memoryCache.has(key)) {
        const tracks = memoryCache.get(key);
        if (Array.isArray(tracks) && tracks.length > 0) return tracks;
      }

      // 2. Check localStorage (persistent across app closes & restarts)
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          const tracks = Array.isArray(parsed) ? parsed : parsed.tracks;
          if (Array.isArray(tracks) && tracks.length > 0) {
            memoryCache.set(key, tracks);
            return tracks;
          }
        }
      } catch (e) {}

      // 3. Fallback check sessionStorage
      try {
        const stored = sessionStorage.getItem(key) || sessionStorage.getItem(`odiverse_pl_cache_${listId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          const tracks = Array.isArray(parsed) ? parsed : parsed.tracks;
          if (Array.isArray(tracks) && tracks.length > 0) {
            memoryCache.set(key, tracks);
            return tracks;
          }
        }
      } catch (e) {}

      return null;
    }

    function set(listId, tracks) {
      if (!listId || !Array.isArray(tracks) || tracks.length === 0) return;
      const key = getCacheKey(listId);
      memoryCache.set(key, tracks);
      try {
        localStorage.setItem(key, JSON.stringify({
          timestamp: Date.now(),
          tracks: tracks
        }));
      } catch (e) {}
    }

    function invalidate(listId) {
      if (!listId) return;
      const key = getCacheKey(listId);
      memoryCache.delete(key);
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    }

    return {
      get,
      set,
      invalidate
    };
  })();

  // ============================================================
  // CINEMATIC PLAYLIST LOADING TRANSITION CONTROLLER
  // Handles intentional transitions, shimmer states, stale request guards,
  // and smooth carousel cross-fades.
  // ============================================================
  let currentPlaylistRequestId = 0;

  function setPlaylistLoadingState(isLoading, playlistName = '', isRefresh = false, progress = null) {
    state.isPlaylistLoading = isLoading;
    const stageContainer = document.getElementById('stage-carousel-container');
    const overlay = document.getElementById('playlist-loading-overlay');
    const plNameEl = document.getElementById('loading-pl-name');
    const statusTextEl = document.getElementById('loading-status-text');
    const progressBox = document.getElementById('loading-progress-box');
    const progressBar = document.getElementById('loading-progress-bar');
    const progressCount = document.getElementById('loading-progress-count');
    const errorBox = document.getElementById('loading-error-box');
    const loadingCard = overlay?.querySelector('.playlist-loading-card');

    if (isLoading) {
      stageContainer?.setAttribute('aria-busy', 'true');
      stageContainer?.classList.add('is-loading-playlist');

      if (overlay) {
        overlay.classList.remove('hidden');
        requestAnimationFrame(() => overlay.classList.add('is-active'));
      }

      if (plNameEl && playlistName) {
        plNameEl.textContent = playlistName;
      }
      if (statusTextEl) {
        statusTextEl.textContent = isRefresh ? 'Refreshing playlist' : 'Loading playlist';
      }

      if (errorBox) errorBox.classList.add('hidden');
      if (loadingCard) loadingCard.classList.remove('hidden');

      if (progress && progress.total > 0) {
        progressBox?.classList.remove('hidden');
        const pct = Math.min(100, Math.round((progress.current / progress.total) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressCount) progressCount.textContent = `${progress.current} / ${progress.total}`;
      } else {
        progressBox?.classList.add('hidden');
      }
    } else {
      stageContainer?.removeAttribute('aria-busy');
      stageContainer?.classList.remove('is-loading-playlist');

      if (overlay) {
        overlay.classList.remove('is-active');
        setTimeout(() => {
          if (!state.isPlaylistLoading) {
            overlay.classList.add('hidden');
            progressBox?.classList.add('hidden');
          }
        }, 280);
      }
    }
  }

  function showPlaylistLoadingError(playlistName) {
    state.isPlaylistLoading = false;
    const stageContainer = document.getElementById('stage-carousel-container');
    const overlay = document.getElementById('playlist-loading-overlay');
    const errorBox = document.getElementById('loading-error-box');
    const loadingCard = overlay?.querySelector('.playlist-loading-card');

    stageContainer?.removeAttribute('aria-busy');
    stageContainer?.classList.add('is-loading-playlist');

    if (overlay) {
      overlay.classList.remove('hidden');
      requestAnimationFrame(() => overlay.classList.add('is-active'));
    }
    if (loadingCard) loadingCard.classList.add('hidden');
    if (errorBox) errorBox.classList.remove('hidden');
  }

  // --- Dynamic Playlist Loading with SWR (Stale-While-Revalidate) & Zero Data Loss ---
  async function loadPlaylistSongs(playlist, forceRefresh = false, isManualTrigger = false, skipAutoStart = false) {
    if (!playlist) return;

    const requestId = ++currentPlaylistRequestId;
    const startTime = Date.now();

    const plUrl = playlist.youtube_playlist_url || '';
    const match = plUrl.match(/[?&]list=([^#&?]+)/);
    const listId = match ? match[1] : plUrl;
    const cacheKey = playlist.id || listId;

    const refreshStatusEl = document.getElementById('refresh-playlist-status') || document.getElementById('sync-playlist-status');
    const refreshIconEl = document.querySelector('.refresh-icon') || document.querySelector('.sync-icon');

    if (isManualTrigger && refreshStatusEl) {
      refreshStatusEl.textContent = 'Refreshing...';
      refreshIconEl?.classList.add('animate-spin');
    }

    // --- STEP 1: INSTANT SWR CACHE HYDRATION ---
    // If cached tracks exist, display them immediately in 0ms so user never waits on slow 3G/4G
    const cachedTracks = cacheKey ? PlaylistCacheEngine.get(cacheKey) : null;
    const hasCachedTracks = Array.isArray(cachedTracks) && cachedTracks.length > 0;

    if (hasCachedTracks) {
      // Canonical reconciliation: preserve the ACTUAL video loaded in the
      // player. Never blindly reset to index 0 on boot or background sync.
      const actualVideoId = getActualPlayingVideoId();
      const activeVideoId = actualVideoId
        || extractCleanYouTubeId((state.tracks && state.tracks[state.currentIndex] && state.tracks[state.currentIndex].id) || '');
      state.tracks = cachedTracks;
      const activeIdx = findTrackIndexByVideoId(cachedTracks, activeVideoId);
      state.currentIndex = activeIdx >= 0 ? activeIdx : 0;
      setupCardsInitial();
      updateDockUI();
      // Autostart only when the player holds no user-paused song (fresh boot).
      // The index now points at the reconciled track, so this loads the SAME
      // video the player was already cued with — playback and UI stay locked.
      // NEVER autostart from the initial boot hydration (skipAutoStart) — that
      // would force the YouTube iframe to expand before any user gesture,
      // causing layout shifts and blocked-playback churn.
      if (!state.isPlaying && !isPlayerLoadedButPaused() && !skipAutoStart) {
        playCurrent();
      }
      if (!isManualTrigger) {
        setPlaylistLoadingState(false);
      }
    } else {
      // If we don't have cached tracks for this playlist yet, keep existing seed tracks rendered
      if (!state.tracks || state.tracks.length === 0) {
        setPlaylistLoadingState(true, playlist.name, isManualTrigger);
      } else {
        setPlaylistLoadingState(false);
      }
    }

    // --- STEP 2: BACKGROUND REVALIDATION FROM INSFORGE BAAS ---
    let runtimeTracks = [];
    if (playlist.id && playlist.id !== 'default') {
      try {
        let allSongs = [];
        let offset = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const res = await insforgeFetch(`/api/database/records/playlist_songs?playlist_id=eq.${encodeURIComponent(playlist.id)}&order=display_order.asc&limit=${pageSize}&offset=${offset}`);
          if (res.ok) {
            const pageSongs = await res.json();
            if (Array.isArray(pageSongs) && pageSongs.length > 0) {
              allSongs = allSongs.concat(pageSongs);
              if (pageSongs.length < pageSize) {
                hasMore = false;
              } else {
                offset += pageSize;
              }
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }

        if (allSongs.length > 0) {
          runtimeTracks = allSongs.map((s, idx) => ({
            id: s.youtube_id,
            title: s.title || 'Unknown Title',
            artist: s.artist || 'Odia Artist',
            thumbnail: normalizeThumbnailUrl(s.thumbnail, s.youtube_id),
            playlistId: playlist.id,
            position: idx + 1
          }));
          PlaylistCacheEngine.set(cacheKey, runtimeTracks);
        }
      } catch (e) {
        console.warn('[Playlists] InsForge database fetch notice (offline/slow connection):', e);
      }
    }

    // --- STEP 3: OPTIONAL DIRECT YOUTUBE API FALLBACK (if configured) ---
    if (runtimeTracks.length === 0 && listId) {
      const apiKey = (typeof window !== 'undefined' && (
        window.__ENV__?.YOUTUBE_API_KEY ||
        window.ENV?.YOUTUBE_API_KEY ||
        localStorage.getItem('odiverse_yt_api_key')
      )) || '';

      if (apiKey) {
        try {
          const ytTracks = await fetchViaYouTubeDataAPI(listId, apiKey);
          if (ytTracks && ytTracks.length > 0) {
            runtimeTracks = ytTracks.map((yt, idx) => ({
              id: yt.id,
              title: yt.title,
              artist: yt.artist || 'Odia Artist',
              thumbnail: normalizeThumbnailUrl(yt.thumbnail, yt.id),
              playlistId: playlist.id,
              position: idx + 1
            }));
            PlaylistCacheEngine.set(cacheKey, runtimeTracks);
          }
        } catch (err) {
          console.warn('[Sync] YouTube Data API query notice:', err);
        }
      }
    }

    // --- STEP 4: NEVER DESTROY GOOD DATA ON NETWORK FAILURE ---
    if (runtimeTracks.length === 0) {
      if (hasCachedTracks) {
        runtimeTracks = cachedTracks; // Preserve existing cached tracks
      } else if (state.tracks && state.tracks.length > 0 && state.currentPlaylist?.id === playlist.id) {
        runtimeTracks = state.tracks; // Preserve existing memory state
      } else {
        // Safe offline seed tracks only if completely empty cold-start with no cache and offline
        const fallbackTracks = [
          { id: '3:59 AM', title: '3:59 AM', artist: 'DIVINE', thumbnail: 'favicon.png' },
          { id: 'Winning Speech', title: 'Winning Speech', artist: 'Karan Aujla', thumbnail: 'favicon.png' }
        ];
        runtimeTracks = fallbackTracks.map((t, idx) => ({
          ...t,
          playlistId: playlist.id || 'default',
          position: idx + 1
        }));
      }
    }

    if (requestId !== currentPlaylistRequestId) return;

    // --- STEP 5: APPLY FRESH DATA TO STATE & UI ---
    if (runtimeTracks.length > 0) {
      const isTracksDifferent = !state.tracks || state.tracks.length !== runtimeTracks.length || (state.tracks[0]?.id !== runtimeTracks[0]?.id) || isManualTrigger;
      if (isTracksDifferent || !state.isPlaying) {
        // Canonical reconciliation: the ACTUAL YouTube video wins over any
        // stale/default state index (seed or cache).
        const actualVideoId = getActualPlayingVideoId();
        const activeVideoId = actualVideoId
          || extractCleanYouTubeId((state.tracks && state.tracks[state.currentIndex] && state.tracks[state.currentIndex].id) || '');
        const wasPlayingActualVideo = Boolean(actualVideoId) && state.isPlaying;
        state.tracks = runtimeTracks;
        const activeIdx = findTrackIndexByVideoId(runtimeTracks, activeVideoId);
        state.currentIndex = activeIdx >= 0 ? activeIdx : 0;
        setupCardsInitial();
        updateDockUI();
        if (!state.isPlaying && !isPlayerLoadedButPaused() && !skipAutoStart) {
          // Playlist switch / revalidation with nothing loaded -> load
          // reconciled track (index already points at the cued video).
          // Skipped during initial boot hydration to keep the player idle
          // until the user interacts (no autoplay-attempt layout shifts).
          playCurrent();
        } else if (wasPlayingActualVideo && activeIdx < 0) {
          // The song that was ACTUALLY playing was deleted/reordered away by
          // the remote playlist -> fall back to track 0 on player AND UI.
          playCurrent();
        }
      }
      setPlaylistLoadingState(false);
    } else {
      showPlaylistLoadingError(playlist.name);
    }

    if (isManualTrigger && refreshStatusEl) {
      refreshIconEl?.classList.remove('animate-spin');
      if (runtimeTracks.length > 0) {
        refreshStatusEl.textContent = `Playlist ready — ${runtimeTracks.length} tracks`;
      } else {
        refreshStatusEl.textContent = `Offline — using cached tracks`;
      }
      setTimeout(() => {
        if (refreshStatusEl) refreshStatusEl.textContent = 'Refresh Playlist';
      }, 3500);
    }
  }

  // Explicit user-triggered refresh & YouTube sync
  async function refreshCurrentPlaylist() {
    if (!state.currentPlaylist) return;
    const plUrl = state.currentPlaylist.youtube_playlist_url || '';
    const match = plUrl.match(/[?&]list=([^#&?]+)/);
    const listId = match ? match[1] : plUrl;
    const cacheKey = state.currentPlaylist.id || listId;

    const refreshStatusEl = document.getElementById('refresh-playlist-status') || document.getElementById('sync-playlist-status');
    const refreshIconEl = document.querySelector('.refresh-icon') || document.querySelector('.sync-icon');

    if (refreshStatusEl) refreshStatusEl.textContent = 'Syncing YouTube...';
    refreshIconEl?.classList.add('animate-spin');

    let syncStats = null;
    try {
      // 1. Authoritative Backend Synchronization from YouTube to InsForge
      if (state.currentPlaylist.id) {
        try {
          const syncRes = await fetch(`${API_BASE}/api/playlists/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist_id: state.currentPlaylist.id })
          });
          const syncData = await syncRes.json();
          if (syncData && syncData.results && syncData.results[0]) {
            syncStats = syncData.results[0].stats;
            console.log('[Sync] Backend sync result for playlist:', state.currentPlaylist.name, syncStats);
          }
        } catch (syncErr) {
          console.warn('[Sync] Backend sync notice, loading cached/database tracks:', syncErr);
        }
      }

      // 2. Invalidate cache in memory & localStorage
      if (cacheKey) {
        PlaylistCacheEngine.invalidate(cacheKey);
      }

      // 3. Load freshly reconciled songs into player & UI
      await loadPlaylistSongs(state.currentPlaylist, true, true);

      // 4. Update status display with actual sync results
      if (refreshStatusEl && syncStats) {
        if (syncStats.added > 0 || syncStats.removed > 0) {
          refreshStatusEl.textContent = `Synced: +${syncStats.added} -${syncStats.removed} (${syncStats.total} total)`;
        } else {
          refreshStatusEl.textContent = `Synced — ${syncStats.total} tracks (up to date)`;
        }
      }
    } finally {
      refreshIconEl?.classList.remove('animate-spin');
    }
  }

  // --- YouTube IFrame API ---
  let ytApiInjected = false;
  function initYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      createYTPlayer();
      initBgYouTubePlayerIfPending();
    } else {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      window.onYouTubeIframeAPIReady = function () {
        createYTPlayer();
        initBgYouTubePlayerIfPending();
      };
    }
  }

  function createYTPlayer() {
    const curTrack = state.tracks[state.currentIndex] || { id: "thS3-dmUvlg" };
    state.ytPlayer = new YT.Player('yt-player', {
      height: '180',
      width: '320',
      videoId: extractCleanYouTubeId(curTrack.id) || curTrack.id,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  }

  function onPlayerReady(event) {
    state.isPlayerReady = true;
    try {
      event.target.setVolume(state.volume * 100);
    } catch (e) {}

    reconcileCurrentTrack(true);

    if (state.pendingAction === 'play') {
      state.pendingAction = null;
      playCurrent();
    }
  }

  // ============================================================
  // AUTHORITATIVE PLAYBACK REQUEST GENERATION & RACE-GUARD ENGINE
  // Prevents stale YouTube player ENDED events from advancing on Previous/Next clicks
  // ============================================================
  let playbackRequestId = 0;
  let manualNavTimestamp = 0;
  const shuffleHistory = [];
  let shuffleHistoryIndex = -1;

  function onPlayerStateChange(event) {
    const curTrack = state.tracks[state.currentIndex];
    const curReqId = playbackRequestId;
    const pState = event ? event.data : -1;

    console.log('[GULLYGANG] YOUTUBE STATE', {
      state: pState,
      videoId: curTrack?.id,
      title: curTrack?.title
    });

    if (pState === 1) { // PLAYING
      state.isPlaying = true;
      setPlayState(true);
      startProgressTracker();
      reconcileCurrentTrack(true);
    } else if (pState === 2) { // PAUSED
      state.isPlaying = false;
      setPlayState(false);
      stopProgressTracker();
    } else if (pState === 3) { // BUFFERING
      state.isPlaying = true;
      setPlayState(true);
    } else if (pState === 5) { // CUED
      // Video is cued and ready — lock UI metadata to the cued video
      reconcileCurrentTrack(true);
    } else if (pState === 0) { // ENDED
      // 1. Stale Transition Guard: Ignore ENDED events emitted during manual navigation (cooldown 1200ms)
      const timeSinceManualNav = Date.now() - manualNavTimestamp;
      if (timeSinceManualNav < 1200) {
        return;
      }

      // 2. Video ID Verification: Ensure the ended video matches the currently active track ID
      try {
        if (state.ytPlayer && typeof state.ytPlayer.getVideoData === 'function') {
          const videoData = state.ytPlayer.getVideoData();
          if (videoData && videoData.video_id && curTrack && videoData.video_id !== curTrack.id) {
            return; // Stale event from a prior unloaded track
          }
        }
      } catch (e) {}

      // 3. Request Generation Guard: Invalidate if a newer playback request was made
      if (curReqId !== playbackRequestId) {
        return;
      }

      // 4. Repeat 'one' mode
      if (state.repeatMode === 'one') {
        try {
          state.ytPlayer.seekTo(0);
          state.ytPlayer.playVideo();
        } catch (e) {
          playCurrent();
        }
      } else {
        // Natural track completion -> Advance to next track
        console.log('[GULLYGANG] Natural ENDED for:', curTrack?.title);
        playNext(1, false);
      }
    }
  }

  function onPlayerError(event) {
    const errorCode = event ? event.data : -1;
    const curTrack = state.tracks[state.currentIndex];
    const errReqId = playbackRequestId;
    const timeSinceManualNav = Date.now() - manualNavTimestamp;

    const ERROR_MESSAGES = {
      2: 'Invalid video parameter or malformed video ID',
      5: 'HTML5 player playback error',
      100: 'Video unavailable or removed from YouTube',
      101: 'Embed playback restricted by video owner',
      150: 'Embed playback restricted by video owner',
      153: 'Missing client identity / embed restriction'
    };

    const errorDesc = ERROR_MESSAGES[errorCode] || `Playback error (${errorCode})`;
    console.warn('[GULLYGANG] YOUTUBE ERROR', {
      errorCode,
      errorDesc,
      videoId: curTrack?.id,
      title: curTrack?.title,
      artist: curTrack?.artist,
      requestId: errReqId,
      timeSinceManualNav
    });

    if (curTrack) {
      curTrack._isUnavailable = true;
    }

    // Update Dock UI to indicate unavailable state without freezing at 0:00 / 0:00
    if (DOM.dockTimeCombined) {
      DOM.dockTimeCombined.textContent = 'Unavailable';
    }
    if (DOM.dockDuration) {
      DOM.dockDuration.textContent = 'Unavailable';
    }

    // Auto-skip gracefully after a brief 1.4s notice so user sees why it skipped
    setTimeout(() => {
      if (errReqId === playbackRequestId) {
        console.log('[GULLYGANG] Skipping unplayable track to next track...');
        playNext(1, false);
      }
    }, 1400);
  }

  // --- 3D Spatial Cover Flow Engine ---
  function getTrackAtOffset(offset) {
    const len = state.tracks.length;
    if (len === 0) return null;
    let idx = (state.currentIndex + offset) % len;
    if (idx < 0) idx += len;
    return state.tracks[idx];
  }

  function populateCardContent(cardEl, track) {
    if (!cardEl || !track) return;
    const img = cardEl.querySelector('.card-cover');
    const title = cardEl.querySelector('.card-title');
    const artist = cardEl.querySelector('.card-artist');

    const thumb = getTrackArtworkUrl(track);
    if (img) {
      setupImageWithWaterfall(img, track);
    }
    if (title) title.textContent = track.title;
    if (artist) artist.textContent = track.artist;

    // Subtle artwork-derived gradient tint on card surface (deferred / non-blocking)
    ArtworkColorEngine.extractPalette(thumb, track.title || track.id).then(palette => {
      if (palette && palette.dominant && cardEl) {
        cardEl.style.setProperty('--card-glow-color', palette.accent);
        cardEl.style.setProperty('--card-ambient-bg', palette.darkBase);
      }
    }).catch(() => {});
  }

  function setupCardsInitial(priorityCenterOnly = false) {
    // 1. Center Active Card (LCP Target) - Synchronous instant render with high priority
    populateCardContent(cardRing[2], getTrackAtOffset(0));

    // 2. Off-screen Flanks - Synchronous or deferred during cold initial boot to preserve 100% bandwidth for LCP
    const renderFlanks = () => {
      populateCardContent(cardRing[0], getTrackAtOffset(-2));
      populateCardContent(cardRing[1], getTrackAtOffset(-1));
      populateCardContent(cardRing[3], getTrackAtOffset(1));
      populateCardContent(cardRing[4], getTrackAtOffset(2));
      for (let i = 0; i < 5; i++) {
        cardRing[i].setAttribute('data-pos', POS_NAMES[i]);
      }
    };

    if (priorityCenterOnly) {
      cardRing[2].setAttribute('data-pos', 'current');
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(renderFlanks, { timeout: 300 });
      } else {
        setTimeout(renderFlanks, 150);
      }
    } else {
      renderFlanks();
    }
    updateDockUI();
  }

  function slideCardsForward(steps = 1) {
    for (let s = 0; s < steps; s++) {
      const exitingCard = cardRing.shift();
      cardRing.push(exitingCard);
    }
    for (let i = 0; i < 5; i++) {
      const offset = i - 2;
      populateCardContent(cardRing[i], getTrackAtOffset(offset));
      cardRing[i].setAttribute('data-pos', POS_NAMES[i]);
    }
  }

  function slideCardsBackward(steps = 1) {
    for (let s = 0; s < steps; s++) {
      const exitingCard = cardRing.pop();
      cardRing.unshift(exitingCard);
    }
    for (let i = 0; i < 5; i++) {
      const offset = i - 2;
      populateCardContent(cardRing[i], getTrackAtOffset(offset));
      cardRing[i].setAttribute('data-pos', POS_NAMES[i]);
    }
  }

  // Redundant-render guard: the exact same track object already painted on
  // the dock. Prevents 0:00 resets / thumbnail waterfall re-trigger flashes
  // when multiple boot paths (seed, cache, remote) render the same track.
  let lastDockTrackRef = null;

  function updateDockUI() {
    const curTrack = state.tracks[state.currentIndex];
    if (!curTrack) return;

    if (lastDockTrackRef === curTrack) return;
    lastDockTrackRef = curTrack;

    if (DOM.dockTitle) DOM.dockTitle.textContent = curTrack.title;
    if (DOM.dockArtist) DOM.dockArtist.textContent = curTrack.artist;

    const mobTitle = document.getElementById('dock-title-mobile');
    const mobArtist = document.getElementById('dock-artist-mobile');
    if (mobTitle) mobTitle.textContent = curTrack.title;
    if (mobArtist) mobArtist.textContent = curTrack.artist;

    // Floating stage song info (below carousel)
    const stageSongTitle = document.getElementById('stage-song-title');
    const stageSongArtist = document.getElementById('stage-song-artist');
    if (stageSongTitle) stageSongTitle.textContent = curTrack.title;
    if (stageSongArtist) stageSongArtist.textContent = curTrack.artist;

    const artworkUrl = getTrackArtworkUrl(curTrack);
    if (DOM.dockThumb) {
      setupImageWithWaterfall(DOM.dockThumb, curTrack);
    }
    const mobThumb = document.getElementById('dock-thumb-mobile');
    if (mobThumb) {
      setupImageWithWaterfall(mobThumb, curTrack);
    }
    if (DOM.dockTimeCombined) DOM.dockTimeCombined.textContent = '0:00 / --:--';

    // Trigger Dynamic Artwork Background Update on song change
    updateDynamicArtworkBackground(curTrack);

    // Synchronize OS-level Lock Screen & Notification Center MediaSession
    updateMediaSessionMetadata(curTrack);
  }

  function updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      const artworkUrl = getTrackArtworkUrl(track);
      const ytId = track.id || track.youtubeId || track.youtube_id;
      const artworkList = [];
      if (artworkUrl) {
        artworkList.push({ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' });
      }
      if (ytId) {
        artworkList.push({ src: `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' });
        artworkList.push({ src: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' });
        artworkList.push({ src: `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' });
      }
      artworkList.push({ src: 'favicon.png', sizes: '512x512', type: 'image/png' });

      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Untitled Track',
        artist: track.artist || 'GULLYGANG',
        album: state.currentPlaylist?.name ? `GULLYGANG — ${state.currentPlaylist.name}` : 'GULLYGANG',
        artwork: artworkList
      });
      navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    } catch (e) {
      console.warn('[MediaSession] Metadata update error:', e);
    }
  }

  function updateMediaSessionPosition(position, duration) {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    try {
      if (typeof duration === 'number' && duration > 0 && typeof position === 'number' && position >= 0 && position <= duration) {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: 1,
          position: position
        });
      }
    } catch (e) {}
  }

  function setPlayState(playing) {
    const playSvg = `<path d="M8 5v14l11-7z"/>`;
    const pauseSvg = `<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>`;

    if (DOM.playIcon) DOM.playIcon.innerHTML = playing ? pauseSvg : playSvg;
    const playIconMob = document.getElementById('play-icon-mobile');
    if (playIconMob) playIconMob.innerHTML = playing ? pauseSvg : playSvg;

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      } catch (e) {}
    }

    if (window.WeatherEffects) {
      window.WeatherEffects.setMusicPlaying(playing);
    }
  }

  // --- Authoritative Single-Path Playback Navigation Engine ---
  function loadTrackAtIndex(targetIndex, isManualUserAction = false, direction = 'next') {
    if (!state.tracks || state.tracks.length === 0) return;

    const reqId = ++playbackRequestId;
    if (isManualUserAction) {
      manualNavTimestamp = Date.now();
    }

    const prevIndex = state.currentIndex;
    state.currentIndex = targetIndex;

    // Maintain shuffle history stack
    if (state.isShuffle && isManualUserAction) {
      if (direction === 'next' || direction === 'direct') {
        if (shuffleHistoryIndex < shuffleHistory.length - 1) {
          shuffleHistory.splice(shuffleHistoryIndex + 1);
        }
        shuffleHistory.push(targetIndex);
        shuffleHistoryIndex = shuffleHistory.length - 1;
      }
    }

    const track = state.tracks[state.currentIndex];
    if (!track) return;

    // IDEMPOTENCY GUARD: if the player is ALREADY actively playing/buffering
    // this exact video (e.g. playCurrent() re-fired by hydration paths while
    // the same track is live), do not restart it. Cued/paused states still
    // fall through so pendingAction autoplay and resume behavior is preserved.
    if (targetIndex === state.currentIndex && direction === 'direct') {
      if (state.isPlayerReady && state.ytPlayer) {
        try {
          const liveState = typeof state.ytPlayer.getPlayerState === 'function' ? state.ytPlayer.getPlayerState() : -1;
          if (liveState === 1 || liveState === 3) { // PLAYING or BUFFERING
            const videoData = typeof state.ytPlayer.getVideoData === 'function' ? state.ytPlayer.getVideoData() : null;
            const trackId = extractCleanYouTubeId(track.id || track.youtubeId || track.youtube_id) || track.id;
            if (videoData && videoData.video_id === trackId) {
              return; // Player already owns this video — UI already in sync
            }
          }
        } catch (e) {}
      }
    }

    // 1. Sanitize canonical YouTube video ID
    const cleanId = extractCleanYouTubeId(track.id || track.youtubeId || track.youtube_id);
    track.id = cleanId || track.id;

    console.log('[GULLYGANG] PLAY REQUEST', {
      title: track.title,
      artist: track.artist,
      videoId: track.id,
      requestId: reqId
    });

    // 2. Update 3D Carousel Cards with directional sliding animation
    if (direction === 'next') {
      const steps = ((targetIndex - prevIndex + state.tracks.length) % state.tracks.length) || 1;
      slideCardsForward(Math.min(steps, 2));
    } else if (direction === 'prev') {
      const steps = ((prevIndex - targetIndex + state.tracks.length) % state.tracks.length) || 1;
      slideCardsBackward(Math.min(steps, 2));
    } else {
      setupCardsInitial();
    }

    // 3. Update Dock UI, Stage Info, and Ambient Artwork Background
    updateDockUI();

    // Reset progress track to loading state
    if (DOM.dockFill) DOM.dockFill.style.width = '0%';
    if (DOM.dockThumbHandle) DOM.dockThumbHandle.style.left = '0%';
    if (DOM.dockCurrentTime) DOM.dockCurrentTime.textContent = '0:00';
    if (DOM.dockDuration) DOM.dockDuration.textContent = '0:00';
    if (DOM.dockTimeCombined) DOM.dockTimeCombined.textContent = '0:00 / 0:00';
    if (DOM.dockRail) {
      DOM.dockRail.setAttribute('aria-valuenow', '0');
      DOM.dockRail.setAttribute('aria-valuetext', '0:00');
    }

    trackEvent('song_played', {
      title: track.title,
      artist: track.artist,
      playlist: state.currentPlaylist?.name || 'Default',
      song_id: track.id
    });

    // 4. Load & play on YouTube player
    if (state.isPlayerReady && state.ytPlayer) {
      try {
        if (typeof state.ytPlayer.loadVideoById === 'function') {
          state.ytPlayer.loadVideoById(cleanId, 0);
        } else if (typeof state.ytPlayer.cueVideoById === 'function') {
          state.ytPlayer.cueVideoById(cleanId, 0);
          state.ytPlayer.playVideo();
        }
        state.isPlaying = true;
        setPlayState(true);
        startProgressTracker();
      } catch (err) {
        console.warn('[Player] loadVideoById error:', err);
      }
    } else {
      state.pendingAction = 'play';
      state.isPlaying = true;
      setPlayState(true);
    }
  }

  function togglePlay() {
    if (!state.isPlayerReady || !state.ytPlayer) {
      state.pendingAction = 'play';
      state.isPlaying = true;
      setPlayState(true);
      return;
    }

    try {
      const pState = typeof state.ytPlayer.getPlayerState === 'function' ? state.ytPlayer.getPlayerState() : -1;
      if (state.isPlaying || pState === 1) {
        state.ytPlayer.pauseVideo();
        state.isPlaying = false;
        setPlayState(false);
        stopProgressTracker();
      } else {
        if (typeof state.ytPlayer.playVideo === 'function') {
          state.ytPlayer.playVideo();
          state.isPlaying = true;
          setPlayState(true);
          startProgressTracker();
        } else {
          playCurrent();
        }
      }
    } catch (e) {
      playCurrent();
    }
  }

  function playCurrent() {
    loadTrackAtIndex(state.currentIndex, true, 'direct');
  }

  function playNext(steps = 1, isManual = true) {
    if (!state.tracks || state.tracks.length === 0) return;

    let targetIndex;
    if (state.isShuffle) {
      if (shuffleHistoryIndex < shuffleHistory.length - 1) {
        shuffleHistoryIndex++;
        targetIndex = shuffleHistory[shuffleHistoryIndex];
      } else {
        let randIdx = Math.floor(Math.random() * state.tracks.length);
        if (randIdx === state.currentIndex && state.tracks.length > 1) {
          randIdx = (randIdx + 1) % state.tracks.length;
        }
        targetIndex = randIdx;
      }
    } else {
      // Repeat off guard at end of playlist
      if (!isManual && state.repeatMode === 'off' && state.currentIndex === state.tracks.length - 1) {
        state.isPlaying = false;
        setPlayState(false);
        stopProgressTracker();
        return;
      }
      targetIndex = (state.currentIndex + steps) % state.tracks.length;
    }

    loadTrackAtIndex(targetIndex, isManual, 'next');
  }

  function playPrev(steps = 1, isManual = true) {
    if (!state.tracks || state.tracks.length === 0) return;

    let targetIndex;
    if (state.isShuffle) {
      if (shuffleHistoryIndex > 0) {
        shuffleHistoryIndex--;
        targetIndex = shuffleHistory[shuffleHistoryIndex];
      } else {
        targetIndex = (state.currentIndex - steps + state.tracks.length) % state.tracks.length;
      }
    } else {
      targetIndex = (state.currentIndex - steps + state.tracks.length) % state.tracks.length;
    }

    loadTrackAtIndex(targetIndex, isManual, 'prev');
  }

  function handleCardClick(cardEl) {
    const pos = cardEl.getAttribute('data-pos');
    if (pos === 'current') {
      togglePlay();
    } else if (pos === 'next-1') {
      playNext(1, true);
    } else if (pos === 'next-2') {
      playNext(2, true);
    } else if (pos === 'previous-1') {
      playPrev(1, true);
    } else if (pos === 'previous-2') {
      playPrev(2, true);
    }
  }

  // --- Progress Tracking & Seeking ---
  function updateProgressUI() {
    if (!state.isPlayerReady || !state.ytPlayer || state.isSeeking) return;
    try {
      const cur = typeof state.ytPlayer.getCurrentTime === 'function' ? state.ytPlayer.getCurrentTime() : 0;
      const dur = typeof state.ytPlayer.getDuration === 'function' ? state.ytPlayer.getDuration() : 0;

      if (dur > 0) {
        const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
        const pctStr = `${pct.toFixed(2)}%`;
        if (DOM.dockFill) DOM.dockFill.style.width = pctStr;
        if (DOM.dockThumbHandle) DOM.dockThumbHandle.style.left = pctStr;
        if (DOM.dockCurrentTime) DOM.dockCurrentTime.textContent = formatTime(cur);
        if (DOM.dockDuration) DOM.dockDuration.textContent = formatTime(dur);
        if (DOM.dockTimeCombined) DOM.dockTimeCombined.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        if (DOM.dockRail) {
          DOM.dockRail.setAttribute('aria-valuenow', Math.round(pct));
          DOM.dockRail.setAttribute('aria-valuetext', `${formatTime(cur)} of ${formatTime(dur)}`);
        }
        updateMediaSessionPosition(cur, dur);
      } else {
        // Duration pending / initializing
        if (DOM.dockFill) DOM.dockFill.style.width = '0%';
        if (DOM.dockThumbHandle) DOM.dockThumbHandle.style.left = '0%';
        if (DOM.dockCurrentTime) DOM.dockCurrentTime.textContent = formatTime(cur);
        if (DOM.dockDuration) DOM.dockDuration.textContent = '0:00';
        if (DOM.dockTimeCombined) DOM.dockTimeCombined.textContent = `${formatTime(cur)} / 0:00`;
      }
    } catch (e) {}
  }

  function seekToTime(targetSeconds) {
    if (!state.isPlayerReady || !state.ytPlayer) return;
    try {
      const dur = typeof state.ytPlayer.getDuration === 'function' ? state.ytPlayer.getDuration() : 0;
      const safeTarget = Math.max(0, Math.min(dur > 0 ? dur : targetSeconds, targetSeconds));
      if (typeof state.ytPlayer.seekTo === 'function') {
        state.ytPlayer.seekTo(safeTarget, true);
        if (dur > 0) {
          const pct = Math.max(0, Math.min(100, (safeTarget / dur) * 100));
          const pctStr = `${pct.toFixed(2)}%`;
          if (DOM.dockFill) DOM.dockFill.style.width = pctStr;
          if (DOM.dockThumbHandle) DOM.dockThumbHandle.style.left = pctStr;
          if (DOM.dockCurrentTime) DOM.dockCurrentTime.textContent = formatTime(safeTarget);
          if (DOM.dockRail) {
            DOM.dockRail.setAttribute('aria-valuenow', Math.round(pct));
            DOM.dockRail.setAttribute('aria-valuetext', `${formatTime(safeTarget)} of ${formatTime(dur)}`);
          }
        }
        updateMediaSessionPosition(safeTarget, dur);
      }
    } catch (e) {}
  }

  function seekBy(deltaSeconds) {
    if (!state.isPlayerReady || !state.ytPlayer) return;
    try {
      const cur = typeof state.ytPlayer.getCurrentTime === 'function' ? state.ytPlayer.getCurrentTime() : 0;
      seekToTime(cur + deltaSeconds);
    } catch (e) {}
  }

  function startProgressTracker() {
    stopProgressTracker();
    if (document.hidden) return; // Suspend DOM updates when tab is hidden
    updateProgressUI();
    const isMobile = window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    const intervalMs = isMobile ? 350 : 250;
    state.progressTimer = setInterval(() => {
      if (document.hidden) return;
      updateProgressUI();
    }, intervalMs);
  }

  function stopProgressTracker() {
    if (state.progressTimer) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }

  // --- Foreground & Lifecycle State Reconciler ---
  function reconcilePlaybackOnForeground() {
    if (!state.isPlayerReady || !state.ytPlayer) return;
    try {
      const pState = typeof state.ytPlayer.getPlayerState === 'function' ? state.ytPlayer.getPlayerState() : -1;
      if (pState === 1) { // Playing
        state.isPlaying = true;
        setPlayState(true);
        startProgressTracker();
        updateProgressUI();
      } else if (pState === 2 || pState === 0 || pState === 5 || pState === -1) {
        // Paused, cued, or suspended by browser
        state.isPlaying = false;
        setPlayState(false);
        stopProgressTracker();
        updateProgressUI();
      }

      const curTrack = state.tracks[state.currentIndex];
      if (curTrack) {
        updateMediaSessionMetadata(curTrack);
      }
    } catch (e) {}
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  function handleSeek(e) {
    if (!state.isPlayerReady || !state.ytPlayer || !DOM.dockRail) return;
    const rect = DOM.dockRail.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = clickX / rect.width;
    const dur = typeof state.ytPlayer.getDuration === 'function' ? state.ytPlayer.getDuration() : 0;

    if (dur > 0) {
      seekToTime(dur * pct);
    }
  }

  function attachSeekSliderListeners() {
    const rail = DOM.dockRail;
    if (!rail) return;

    function getSeekPercentage(e) {
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return offsetX / rect.width;
    }

    function updateVisualSeek(pct) {
      const clampedPct = Math.max(0, Math.min(1, pct));
      const dur = (state.isPlayerReady && state.ytPlayer && typeof state.ytPlayer.getDuration === 'function')
        ? state.ytPlayer.getDuration()
        : 0;

      const pctStr = `${(clampedPct * 100).toFixed(2)}%`;
      if (DOM.dockFill) DOM.dockFill.style.width = pctStr;
      if (DOM.dockThumbHandle) DOM.dockThumbHandle.style.left = pctStr;

      if (dur > 0) {
        const previewSec = dur * clampedPct;
        if (DOM.dockCurrentTime) DOM.dockCurrentTime.textContent = formatTime(previewSec);
        rail.setAttribute('aria-valuenow', Math.round(clampedPct * 100));
        rail.setAttribute('aria-valuetext', `${formatTime(previewSec)} of ${formatTime(dur)}`);
      }
    }

    rail.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.isSeeking = true;
      rail.classList.add('is-dragging');
      try {
        rail.setPointerCapture(e.pointerId);
      } catch (err) {}

      const pct = getSeekPercentage(e);
      updateVisualSeek(pct);
    });

    rail.addEventListener('pointermove', (e) => {
      if (!state.isSeeking) return;
      e.preventDefault();
      const pct = getSeekPercentage(e);
      updateVisualSeek(pct);
    });

    const handlePointerEnd = (e) => {
      if (!state.isSeeking) return;
      state.isSeeking = false;
      rail.classList.remove('is-dragging');
      try {
        rail.releasePointerCapture(e.pointerId);
      } catch (err) {}

      const pct = getSeekPercentage(e);
      const dur = (state.isPlayerReady && state.ytPlayer && typeof state.ytPlayer.getDuration === 'function')
        ? state.ytPlayer.getDuration()
        : 0;

      if (dur > 0) {
        seekToTime(dur * pct);
      }
    };

    rail.addEventListener('pointerup', handlePointerEnd);
    rail.addEventListener('pointercancel', handlePointerEnd);

    // Keyboard accessibility for desktop
    rail.addEventListener('keydown', (e) => {
      const dur = (state.isPlayerReady && state.ytPlayer && typeof state.ytPlayer.getDuration === 'function')
        ? state.ytPlayer.getDuration()
        : 0;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        seekBy(-5);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        seekBy(5);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seekToTime(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        if (dur > 0) seekToTime(Math.max(0, dur - 0.5));
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        togglePlay();
      }
    });
  }

  // --- Volume & Controls ---
  function toggleMute() {
    state.isMuted = !state.isMuted;
    if (state.isPlayerReady && state.ytPlayer) {
      try {
        if (state.isMuted) state.ytPlayer.mute();
        else {
          state.ytPlayer.unMute();
          state.ytPlayer.setVolume(state.volume * 100);
        }
      } catch (e) {}
    }
    const volColor = state.isMuted ? 'rgba(255,255,255,0.4)' : '#ffffff';
    if (DOM.volIcon) DOM.volIcon.style.color = volColor;
  }

  function toggleVolSlider(e) {
    if (e) e.stopPropagation();
    state.isVolSliderOpen = !state.isVolSliderOpen;

    const rightControls = document.getElementById('player-right-controls');
    const subActions = document.getElementById('sub-actions-group');
    const volSlider = document.getElementById('vol-slider');
    const mobVolWrapper = document.getElementById('mobile-vol-wrapper');
    const mobVolSlider = document.getElementById('vol-slider-mobile');

    if (rightControls) {
      rightControls.classList.toggle('is-vol-open', state.isVolSliderOpen);
    }
    if (mobVolWrapper) {
      mobVolWrapper.classList.toggle('is-vol-open', state.isVolSliderOpen);
    }
    if (subActions) {
      if (state.isVolSliderOpen) {
        subActions.classList.add('hidden');
        subActions.style.display = 'none';
      } else {
        subActions.classList.remove('hidden');
        subActions.style.display = '';
      }
    }
    if (volSlider) {
      volSlider.classList.toggle('hidden', !state.isVolSliderOpen);
      if (state.isVolSliderOpen) {
        volSlider.style.display = 'block';
      } else {
        volSlider.style.display = 'none';
      }
    }
    if (mobVolSlider) {
      mobVolSlider.classList.toggle('hidden', !state.isVolSliderOpen);
      if (state.isVolSliderOpen) {
        mobVolSlider.style.display = 'block';
        mobVolSlider.focus();
      } else {
        mobVolSlider.style.display = 'none';
      }
    }
  }

  function closeVolSlider() {
    if (state.isVolSliderOpen) {
      state.isVolSliderOpen = false;
      const rightControls = document.getElementById('player-right-controls');
      const subActions = document.getElementById('sub-actions-group');
      const volSlider = document.getElementById('vol-slider');
      const mobVolWrapper = document.getElementById('mobile-vol-wrapper');
      const mobVolSlider = document.getElementById('vol-slider-mobile');

      if (rightControls) rightControls.classList.remove('is-vol-open');
      if (mobVolWrapper) mobVolWrapper.classList.remove('is-vol-open');
      if (subActions) {
        subActions.classList.remove('hidden');
        subActions.style.display = '';
      }
      if (volSlider) {
        volSlider.classList.add('hidden');
        volSlider.style.display = 'none';
      }
      if (mobVolSlider) {
        mobVolSlider.classList.add('hidden');
        mobVolSlider.style.display = 'none';
      }
    }
  }

  function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    DOM.btnShuffle?.classList.toggle('is-active', state.isShuffle);
    document.getElementById('btn-shuffle-mobile')?.classList.toggle('is-active', state.isShuffle);
    if (state.isShuffle) {
      shuffleHistory.length = 0;
      shuffleHistory.push(state.currentIndex);
      shuffleHistoryIndex = 0;
    }
  }

  function toggleRepeat() {
    if (state.repeatMode === 'all') {
      state.repeatMode = 'one';
    } else if (state.repeatMode === 'one') {
      state.repeatMode = 'off';
    } else {
      state.repeatMode = 'all';
    }
    const isActive = state.repeatMode !== 'off';
    DOM.btnRepeat?.classList.toggle('is-active', isActive);
    DOM.btnRepeat?.setAttribute('title', `Repeat: ${state.repeatMode}`);
    const mobBtn = document.getElementById('btn-repeat-mobile');
    if (mobBtn) {
      mobBtn.classList.toggle('is-active', isActive);
      mobBtn.setAttribute('title', `Repeat: ${state.repeatMode}`);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ============================================================
  // VIEWPORT-AWARE DROPDOWN POSITIONING ENGINE
  // Intelligently calculates exact trigger anchor coordinates, auto-flips up/down,
  // clamps horizontally within 12px viewport margins, and sets dynamic maxHeight.
  // ============================================================
  const DropdownPositioner = (function () {
    let activeTrigger = null;
    let activeDropdown = null;
    let activeType = null;
    const VIEWPORT_PADDING = 12;
    const ANCHOR_GAP = 8;

    function position(dropdownEl, triggerEl, type = 'playlist') {
      if (!dropdownEl || !triggerEl) return;
      activeDropdown = dropdownEl;
      activeTrigger = triggerEl;
      activeType = type;

      // 1. Ensure dropdown is attached directly to document.body (Portal Layer)
      // This prevents containing-block shifts from parent transforms/perspective/overflows
      if (dropdownEl.parentElement !== document.body) {
        document.body.appendChild(dropdownEl);
      }

      const triggerRect = triggerEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // 2. Prepare dropdown for measurement
      dropdownEl.classList.remove('hidden');
      dropdownEl.style.visibility = 'hidden';
      dropdownEl.style.display = 'block';
      dropdownEl.style.position = 'fixed';
      dropdownEl.style.zIndex = '999999';

      // 3. Constrain max width for mobile & measure dimensions
      const isMobile = viewportWidth < 768;
      const maxAllowedWidth = Math.min(viewportWidth - (VIEWPORT_PADDING * 2), type === 'visuals' ? 300 : 280);
      dropdownEl.style.maxWidth = `${maxAllowedWidth}px`;
      dropdownEl.style.width = isMobile ? `${maxAllowedWidth}px` : 'max-content';

      const dropdownRect = dropdownEl.getBoundingClientRect();
      const dropdownWidth = dropdownRect.width || maxAllowedWidth;
      const dropdownHeight = dropdownRect.height || 260;

      // 4. Horizontal Positioning (Centered relative to viewport/hero on mobile, anchored to trigger on desktop)
      let left;
      if (isMobile) {
        left = Math.round((viewportWidth - dropdownWidth) / 2);
      } else {
        const triggerCenterX = triggerRect.left + (triggerRect.width / 2);
        left = Math.round(triggerCenterX - (dropdownWidth / 2));
      }

      const minLeft = VIEWPORT_PADDING;
      const maxLeft = viewportWidth - dropdownWidth - VIEWPORT_PADDING;
      left = Math.max(minLeft, Math.min(left, maxLeft));

      // 5. Vertical Positioning & Collision Handling
      const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_PADDING - ANCHOR_GAP;
      const spaceAbove = triggerRect.top - VIEWPORT_PADDING - ANCHOR_GAP;
      const preferredMaxHeight = type === 'visuals' ? 380 : 280;

      let placement;

      // Check if we should open downward or upward
      // If dropdown fits below OR if space below is greater than space above and >= 200px
      if ((spaceBelow >= Math.min(dropdownHeight, preferredMaxHeight)) || (spaceBelow >= spaceAbove && spaceBelow >= 200)) {
        // Open DOWNWARD — anchor top directly 8px below trigger
        placement = 'bottom';
        const dynamicMaxHeight = Math.min(preferredMaxHeight, Math.max(120, spaceBelow));
        dropdownEl.style.top = `${Math.round(triggerRect.bottom + ANCHOR_GAP)}px`;
        dropdownEl.style.bottom = 'auto';
        dropdownEl.style.maxHeight = `${Math.round(dynamicMaxHeight)}px`;
      } else {
        // Open UPWARD — anchor bottom directly 8px above trigger
        placement = 'top';
        const dynamicMaxHeight = Math.min(preferredMaxHeight, Math.max(120, spaceAbove));
        dropdownEl.style.bottom = `${Math.round(viewportHeight - triggerRect.top + ANCHOR_GAP)}px`;
        dropdownEl.style.top = 'auto';
        dropdownEl.style.maxHeight = `${Math.round(dynamicMaxHeight)}px`;
      }

      dropdownEl.style.left = `${Math.round(left)}px`;
      dropdownEl.style.right = 'auto';
      dropdownEl.setAttribute('data-placement', placement);

      // Make visible with smooth opacity
      dropdownEl.style.visibility = 'visible';
      dropdownEl.style.opacity = '1';

      attachListeners();
    }

    function reposition() {
      if (activeDropdown && activeTrigger && !activeDropdown.classList.contains('hidden')) {
        position(activeDropdown, activeTrigger, activeType);
      }
    }

    function attachListeners() {
      window.addEventListener('resize', reposition, { passive: true });
      window.addEventListener('scroll', reposition, { passive: true, capture: true });
    }

    function detachListeners() {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, { capture: true });
      activeDropdown = null;
      activeTrigger = null;
      activeType = null;
    }

    return {
      position,
      reposition,
      detachListeners
    };
  })();

  // --- Dropdown Panel Handlers ---
  function closeAllDropdowns() {
    const playlistDropdown = document.getElementById('playlist-dropdown');
    const visualsDropdown = document.getElementById('visuals-dropdown');
    const weatherFxPanel = document.getElementById('weather-effects-dropdown-panel');
    const btnWeatherFx = document.getElementById('btn-weather-fx-dropdown');

    if (playlistDropdown) {
      playlistDropdown.classList.add('hidden');
      playlistDropdown.style.opacity = '0';
    }
    DOM.playlistChevron?.classList.remove('rotate-180');
    document.getElementById('btn-playlist-selector')?.setAttribute('aria-expanded', 'false');

    if (visualsDropdown) {
      visualsDropdown.classList.add('hidden');
      visualsDropdown.style.opacity = '0';
    }
    document.getElementById('visuals-chevron')?.classList.remove('rotate-180');
    document.getElementById('btn-visuals-selector')?.setAttribute('aria-expanded', 'false');

    if (weatherFxPanel) {
      weatherFxPanel.classList.remove('is-open');
      weatherFxPanel.setAttribute('aria-hidden', 'true');
    }
    if (btnWeatherFx) {
      btnWeatherFx.classList.remove('is-open');
      btnWeatherFx.setAttribute('aria-expanded', 'false');
    }

    closeVolSlider();
    DropdownPositioner.detachListeners();
  }

  // --- Dynamic InsForge Cloud Visuals Engine ---
  const DEFAULT_VISUAL_PRESETS = [
    { id: 'off', name: 'Default Artwork (Image)', url: '' },
    { id: 'snow-4k', name: '4K Snowflakes Loop', url: 'https://youtu.be/HFMQdOJu1dA' },
    { id: 'lofi-drive', name: 'Lofi Night Drive', url: 'https://youtu.be/5WwP_7UoXgA' },
    { id: 'ocean', name: 'Ocean Waves & Horizon', url: 'https://vjs.zencdn.net/v/oceans.mp4' },
    { id: 'ambient', name: 'Ambient Motion Flow', url: 'https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/face-demographics-walking-and-pause.mp4' },
    { id: 'nature', name: 'Nature & Sunset Bloom', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' }
  ];

  let bgYtPlayer = null;
  let bgYtReady = false;
  let pendingBgYtId = null;

  function extractYouTubeVideoId(urlOrId) {
    if (!urlOrId || typeof urlOrId !== 'string') return null;
    const clean = urlOrId.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function initBgYouTubePlayerIfPending() {
    if (pendingBgYtId) {
      ensureBgYouTubePlayer(pendingBgYtId, () => {
        const bgYtContainer = document.getElementById('bg-yt-container');
        if (bgYtContainer && state.currentVisual && state.currentVisual !== 'off') {
          bgYtContainer.classList.add('is-active');
        }
      });
    }
  }

  function ensureBgYouTubePlayer(ytId, onReadyCallback) {
    if (!ytId) return;
    pendingBgYtId = ytId;

    if (bgYtPlayer && typeof bgYtPlayer.loadVideoById === 'function') {
      try {
        bgYtPlayer.loadVideoById({
          videoId: ytId,
          startSeconds: 0
        });
        bgYtPlayer.mute();
        bgYtPlayer.playVideo();
        if (onReadyCallback) onReadyCallback();
        return;
      } catch (e) {}
    }

    if (window.YT && window.YT.Player) {
      try {
        const bgYtContainer = document.getElementById('bg-yt-container');
        let playerEl = document.getElementById('bg-yt-player');
        if (!playerEl && bgYtContainer) {
          bgYtContainer.innerHTML = '<div id="bg-yt-player"></div>';
          playerEl = document.getElementById('bg-yt-player');
        }
        if (playerEl) {
          bgYtPlayer = new window.YT.Player('bg-yt-player', {
            videoId: ytId,
            host: 'https://www.youtube-nocookie.com',
            playerVars: {
              autoplay: 1,
              mute: 1,
              loop: 1,
              playlist: ytId,
              controls: 0,
              showinfo: 0,
              rel: 0,
              modestbranding: 1,
              iv_load_policy: 3,
              disablekb: 1,
              playsinline: 1,
              fs: 0,
              enablejsapi: 1,
              origin: window.location.origin
            },
            events: {
              onReady: (event) => {
                bgYtReady = true;
                event.target.mute();
                event.target.playVideo();
                if (onReadyCallback) onReadyCallback();
              },
              onStateChange: (event) => {
                if (event.data === 0) {
                  event.target.playVideo(); // Loop back to start
                }
              },
              onError: (err) => {
                console.warn('[Visuals] YouTube background player error:', err);
              }
            }
          });
        }
      } catch (err) {
        console.warn('[Visuals] YouTube player init error:', err);
      }
    } else {
      initYouTubeAPI();
    }
  }

  // --- InsForge Cloud Visuals Sync with SWR ---
  const CACHED_VISUALS_KEY = 'gullygang_cached_visuals';

  async function loadInsForgeVisuals(isBackgroundSync = false) {
    let cloudVisuals = null;

    // 1. Instant Cache Hydration: Render cached visuals in 0ms
    if (!state.visuals || state.visuals.length === 0) {
      try {
        const cached = localStorage.getItem(CACHED_VISUALS_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            state.visuals = parsed;
            renderVisualsOptions();
          }
        }
      } catch (e) {}
    }

    // 2. Try fetching from dedicated 'visuals' database table
    try {
      const res = await insforgeFetch('/api/database/records/visuals?is_active=eq.true&order=display_order.asc');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          cloudVisuals = data;
        }
      }
    } catch (e) {}

    // 3. Try fetching from 'site_settings' (background_visuals key)
    if (!cloudVisuals) {
      try {
        const res = await insforgeFetch('/api/database/records/site_settings?key=eq.background_visuals');
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0 && rows[0].value) {
            const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
            if (Array.isArray(parsed) && parsed.length > 0) {
              cloudVisuals = parsed;
            }
          }
        }
      } catch (e) {}
    }

    // Format and merge visuals
    let formattedList = [DEFAULT_VISUAL_PRESETS[0]]; // Always 'Off (Default Artwork)' at top

    if (cloudVisuals && cloudVisuals.length > 0) {
      cloudVisuals.forEach((cv, idx) => {
        const url = cv.url || '';
        formattedList.push({
          id: cv.id || `cloud-${idx}`,
          name: cv.name || 'Visual Scene',
          url: url
        });
      });
    } else if (state.visuals && state.visuals.length > 0) {
      formattedList = state.visuals;
    } else {
      formattedList = DEFAULT_VISUAL_PRESETS;
    }

    try {
      localStorage.setItem(CACHED_VISUALS_KEY, JSON.stringify(formattedList));
    } catch (e) {}

    state.visuals = formattedList;
    renderVisualsOptions();

    // If active visual is set, re-apply with newly hydrated cloud presets
    if (state.currentVisual && state.currentVisual !== 'off') {
      setVisual(state.currentVisual, null, false);
    }
  }

  function renderVisualsOptions() {
    const optionsList = document.getElementById('visuals-options-list');
    if (!optionsList) return;

    const list = state.visuals && state.visuals.length > 0 ? state.visuals : DEFAULT_VISUAL_PRESETS;
    optionsList.innerHTML = list.map(vp => {
      const safeId = escapeHTML(String(vp.id));
      const safeName = escapeHTML(String(vp.name));
      const isActive = state.currentVisual === vp.id;
      return `
        <button type="button" class="visual-item-btn ${isActive ? 'is-active' : ''}" data-visual-id="${safeId}">
          <span class="visual-item-title">${safeName}</span>
          <span class="visual-item-check">${svgIcon('<path d="M20 6 9 17l-5-5" />', 11)}</span>
        </button>
      `;
    }).join('');
  }

  function initVisualsSystem() {
    const bgVideo = document.getElementById('bg-video');
    const btnVisuals = document.getElementById('btn-visuals-selector');
    const visualsDropdown = document.getElementById('visuals-dropdown');
    const visualsChevron = document.getElementById('visuals-chevron');
    const customInput = document.getElementById('custom-visual-url');
    const btnApplyCustom = document.getElementById('btn-apply-custom-visual');
    const optionsList = document.getElementById('visuals-options-list');

    if (!bgVideo) return;

    // Instant Synchronous Cache Hydration
    if (!state.visuals || state.visuals.length === 0) {
      try {
        const cached = localStorage.getItem(CACHED_VISUALS_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            state.visuals = parsed;
          }
        }
      } catch (e) {}
    }

    renderVisualsOptions();

    optionsList?.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemBtn = e.target.closest('.visual-item-btn');
      if (itemBtn) {
        const visualId = itemBtn.getAttribute('data-visual-id');
        setVisual(visualId);
        closeAllDropdowns();
      }
    });

    // Custom URL Apply Button (Secure Protocol Check)
    btnApplyCustom?.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = (customInput?.value || '').trim();
      if (url && isSafeUrl(url)) {
        setVisual('custom', url);
        closeAllDropdowns();
      }
    });

    customInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = (customInput?.value || '').trim();
        if (url && isSafeUrl(url)) {
          setVisual('custom', url);
          closeAllDropdowns();
        }
      }
    });

    // Visuals Dropdown Toggle
    btnVisuals?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = visualsDropdown?.classList.contains('hidden');
      closeAllDropdowns();
      if (isClosed && visualsDropdown) {
        DropdownPositioner.position(visualsDropdown, btnVisuals, 'visuals');
        visualsChevron?.classList.add('rotate-180');
        btnVisuals.setAttribute('aria-expanded', 'true');
      }
    });

    visualsDropdown?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Handle tab visibility pause/resume
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (bgVideo && bgVideo.classList.contains('is-active')) bgVideo.pause();
        if (bgYtPlayer && typeof bgYtPlayer.pauseVideo === 'function') bgYtPlayer.pauseVideo();
      } else {
        if (bgVideo && bgVideo.classList.contains('is-active')) bgVideo.play().catch(() => {});
        if (bgYtPlayer && typeof bgYtPlayer.playVideo === 'function') bgYtPlayer.playVideo();
      }
    });

    // Restore saved visual mode
    let savedVisual = 'off';
    let savedCustomUrl = '';
    try {
      savedVisual = localStorage.getItem('odiverse_bg_visual') || 'off';
      savedCustomUrl = localStorage.getItem('odiverse_custom_visual_url') || '';
      if (customInput && savedCustomUrl) customInput.value = savedCustomUrl;
    } catch (e) {}

    setVisual(savedVisual, savedCustomUrl, false);
  }

  function setVisual(visualId, customUrl = null, persist = true) {
    state.currentVisual = visualId;
    const bgVideo = document.getElementById('bg-video');
    const bgYtContainer = document.getElementById('bg-yt-container');
    const dynamicArtworkBg = document.getElementById('dynamic-artwork-bg');
    const stateBadge = document.getElementById('visuals-state-badge');
    const counterBadge = document.getElementById('visuals-active-counter');
    const customInput = document.getElementById('custom-visual-url');

    let targetRawUrl = '';
    let targetType = 'dynamic'; // 'dynamic' | 'mp4' | 'youtube'
    let targetName = 'Default';

    const currentPresets = state.visuals && state.visuals.length > 0 ? state.visuals : DEFAULT_VISUAL_PRESETS;

    if (visualId === 'custom') {
      const inputVal = customUrl || (customInput?.value || '').trim();
      targetRawUrl = inputVal;
      targetName = 'Custom';
      if (persist && inputVal) {
        try { localStorage.setItem('odiverse_custom_visual_url', inputVal); } catch (e) {}
      }
    } else {
      const preset = currentPresets.find(p => p.id === visualId) || DEFAULT_VISUAL_PRESETS.find(p => p.id === visualId);
      if (preset) {
        targetRawUrl = preset.url || '';
        targetName = preset.id === 'off' ? 'Off' : preset.name.split(' ')[0];
      } else if (visualId === 'off') {
        targetRawUrl = '';
        targetName = 'Off';
      }
    }

    // Auto-detect type from URL
    let ytId = null;
    if (visualId === 'off' || !targetRawUrl) {
      targetType = 'dynamic';
      targetName = 'Default';
    } else {
      ytId = extractYouTubeVideoId(targetRawUrl);
      if (ytId) {
        targetType = 'youtube';
      } else {
        targetType = 'mp4';
      }
    }

    if (persist) {
      try { localStorage.setItem('odiverse_bg_visual', visualId); } catch (e) {}
    }

    // Update Dropdown Active States
    document.querySelectorAll('.visual-item-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-visual-id') === visualId);
    });

    // Update Badges
    const isOff = targetType === 'dynamic';
    if (stateBadge) {
      stateBadge.textContent = isOff ? 'Off' : targetName;
      stateBadge.classList.toggle('bg-green-400/20', !isOff);
      stateBadge.classList.toggle('text-green-400', !isOff);
    }
    if (counterBadge) {
      counterBadge.textContent = isOff ? 'Default' : targetName;
    }

    trackEvent('visual_selected', {
      visual_id: visualId,
      visual_name: targetName,
      visual_type: targetType
    });

    // Execute Media Switch
    if (isOff) {
      pendingBgYtId = null;
      if (bgVideo) {
        bgVideo.classList.remove('is-active');
        bgVideo.pause();
        bgVideo.removeAttribute('src');
      }
      if (bgYtContainer) {
        bgYtContainer.classList.remove('is-active');
        if (bgYtPlayer && typeof bgYtPlayer.pauseVideo === 'function') {
          bgYtPlayer.pauseVideo();
        }
      }
      if (dynamicArtworkBg) dynamicArtworkBg.style.opacity = '1';
    } else if (targetType === 'youtube') {
      if (bgVideo) {
        bgVideo.classList.remove('is-active');
        bgVideo.pause();
        bgVideo.removeAttribute('src');
      }
      ensureBgYouTubePlayer(ytId, () => {
        if (bgYtContainer) bgYtContainer.classList.add('is-active');
      });
      if (bgYtContainer) bgYtContainer.classList.add('is-active');
      if (dynamicArtworkBg) dynamicArtworkBg.style.opacity = '0.35';
    } else if (targetType === 'mp4') {
      pendingBgYtId = null;
      if (bgYtContainer) {
        bgYtContainer.classList.remove('is-active');
        if (bgYtPlayer && typeof bgYtPlayer.pauseVideo === 'function') {
          bgYtPlayer.pauseVideo();
        }
      }
      if (bgVideo) {
        if (bgVideo.src !== targetRawUrl) {
          bgVideo.src = targetRawUrl;
          bgVideo.load();
        }
        bgVideo.play().catch(e => console.log('[Visuals] Autoplay note:', e.message));
        bgVideo.classList.add('is-active');
      }
      if (dynamicArtworkBg) dynamicArtworkBg.style.opacity = '0.35';
    }
  }

  function initDropdownHandlers() {
    // Weather Effects Dropdown Toggle
    const btnWeatherFx = document.getElementById('btn-weather-fx-dropdown');
    const weatherFxPanel = document.getElementById('weather-effects-dropdown-panel');

    btnWeatherFx?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = weatherFxPanel?.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen && weatherFxPanel && btnWeatherFx) {
        weatherFxPanel.classList.add('is-open');
        weatherFxPanel.setAttribute('aria-hidden', 'false');
        btnWeatherFx.classList.add('is-open');
        btnWeatherFx.setAttribute('aria-expanded', 'true');
      }
    });

    // Weather Atmosphere Effects Mode Buttons
    document.querySelectorAll('.weather-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = btn.getAttribute('data-weather-mode');
        if (window.WeatherEffects) {
          window.WeatherEffects.setMode(mode);
        }
        // Auto-close dropdown upon selection
        setTimeout(() => {
          closeAllDropdowns();
        }, 120);
      });
    });

    window.addEventListener('odiverse:weather-mode-change', (e) => {
      updateWeatherUI(e.detail?.mode || 'off');
    });

    // Playlist Selector
    const btnPlaylist = document.getElementById('btn-playlist-selector');
    const playlistDropdown = document.getElementById('playlist-dropdown');

    btnPlaylist?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = playlistDropdown?.classList.contains('hidden');
      closeAllDropdowns();
      if (isClosed && playlistDropdown) {
        DropdownPositioner.position(playlistDropdown, btnPlaylist, 'playlist');
        DOM.playlistChevron?.classList.add('rotate-180');
        btnPlaylist.setAttribute('aria-expanded', 'true');
      }
    });

    playlistDropdown?.addEventListener('click', (e) => {
      e.stopPropagation();
      const openUserBtn = e.target.closest('#btn-open-user-playlist-modal');
      if (openUserBtn) {
        UserPlaylistEngine.open();
        return;
      }
      const optionBtn = e.target.closest('.playlist-option-btn');
      if (optionBtn) {
        const plId = optionBtn.getAttribute('data-pl-id');
        const pl = state.playlists.find(p => String(p.id) === String(plId));
        if (pl) {
          selectPlaylist(pl);
          closeAllDropdowns();
        }
        return;
      }
      const refreshBtn = e.target.closest('#btn-refresh-playlist');
      if (refreshBtn) {
        refreshCurrentPlaylist();
      }
    });

    // Outside click dismiss
    document.addEventListener('click', (e) => {
      if (
        !document.getElementById('playlist-dropdown')?.contains(e.target) &&
        !document.getElementById('btn-playlist-selector')?.contains(e.target) &&
        !document.getElementById('visuals-dropdown')?.contains(e.target) &&
        !document.getElementById('btn-visuals-selector')?.contains(e.target) &&
        !document.getElementById('weather-effects-dropdown-panel')?.contains(e.target) &&
        !document.getElementById('btn-weather-fx-dropdown')?.contains(e.target) &&
        !DOM.playerRightControls?.contains(e.target) &&
        !document.getElementById('mobile-vol-wrapper')?.contains(e.target)
      ) {
        closeAllDropdowns();
      }
    });

    // Loading Error Retry Button
    const btnLoadingRetry = document.getElementById('btn-loading-retry');
    btnLoadingRetry?.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshCurrentPlaylist();
    });
  }

  // --- Inline SVG Weather Icon Library (replaces emoji) ---
  const WEATHER_ICON_SVGS = {
    sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
    sunCloud: '<path d="M12 2v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="M20 12h2" /><path d="m19.07 4.93-1.41 1.41" /><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" /><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />',
    fog: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /><path d="M16 17H7" /><path d="M17 21H9" />',
    drizzle: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M8 19v1" /><path d="M8 14v1" /><path d="M16 19v1" /><path d="M16 14v1" /><path d="M12 21v1" /><path d="M12 16v1" />',
    rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M16 14v6" /><path d="M8 14v6" /><path d="M12 16v6" />',
    snow: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M8 15h.01" /><path d="M8 19h.01" /><path d="M12 17h.01" /><path d="M12 21h.01" /><path d="M16 15h.01" /><path d="M16 19h.01" />',
    thunder: '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" /><path d="m13 12-3 5h4l-3 5" />'
  };

  // --- Real Live WMO Weather Mapping ---
  const WMO_WEATHER_MAP = {
    0: { desc: 'Clear Sky', icon: 'sun' },
    1: { desc: 'Mainly Clear', icon: 'sunCloud' },
    2: { desc: 'Partly Cloudy', icon: 'sunCloud' },
    3: { desc: 'Overcast', icon: 'cloud' },
    45: { desc: 'Foggy', icon: 'fog' },
    48: { desc: 'Rime Fog', icon: 'fog' },
    51: { desc: 'Light Drizzle', icon: 'drizzle' },
    53: { desc: 'Moderate Drizzle', icon: 'drizzle' },
    55: { desc: 'Dense Drizzle', icon: 'rain' },
    56: { desc: 'Freezing Drizzle', icon: 'snow' },
    57: { desc: 'Dense Freezing Drizzle', icon: 'snow' },
    61: { desc: 'Slight Rain', icon: 'drizzle' },
    63: { desc: 'Moderate Rain', icon: 'rain' },
    65: { desc: 'Heavy Rain', icon: 'rain' },
    66: { desc: 'Freezing Rain', icon: 'rain' },
    67: { desc: 'Heavy Freezing Rain', icon: 'snow' },
    71: { desc: 'Slight Snow', icon: 'snow' },
    73: { desc: 'Moderate Snow', icon: 'snow' },
    75: { desc: 'Heavy Snow', icon: 'snow' },
    77: { desc: 'Snow Grains', icon: 'snow' },
    80: { desc: 'Slight Showers', icon: 'drizzle' },
    81: { desc: 'Moderate Showers', icon: 'rain' },
    82: { desc: 'Violent Showers', icon: 'thunder' },
    85: { desc: 'Snow Showers', icon: 'snow' },
    86: { desc: 'Heavy Snow Showers', icon: 'snow' },
    95: { desc: 'Thunderstorm', icon: 'thunder' },
    96: { desc: 'Thunderstorm with Hail', icon: 'thunder' },
    99: { desc: 'Heavy Thunderstorm with Hail', icon: 'thunder' }
  };

  function weatherIconSvg(key) {
    const paths = WEATHER_ICON_SVGS[key] || WEATHER_ICON_SVGS.sun;
    return svgIcon(paths, 13, 'weather-hub-svg inline-block');
  }

  // --- Active GPS Coordinates & Weather State ---
  let activeUserCoords = null; // { lat: number, lon: number, city: string | null }
  let isLocatingWeather = false;

  function restoreCachedWeatherIfValid() {
    try {
      const cached = sessionStorage.getItem('gullygang_cached_weather');
      if (cached) {
        const parsed = JSON.parse(cached);
        const hasValidCoords = typeof parsed.lat === 'number' && typeof parsed.lon === 'number' && parsed.city;
        if (hasValidCoords && (Date.now() - parsed.timestamp < 1800000)) { // 30 min cache
          const locEl = document.getElementById('weather-location');
          const tempEl = document.getElementById('weather-temp');
          const descEl = document.getElementById('weather-condition');
          const iconEl = document.getElementById('weather-icon');
          if (locEl && parsed.city) {
            locEl.textContent = parsed.city;
            locEl.title = parsed.city;
            locEl.classList.remove('weather-hub-denied-msg');
          }
          if (tempEl && parsed.temp) tempEl.textContent = parsed.temp;
          if (descEl && parsed.desc) descEl.textContent = parsed.desc;
          if (iconEl && parsed.icon) iconEl.innerHTML = weatherIconSvg(parsed.icon);
          syncDropdownWeather(parsed.city, parsed.temp, parsed.desc);
          activeUserCoords = { lat: parsed.lat, lon: parsed.lon, city: parsed.city };
          return true;
        } else {
          sessionStorage.removeItem('gullygang_cached_weather');
        }
      }
    } catch (e) {}
    return false;
  }

  function syncDropdownWeather(city, temp, desc) {
    const dLoc = document.getElementById('dropdown-weather-location');
    const dTemp = document.getElementById('dropdown-weather-temp');
    if (dLoc && city) {
      dLoc.textContent = city;
      dLoc.title = city;
    }
    if (dTemp) {
      dTemp.textContent = temp || '--°C';
    }
  }

  function setWeatherLocatingState() {
    const locEl = document.getElementById('weather-location');
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-condition');
    const iconEl = document.getElementById('weather-icon');
    const divider1 = document.getElementById('weather-divider-1');
    const retryBtn = document.getElementById('weather-retry-btn');

    if (retryBtn) retryBtn.remove();
    if (locEl) {
      locEl.textContent = 'Detecting...';
      locEl.classList.remove('weather-hub-denied-msg');
      locEl.title = 'Detecting your location...';
    }
    syncDropdownWeather('Detecting...', '--°C', 'Atmosphere');
    if (tempEl) {
      tempEl.style.display = '';
      tempEl.textContent = '--°C';
    }
    if (descEl) {
      descEl.style.display = '';
      descEl.textContent = 'Loading';
    }
    if (divider1) divider1.style.display = '';
    if (iconEl) {
      iconEl.style.display = '';
      iconEl.innerHTML = weatherIconSvg('sunCloud');
    }
  }

  function showWeatherLocationError(message = 'Location access is required for local weather', canRetry = true) {
    const locEl = document.getElementById('weather-location');
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-condition');
    const iconEl = document.getElementById('weather-icon');
    const divider1 = document.getElementById('weather-divider-1');
    const primaryHub = document.querySelector('.weather-hub-primary');

    if (locEl) {
      locEl.textContent = message;
      locEl.classList.add('weather-hub-denied-msg');
      locEl.title = message;
    }
    if (tempEl) tempEl.style.display = 'none';
    if (descEl) descEl.style.display = 'none';
    if (divider1) divider1.style.display = 'none';
    if (iconEl) iconEl.style.display = 'none';

    let retryBtn = document.getElementById('weather-retry-btn');
    if (canRetry) {
      if (!retryBtn && primaryHub) {
        retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.id = 'weather-retry-btn';
        retryBtn.className = 'weather-retry-btn';
        retryBtn.setAttribute('aria-label', 'Retry location access');
        retryBtn.title = 'Click to request location permission again';
        retryBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span>Try Again</span>
        `;
        retryBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fetchRealLocationAndWeather(true);
        });
        primaryHub.appendChild(retryBtn);
      }
    } else if (retryBtn) {
      retryBtn.remove();
    }
  }

  function handleGeolocationError(err) {
    let message = 'Location access is required for local weather';
    if (err) {
      if (err.code === 1 || err.code === (err.PERMISSION_DENIED || 1)) {
        message = 'Location access is required for local weather';
        activeUserCoords = null;
        try { sessionStorage.removeItem('gullygang_cached_weather'); } catch (e) {}
      } else if (err.code === 2 || err.code === (err.POSITION_UNAVAILABLE || 2)) {
        message = 'Location unavailable';
      } else if (err.code === 3 || err.code === (err.TIMEOUT || 3)) {
        message = 'Location request timed out';
      }
    }
    showWeatherLocationError(message, true);
  }

  // --- Real Geolocation & Weather Fetcher (GPS Permission Model) ---
  async function fetchRealLocationAndWeather(userInitiated = false) {
    if (!('geolocation' in navigator)) {
      showWeatherLocationError('Geolocation not supported by browser', false);
      return;
    }

    // 1. If background refresh & we already have active valid user coordinates, reuse coords directly
    if (!userInitiated && activeUserCoords && typeof activeUserCoords.lat === 'number' && typeof activeUserCoords.lon === 'number') {
      await loadWeatherForCoordinates(activeUserCoords.lat, activeUserCoords.lon, activeUserCoords.city);
      return;
    }

    // 2. Check Permissions API if supported
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' });

        // Listen for live permission changes (e.g. user toggles permission in browser settings)
        perm.onchange = () => {
          if (perm.state === 'granted') {
            requestGpsPosition();
          } else if (perm.state === 'denied') {
            activeUserCoords = null;
            try { sessionStorage.removeItem('gullygang_cached_weather'); } catch (e) {}
            showWeatherLocationError('Location access is required for local weather', true);
          } else if (perm.state === 'prompt') {
            requestGpsPosition();
          }
        };

        if (perm.state === 'denied' && !userInitiated) {
          showWeatherLocationError('Location access is required for local weather', true);
          return;
        }
      } catch (e) {}
    }

    // 3. Request GPS coordinates
    requestGpsPosition();
  }

  function requestGpsPosition() {
    if (isLocatingWeather) return;
    isLocatingWeather = true;
    setWeatherLocatingState();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        isLocatingWeather = false;
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        activeUserCoords = { lat, lon, city: null };
        await loadWeatherForCoordinates(lat, lon);
      },
      (err) => {
        isLocatingWeather = false;
        handleGeolocationError(err);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  async function loadWeatherForCoordinates(lat, lon, knownCity = null) {
    const locEl = document.getElementById('weather-location');
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-condition');
    const iconEl = document.getElementById('weather-icon');
    const divider1 = document.getElementById('weather-divider-1');
    const retryBtn = document.getElementById('weather-retry-btn');

    if (retryBtn) retryBtn.remove();
    if (locEl) locEl.classList.remove('weather-hub-denied-msg');
    if (tempEl) tempEl.style.display = '';
    if (descEl) descEl.style.display = '';
    if (divider1) divider1.style.display = '';
    if (iconEl) iconEl.style.display = '';

    // 1. Check cached weather for instant 0ms render (validate coordinates match)
    try {
      const cached = sessionStorage.getItem('gullygang_cached_weather');
      if (cached) {
        const parsed = JSON.parse(cached);
        const hasValidCoords = typeof parsed.lat === 'number' && typeof parsed.lon === 'number' && parsed.city;
        const isMatch = hasValidCoords && Math.abs(parsed.lat - lat) < 0.08 && Math.abs(parsed.lon - lon) < 0.08;
        if (isMatch && (Date.now() - parsed.timestamp < 1800000)) { // 30 min cache
          if (locEl && parsed.city) {
            locEl.textContent = parsed.city;
            locEl.title = parsed.city;
          }
          if (tempEl && parsed.temp) tempEl.textContent = parsed.temp;
          if (descEl && parsed.desc) descEl.textContent = parsed.desc;
          if (iconEl && parsed.icon) iconEl.innerHTML = weatherIconSvg(parsed.icon);
          activeUserCoords = { lat, lon, city: parsed.city };
          return;
        }
      }
    } catch (e) {}

    // 2. Reverse geocode city name if not supplied
    let city = knownCity;
    if (!city) {
      try {
        const geoRes = await fetchWithRetryAndTimeout(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
          {}, 1, 5000
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          city = geoData.locality || geoData.city || geoData.principalSubdivision || geoData.countryName || 'Your Location';
        }
      } catch (e) {}
    }

    if (!city) {
      city = 'Your Location';
    }

    if (locEl) {
      locEl.textContent = city;
      locEl.title = city;
    }

    // 3. Fetch live weather from Open-Meteo
    try {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
      const wRes = await fetchWithRetryAndTimeout(weatherUrl, {}, 1, 8000);
      if (wRes.ok) {
        const wData = await wRes.json();
        const current = wData.current;
        if (current) {
          const temp = `${Math.round(current.temperature_2m)}°C`;
          const code = current.weather_code;
          const info = WMO_WEATHER_MAP[code] || { desc: 'Clear', icon: 'sun' };

          if (tempEl) tempEl.textContent = temp;
          if (descEl) descEl.textContent = info.desc;
          if (iconEl) iconEl.innerHTML = weatherIconSvg(info.icon);
          syncDropdownWeather(city, temp, info.desc);

          activeUserCoords = { lat, lon, city };

          try {
            sessionStorage.setItem('gullygang_cached_weather', JSON.stringify({
              timestamp: Date.now(),
              lat,
              lon,
              city,
              temp,
              desc: info.desc,
              icon: info.icon
            }));
          } catch (e) {}
        }
      }
    } catch (e) {
      if (descEl && (descEl.textContent === 'Loading' || !descEl.textContent)) {
        descEl.textContent = 'Sync failed';
      }
    }
  }

  // --- Real Live Date, Day & Time (No Demo Data) ---
  function updateLiveDateTime() {
    const now = new Date();

    // Real Day (e.g. Monday)
    const dayEl = document.getElementById('weather-day');
    if (dayEl) {
      dayEl.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now);
    }

    // Real Date (e.g. 24 Aug)
    const dateEl = document.getElementById('weather-date');
    if (dateEl) {
      dateEl.textContent = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(now);
    }

    // Real Clock (e.g. 4:15 AM)
    const clockEl = document.getElementById('weather-clock');
    if (clockEl) {
      clockEl.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
    }

    if (DOM.liveTime) {
      DOM.liveTime.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    }
  }

  function updateWeatherUI(mode) {
    const modeBtns = document.querySelectorAll('.weather-mode-btn');
    modeBtns.forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-weather-mode') === mode);
    });

    const btnWeatherFx = document.getElementById('btn-weather-fx-dropdown');
    if (btnWeatherFx) {
      btnWeatherFx.classList.toggle('has-active-fx', mode !== 'off');
    }
  }

  // --- Attach Controls Listeners ---
  function attachControlsListeners() {
    // 3D Cards Click
    [DOM.cardP2, DOM.cardP1, DOM.cardCurr, DOM.cardN1, DOM.cardN2].forEach(card => {
      card?.addEventListener('click', (e) => {
        e.preventDefault();
        handleCardClick(card);
      });
    });

    // Music Control Bar Buttons (Desktop)
    DOM.btnPlay?.addEventListener('click', togglePlay);
    DOM.btnNext?.addEventListener('click', () => playNext(1));
    DOM.btnPrev?.addEventListener('click', () => playPrev(1));
    DOM.btnShuffle?.addEventListener('click', toggleShuffle);
    DOM.btnRepeat?.addEventListener('click', toggleRepeat);

    // Music Control Bar Buttons (Mobile Card Player)
    document.getElementById('btn-play-mobile')?.addEventListener('click', togglePlay);
    document.getElementById('btn-next-mobile')?.addEventListener('click', () => playNext(1));
    document.getElementById('btn-prev-mobile')?.addEventListener('click', () => playPrev(1));
    document.getElementById('btn-shuffle-mobile')?.addEventListener('click', toggleShuffle);
    document.getElementById('btn-repeat-mobile')?.addEventListener('click', toggleRepeat);
    document.getElementById('btn-vol-mobile')?.addEventListener('click', toggleVolSlider);

    // Attach draggable music progress & seek slider listeners
    attachSeekSliderListeners();

    // Volume Slider Desktop
    DOM.btnVol?.addEventListener('click', toggleVolSlider);
    DOM.volSlider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.volume = val;
      const mobSlider = document.getElementById('vol-slider-mobile');
      if (mobSlider) mobSlider.value = val;
      if (state.isPlayerReady && state.ytPlayer) {
        try {
          state.ytPlayer.setVolume(val * 100);
          if (val === 0) state.ytPlayer.mute();
          else state.ytPlayer.unMute();
        } catch (err) {}
      }
      const volColor = val === 0 ? 'rgba(255,255,255,0.4)' : '#ffffff';
      if (DOM.volIcon) DOM.volIcon.style.color = volColor;
      const mobVolIcon = document.getElementById('vol-icon-mobile');
      if (mobVolIcon) mobVolIcon.style.color = volColor;
    });

    // Volume Slider Mobile
    document.getElementById('vol-slider-mobile')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.volume = val;
      if (DOM.volSlider) DOM.volSlider.value = val;
      if (state.isPlayerReady && state.ytPlayer) {
        try {
          state.ytPlayer.setVolume(val * 100);
          if (val === 0) state.ytPlayer.mute();
          else state.ytPlayer.unMute();
        } catch (err) {}
      }
      const volColor = val === 0 ? 'rgba(255,255,255,0.4)' : '#ffffff';
      if (DOM.volIcon) DOM.volIcon.style.color = volColor;
      const mobVolIcon = document.getElementById('vol-icon-mobile');
      if (mobVolIcon) mobVolIcon.style.color = volColor;
    });

    // Hide / Show Stage (Cards & Playlist) Toggle
    document.getElementById('btn-toggle-stage-view')?.addEventListener('click', () => toggleStageView());

    // Fullscreen
    DOM.btnFullscreen?.addEventListener('click', toggleFullscreen);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          if (e.shiftKey) playNext(1);
          else if (state.isPlayerReady && state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
            state.ytPlayer.seekTo((state.ytPlayer.getCurrentTime() || 0) + 5, true);
          }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) playPrev(1);
          else if (state.isPlayerReady && state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
            state.ytPlayer.seekTo(Math.max(0, (state.ytPlayer.getCurrentTime() || 0) - 5), true);
          }
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
        case 'KeyH':
          toggleStageView();
          break;
        case 'Escape':
          closeAllDropdowns();
          break;
      }
    });

    if ('mediaSession' in navigator) {
      const mediaActions = [
        ['play', () => { if (!state.isPlaying) togglePlay(); }],
        ['pause', () => { if (state.isPlaying) togglePlay(); }],
        ['nexttrack', () => playNext(1, true)],
        ['previoustrack', () => playPrev(1, true)],
        ['seekbackward', (details) => seekBy(-(details.seekOffset || 10))],
        ['seekforward', (details) => seekBy(details.seekOffset || 10)],
        ['seekto', (details) => { if (details.seekTime !== undefined) seekToTime(details.seekTime); }],
        ['stop', () => { if (state.isPlaying) togglePlay(); }]
      ];

      for (const [action, handler] of mediaActions) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (e) {}
      }
    }
  }

  function toggleStageView(forceState = null) {
    const btn = document.getElementById('btn-toggle-stage-view');
    const eyeOpen = btn?.querySelector('.eye-open-icon');
    const eyeClosed = btn?.querySelector('.eye-closed-icon');

    const isCurrentlyHidden = document.body.classList.contains('is-stage-hidden');
    const nextHidden = forceState !== null ? forceState : !isCurrentlyHidden;

    closeAllDropdowns();
    document.body.classList.toggle('is-stage-hidden', nextHidden);
    if (btn) {
      btn.setAttribute('aria-pressed', nextHidden ? 'true' : 'false');
      btn.setAttribute('aria-label', nextHidden ? 'Show weather and player' : 'Hide weather and player');
      btn.classList.toggle('is-active', nextHidden);
      btn.title = nextHidden ? 'Show Weather & Player (H)' : 'Hide Weather & Player (H)';
      if (eyeOpen && eyeClosed) {
        eyeOpen.classList.toggle('hidden', nextHidden);
        eyeClosed.classList.toggle('hidden', !nextHidden);
      }
    }

    trackEvent('stage_view_toggled', {
      is_hidden: nextHidden
    });
  }

  // --- Interactive Editorial Experience Accordion ---
  function initEditorialExperienceAccordion() {
    const rows = document.querySelectorAll('.editorial-num-row, .editorial-row');
    rows.forEach(row => {
      const header = row.querySelector('.editorial-num-row-header, .editorial-row-header');
      const body = row.querySelector('.editorial-num-row-body, .editorial-row-body');
      
      // Initialize first row state
      if (body?.classList.contains('is-open')) {
        row.classList.add('is-open');
        header?.setAttribute('aria-expanded', 'true');
      }

      header?.addEventListener('click', () => {
        const isOpen = row.classList.contains('is-open');
        if (isOpen) {
          row.classList.remove('is-open');
          body?.classList.remove('is-open');
          header.setAttribute('aria-expanded', 'false');
        } else {
          row.classList.add('is-open');
          body?.classList.add('is-open');
          header.setAttribute('aria-expanded', 'true');
          trackEvent('editorial_row_opened', {
            row_id: row.getAttribute('data-row-id'),
            heading: row.querySelector('.editorial-row-title, .editorial-row-heading')?.textContent?.trim()
          });
        }
      });
    });
  }

  // --- Scroll Reveal Animation with Intersection Observer ---
  function initScrollReveal() {
    const revealElements = document.querySelectorAll('.scroll-reveal');
    if (!('IntersectionObserver' in window)) {
      revealElements.forEach(el => el.classList.add('is-revealed'));
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          obs.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
  }

  // --- Subtle Parallax for Visual Moment & Cinematic Image ---
  function initVisualMomentParallax() {
    const visualImg = document.querySelector('.cinematic-img, .visual-moment-img');
    const isTouch = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || window.innerWidth < 768;
    if (!visualImg || isTouch || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const rect = visualImg.getBoundingClientRect();
          const winHeight = window.innerHeight;
          if (rect.top < winHeight && rect.bottom > 0) {
            const progress = (winHeight - rect.top) / (winHeight + rect.height);
            const translateY = (progress - 0.5) * 32; // Subtle 32px range
            visualImg.style.transform = `translateY(${translateY.toFixed(1)}px) scale(1.05)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  // --- Grand Massive CTA Handler ---
  function initGrandCta() {
    const btn = document.getElementById('btn-grand-cta');
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      trackEvent('grand_cta_clicked', {});
      
      // Auto-trigger playback if paused
      if (!state.isPlaying && state.playerReady && state.currentPlaylist?.tracks?.length) {
        setTimeout(() => {
          togglePlay();
        }, 400);
      }
    });
  }

  // --- Interactive Editorial FAQ Accordion ---
  function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-hairline-row, .luxury-faq-row, .faq-item');
    faqItems.forEach(item => {
      const trigger = item.querySelector('.faq-hairline-trigger, .faq-trigger');
      const content = item.querySelector('.faq-hairline-content, .faq-content');
      trigger?.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');
        // Close other FAQ items
        faqItems.forEach(other => {
          if (other !== item) {
            other.classList.remove('is-open');
            other.querySelector('.faq-hairline-content, .faq-content')?.classList.add('hidden');
            other.querySelector('.faq-hairline-trigger, .faq-trigger')?.setAttribute('aria-expanded', 'false');
          }
        });
        // Toggle active FAQ item
        if (isOpen) {
          item.classList.remove('is-open');
          content?.classList.add('hidden');
          trigger.setAttribute('aria-expanded', 'false');
        } else {
          item.classList.add('is-open');
          content?.classList.remove('hidden');
          trigger.setAttribute('aria-expanded', 'true');
          trackEvent('faq_opened', { question: trigger.querySelector('.faq-question')?.textContent?.trim() || trigger.textContent?.trim() });
        }
      });
    });
  }

  // --- Premium 3D Tilt for About (Desktop Pointer Only) ---
  function initPremium3DTilt() {
    const scene = document.querySelector('.premium-3d-about');
    const card = document.querySelector('.about-3d-card');
    const isTouch = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || window.innerWidth < 768;
    if (!scene || !card || isTouch || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = null;
    scene.addEventListener('mousemove', (e) => {
      const rect = scene.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.transform = `rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 7).toFixed(2)}deg) translateZ(28px)`;
        card.style.transition = 'transform 0.12s linear';
      });
    }, { passive: true });
    scene.addEventListener('mouseleave', () => {
      if (raf) cancelAnimationFrame(raf);
      card.style.transition = 'transform 0.7s cubic-bezier(0.16,1,0.3,1)';
      card.style.transform = 'rotateX(3deg) rotateY(-2.5deg) translateZ(0)';
    });
    // 3D parallax for 01-04 rows on mouse move
    const rows = document.querySelectorAll('.editorial-num-row');
    rows.forEach(row => {
      row.addEventListener('mousemove', (e) => {
        if (row.classList.contains('is-open')) return;
        const r = row.getBoundingClientRect();
        const rx = (e.clientY - r.top) / r.height - 0.5;
        const ry = (e.clientX - r.left) / r.width - 0.5;
        row.style.transform = `translateZ(22px) translateY(-4px) rotateX(${(-rx*3).toFixed(1)}deg) rotateY(${(ry*3).toFixed(1)}deg)`;
      }, { passive: true });
      row.addEventListener('mouseleave', () => {
        if (row.classList.contains('is-open')) row.style.transform = 'translateZ(18px)';
        else row.style.transform = '';
      });
    });
  }

  // --- Station Card Quick Switch ---
  function initStationCardClicks() {
    document.querySelectorAll('.station-editorial-row, .station-panoramic-strip, .station-showcase-card, .station-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = btn.getAttribute('data-station-slug');
        if (!slug || !state.playlists) return;
        const targetPl = state.playlists.find(p => (p.slug || '').toLowerCase() === slug || (p.name || '').toLowerCase().includes(slug.split('-')[0]));
        if (targetPl) {
          selectPlaylist(targetPl);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  // ============================================================
  // ADSTERRA ADVERTISING ENGINE (ABOUT PAGE ONLY)
  // Dedicated, lightweight, mobile-friendly ad delivery
  // Placement 1: Native Banner (76c9a991d0bae2e02df34a62c0087610)
  // Placement 2: Desktop 300x250 (d4127e461dd80ed29176989541fb7384) / Mobile 320x50 (d92daf229dcf68e460cafced4cc7b352)
  // ============================================================
  const AdsterraEngine = (function () {
    const activeObservers = [];

    function init() {
      // Find all About ad containers across the DOM
      const placements = document.querySelectorAll('.editorial-ad-placement-wrap');
      if (placements.length === 0) return;

      placements.forEach((wrap) => {
        const placementId = wrap.getAttribute('data-ad-placement') || '1';
        const isInsideModal = wrap.closest('#legal-view-modal') !== null;

        // If inside modal, ensure it only activates for the about page
        if (isInsideModal) {
          const currentActive = LegalPagesEngine?.getActivePage ? LegalPagesEngine.getActivePage() : 'about';
          if (currentActive !== 'about') {
            wrap.style.display = 'none';
            return;
          }
        }

        wrap.style.display = 'block';
        wrap.classList.remove('hidden');

        // Lazy-load using IntersectionObserver when scrolled near
        const observerRoot = isInsideModal ? (document.getElementById('legal-view-modal') || null) : null;
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              observer.disconnect();
              loadPlacement(wrap, placementId);
            }
          });
        }, {
          root: observerRoot,
          rootMargin: '250px'
        });

        observer.observe(wrap);
        activeObservers.push(observer);
      });
    }

    function loadPlacement(wrap, placementId) {
      if (placementId === '1') {
        loadNativeBanner(wrap);
      } else if (placementId === '2') {
        loadResponsiveBanner(wrap);
      }
    }

    function loadNativeBanner(wrap) {
      const slotBox = wrap.querySelector('.editorial-ad-slot-box, .editorial-ad-slot-inner') || wrap;
      if (!slotBox) return;
      if (slotBox.getAttribute('data-ad-loaded') === 'true') return;

      // Clean any existing container id elsewhere to avoid duplicates in DOM
      const existingContainer = document.getElementById('container-76c9a991d0bae2e02df34a62c0087610');
      if (existingContainer && !slotBox.contains(existingContainer)) {
        existingContainer.removeAttribute('id');
      }

      let containerDiv = slotBox.querySelector('#container-76c9a991d0bae2e02df34a62c0087610');
      if (!containerDiv) {
        containerDiv = document.createElement('div');
        containerDiv.id = 'container-76c9a991d0bae2e02df34a62c0087610';
        slotBox.appendChild(containerDiv);
      }

      slotBox.setAttribute('data-ad-loaded', 'true');

      // Exact Adsterra Native script injection
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.src = 'https://pl31088916.profitableratecpmnetwork.com/76c9a991d0bae2e02df34a62c0087610/invoke.js';
      slotBox.appendChild(script);
    }

    function loadResponsiveBanner(wrap) {
      const slotBox = wrap.querySelector('.editorial-ad-slot-box, .editorial-ad-slot-inner') || wrap;
      if (!slotBox) return;
      if (slotBox.getAttribute('data-ad-loaded') === 'true') return;
      slotBox.setAttribute('data-ad-loaded', 'true');

      const isMobile = window.innerWidth < 640;
      const key = isMobile ? 'd92daf229dcf68e460cafced4cc7b352' : 'd4127e461dd80ed29176989541fb7384';
      const width = isMobile ? 320 : 300;
      const height = isMobile ? 50 : 250;

      // Exact Adsterra atOptions configuration in normal window context
      window.atOptions = {
        'key': key,
        'format': 'iframe',
        'height': height,
        'width': width,
        'params': {}
      };

      // Exact Adsterra invoke.js script injection directly into page DOM
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = `https://www.highrevenueformat.com/${key}/invoke.js`;
      slotBox.appendChild(script);
    }

    function cleanupModal() {
      while (activeObservers.length > 0) {
        const obs = activeObservers.pop();
        try { obs.disconnect(); } catch (e) {}
      }
      const modal = document.getElementById('legal-view-modal');
      if (modal) {
        const modalSlots = modal.querySelectorAll('.editorial-ad-slot-box, .editorial-ad-slot-inner');
        modalSlots.forEach((slot) => {
          slot.removeAttribute('data-ad-loaded');
          slot.innerHTML = '';
        });
      }
    }

    return {
      init,
      cleanupModal
    };
  })();

  // ============================================================
  // CENTRALIZED CINEMATIC EDITORIAL SPA ROUTING ENGINE
  // Apple Music / Spotify Editorial Magazine Fullscreen Experience
  // ============================================================
  const LegalPagesEngine = (function () {
    const LEGAL_CONFIG = {
      siteName: "GULLYGANG",
      siteDomain: (typeof window !== 'undefined' && window.__ENV__?.SITE_DOMAIN) || "gullygang.in",
      legalName: "",
      privacyLastUpdated: "August 2026",
      termsLastUpdated: "August 2026",
      cookiesLastUpdated: "August 2026"
    };

    let activePage = null;

    function getAboutPageHtml() {
      return `
        <article class="editorial-article-wrap">
          <!-- Monumental Editorial Hero -->
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">EDITORIAL &bull; ABOUT</div>
            <h1 class="editorial-hero-huge-title">
              ABOUT<br />
              <span class="brand-gradient-word">GULLYGANG</span>
            </h1>
            <p class="editorial-hero-lead-quote">
              Music, atmosphere, and discovery &mdash; in one immersive experience.
            </p>
            <div class="editorial-hero-meta-row">
              <span>${LEGAL_CONFIG.siteName}</span>
              <span>&bull;</span>
              <span>A CINEMATIC MUSIC EXPERIENCE</span>
              <span>&bull;</span>
              <span>2026</span>
            </div>
            <div class="editorial-scroll-hint" aria-hidden="true">
              <span>&darr; scroll to explore</span>
            </div>
          </header>

          <!-- Chapter 01 -->
          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">THE IDEA</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG is a global music discovery and immersive listening platform designed around music, atmosphere, and artists. Bringing together hip-hop, rap, love, chill, pop, lo-fi and curated playlists from India and around the world inside a fluid, living canvas.
              </p>
              <p>
                Rather than treating music as a sterile list of files, GULLYGANG transforms every listening session into an ambient sanctuary that breathes in sync with your local weather and visual mood.
              </p>
            </div>
          </section>

          <!-- Placement 1: Adsterra Native Banner -->
          <div class="editorial-ad-placement-wrap" id="modal-about-ad-section-1" data-ad-placement="1">
            <div class="editorial-ad-label">ADVERTISEMENT</div>
            <div class="editorial-ad-slot-inner editorial-ad-native-box" id="modal-adsterra-about-container-1">
              <!-- Dynamically populated Adsterra Native Banner (76c9a991d0bae2e02df34a62c0087610) -->
            </div>
          </div>

          <!-- Chapter 02 -->
          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">THE EXPERIENCE</h2>
            <div class="editorial-chapter-body">
              <p>
                The platform brings together four core pillars of digital music listening:
              </p>
              <ul class="editorial-feature-list">
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Curated Playlist Discovery</div>
                  <div class="editorial-feature-item-desc">Curated playlists and radio channels spanning rap, hip-hop, love, chill, lo-fi, pop, and underground artist discoveries.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Fluid Continuous Audio Player</div>
                  <div class="editorial-feature-item-desc">Full playback control with keyboard shortcuts, mobile lockscreen controls, and zero disruptive mid-rolls.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Living Canvas Atmospheres</div>
                  <div class="editorial-feature-item-desc">Real-time background reacting dynamically to your local weather, paired with a living fluid ambient artwork canvas.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Universal Responsive Design</div>
                  <div class="editorial-feature-item-desc">Precision typography crafted for high-resolution desktop ultrawides, laptops, tablets, and mobile screens.</div>
                </li>
              </ul>
            </div>
          </section>

          <!-- Chapter 03 -->
          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">03</div>
            <h2 class="editorial-chapter-title">THIRD-PARTY CONTENT &amp; ATTRIBUTION</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG operates as a streaming player interface for discovering and organizing publicly available music playlists. Video and audio streaming, track metadata, and thumbnail imagery may be retrieved or embedded through third-party services such as the YouTube IFrame API where applicable.
              </p>
              <p>
                GULLYGANG does not claim ownership of third-party music recordings, compositions, musical videos, album artworks, or artist trademarks. All copyrights and intellectual property rights remain with their respective artists, labels, authors, and rightsholders.
              </p>
            </div>
          </section>

          <!-- Placement 2: Adsterra Responsive Banner (300x250 Desktop / 320x50 Mobile) -->
          <div class="editorial-ad-placement-wrap" id="modal-about-ad-section-2" data-ad-placement="2">
            <div class="editorial-ad-label">ADVERTISEMENT</div>
            <div class="editorial-ad-slot-inner editorial-ad-banner-box" id="modal-adsterra-about-container-2">
              <!-- Dynamically populated responsive Adsterra unit: 300x250 (Desktop) / 320x50 (Mobile) -->
            </div>
          </div>

          <!-- Chapter 04 -->
          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">04</div>
            <h2 class="editorial-chapter-title">SUPPORT GULLYGANG</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG is independently maintained to keep music discovery freely accessible to listeners worldwide.
              </p>
              <div class="editorial-support-showcase">
                <span class="editorial-support-badge">COMMUNITY SUPPORT</span>
                <h3 class="text-xl font-bold text-white mb-2">Support the project</h3>
                <p class="text-sm text-white/80 mb-6 font-medium">
                  Every contribution helps keep the music alive. <span style="color:#f472b6; display:inline-block; vertical-align:-2px;">${svgIcon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />', 14)}</span><span style="color:#a78bfa; display:inline-block; vertical-align:-2px;">${svgIcon('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />', 14)}</span>
                </p>
                <div style="margin-top: 8px;">
                  <a href="https://buymeachai.ezee.li/Lazer" target="_blank" rel="noopener noreferrer" class="buyme-chai-link" aria-label="Buy Me A Chai for GullyGang">
                    <img src="https://buymeachai.ezee.li/assets/images/buymeachai-button.png" alt="Buy Me A Chai" width="200" class="buyme-chai-img">
                  </a>
                </div>
              </div>
            </div>
          </section>
        </article>
      `;
    }

    function getPrivacyPageHtml() {
      const operatorClause = LEGAL_CONFIG.legalName ? `operated by ${LEGAL_CONFIG.legalName} at ${LEGAL_CONFIG.siteDomain}` : `accessible at ${LEGAL_CONFIG.siteDomain}`;
      return `
        <article class="editorial-article-wrap">
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">LEGAL &bull; PRIVACY</div>
            <h1 class="editorial-hero-huge-title">
              PRIVACY<br />
              <span class="brand-gradient-word">POLICY</span>
            </h1>
            <div class="editorial-hero-meta-row">
              <span>${LEGAL_CONFIG.siteName}</span>
              <span>&bull;</span>
              <span>${LEGAL_CONFIG.siteDomain}</span>
              <span>&bull;</span>
              <span>Last updated: ${LEGAL_CONFIG.privacyLastUpdated}</span>
            </div>
          </header>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">INTRODUCTION</h2>
            <div class="editorial-chapter-body">
              <p>
                This Privacy Policy explains how ${LEGAL_CONFIG.siteName} (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;), ${operatorClause}, handles information when you visit and interact with our listening interface at ${LEGAL_CONFIG.siteDomain}. We believe in total transparency and minimal, privacy-first data practices.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">INFORMATION WE COLLECT</h2>
            <div class="editorial-chapter-body">
              <p>
                We collect only the technical data strictly necessary to deliver audio streaming, remember preferences, and maintain security:
              </p>
              <ul class="editorial-feature-list">
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Technical &amp; Device Information</div>
                  <div class="editorial-feature-item-desc">Browser headers, operating system, screen dimensions, and IP address for essential connection routing and server log security.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Local &amp; Session Storage</div>
                  <div class="editorial-feature-item-desc">Client storage (localStorage and sessionStorage) to remember volume, repeat/shuffle status, visual canvas presets, and cache playlist listings for up to 10 minutes.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Approximate Location (Optional)</div>
                  <div class="editorial-feature-item-desc">If live weather is enabled, browser geolocation queries Open-Meteo for local atmospheric conditions. Location data is never stored on our database or used for user profiling.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Voluntary Contact Submissions</div>
                  <div class="editorial-feature-item-desc">Your name, email address, inquiry category, and message body when voluntarily submitted via our Contact form.</div>
                </li>
              </ul>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">03</div>
            <h2 class="editorial-chapter-title">THIRD-PARTY ADVERTISING</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG integrates advertisements exclusively in the dedicated About section to support server maintenance, while keeping the primary music player screen completely free of advertisements.
              </p>
              <p>
                Third-party vendors, including Google, use cookies and related tracking mechanisms to serve advertisements based on your prior visits to this website or other sites across the Internet.
              </p>
              <p>
                You can manage or opt out of personalized advertising at any time by visiting <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline underline-offset-4">Google Ads Settings</a> and review the official <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline underline-offset-4">Google Advertising Privacy &amp; Terms</a>.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">04</div>
            <h2 class="editorial-chapter-title">VOLUNTARY SUPPORT &amp; CREATOR CONTRIBUTIONS</h2>
            <div class="editorial-chapter-body">
              <p>
                Listeners who choose to support GULLYGANG voluntarily may make contributions via Buy Me A Chai.
              </p>
              <p>
                All voluntary creator support is handled directly through external platforms. GULLYGANG never accesses, processes, or stores your private banking or financial credentials.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">05</div>
            <h2 class="editorial-chapter-title">THIRD-PARTY SERVICES (YOUTUBE)</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG interacts with external services to facilitate audio streaming, including the YouTube IFrame API. When you stream tracks, you interact with YouTube services operated by Google LLC.
              </p>
              <p>
                Please consult the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline underline-offset-4">YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline underline-offset-4">Google Privacy Policy</a>.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">06</div>
            <h2 class="editorial-chapter-title">CONTACT &amp; DATA INQUIRIES</h2>
            <div class="editorial-chapter-body">
              <p>
                For questions or privacy requests concerning this policy, please visit our <a href="#/contact" class="text-emerald-400 underline underline-offset-4" data-route="contact">Contact page</a>.
              </p>
            </div>
          </section>
        </article>
      `;
    }

    function getTermsPageHtml() {
      return `
        <article class="editorial-article-wrap">
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">LEGAL &bull; TERMS</div>
            <h1 class="editorial-hero-huge-title">
              TERMS<br />
              <span class="brand-gradient-word">OF USE</span>
            </h1>
            <div class="editorial-hero-meta-row">
              <span>${LEGAL_CONFIG.siteName}</span>
              <span>&bull;</span>
              <span>${LEGAL_CONFIG.siteDomain}</span>
              <span>&bull;</span>
              <span>Last updated: ${LEGAL_CONFIG.termsLastUpdated}</span>
            </div>
          </header>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">ACCEPTANCE OF TERMS</h2>
            <div class="editorial-chapter-body">
              <p>
                By accessing or using ${LEGAL_CONFIG.siteName} (${LEGAL_CONFIG.siteDomain}), you agree to comply with and be bound by these Terms of Use. If you do not agree with any part of these terms, please discontinue use of the platform.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">USE OF GULLYGANG</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG provides a free web interface for discovering, organizing, and streaming music playlists for personal, non-commercial entertainment. You agree to use the service in compliance with all applicable local, national, and international laws.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">03</div>
            <h2 class="editorial-chapter-title">MUSIC &amp; THIRD-PARTY CONTENT</h2>
            <div class="editorial-chapter-body">
              <p>
                All music audio, video streams, channel titles, and album covers presented through the player are supplied via third-party platforms (including YouTube). GULLYGANG does not host, upload, re-encode, or distribute proprietary audio files on its own servers.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">04</div>
            <h2 class="editorial-chapter-title">INTELLECTUAL PROPERTY</h2>
            <div class="editorial-chapter-body">
              <p>
                All copyrights, trademarks, service marks, and intellectual property rights in third-party music, artist names, and artwork belong exclusively to their respective owners. The custom layout, software code, branding wordmarks, and visual presentation of GULLYGANG are protected under applicable intellectual property laws.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">05</div>
            <h2 class="editorial-chapter-title">SERVICE AVAILABILITY &amp; LIMITATIONS</h2>
            <div class="editorial-chapter-body">
              <p>
                GULLYGANG is provided on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis without warranties of any kind. Playlists, individual tracks, or visual feeds may occasionally experience downtime, become restricted by rights owners, or be removed from external platforms without prior notice.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">06</div>
            <h2 class="editorial-chapter-title">USER CONDUCT</h2>
            <div class="editorial-chapter-body">
              <p>
                You agree not to: (a) attempt unauthorized access to backend databases or servers; (b) launch automated scraping, denial of service attacks, or disruptive bot scripts; (c) bypass third-party access controls or terms of service.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">07</div>
            <h2 class="editorial-chapter-title">CONTACT</h2>
            <div class="editorial-chapter-body">
              <p>
                For questions regarding these Terms of Use, please reach out through our <a href="#/contact" class="text-emerald-400 underline underline-offset-4" data-route="contact">Contact page</a>.
              </p>
            </div>
          </section>
        </article>
      `;
    }

    function getCookiesPageHtml() {
      return `
        <article class="editorial-article-wrap">
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">LEGAL &bull; COOKIES</div>
            <h1 class="editorial-hero-huge-title">
              COOKIE<br />
              <span class="brand-gradient-word">POLICY</span>
            </h1>
            <div class="editorial-hero-meta-row">
              <span>${LEGAL_CONFIG.siteName}</span>
              <span>&bull;</span>
              <span>${LEGAL_CONFIG.siteDomain}</span>
              <span>&bull;</span>
              <span>Last updated: ${LEGAL_CONFIG.cookiesLastUpdated}</span>
            </div>
          </header>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">WHAT ARE COOKIES &amp; STORAGE TECHNOLOGIES?</h2>
            <div class="editorial-chapter-body">
              <p>
                Cookies are small text files stored in your web browser. Modern web applications also utilize browser storage technologies (localStorage and sessionStorage) to remember client settings locally without repeatedly transmitting data across every network request.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">HOW GULLYGANG USES STORAGE TECHNOLOGIES</h2>
            <div class="editorial-chapter-body">
              <ul class="editorial-feature-list">
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Essential Preferences (localStorage)</div>
                  <div class="editorial-feature-item-desc">Remembers your audio volume, mute status, shuffle mode, repeat settings, and visual atmosphere choices between sessions.</div>
                </li>
                <li class="editorial-feature-item">
                  <div class="editorial-feature-item-title">Session Cache (sessionStorage)</div>
                  <div class="editorial-feature-item-desc">Temporarily holds playlist song listings for up to 10 minutes to prevent unnecessary and redundant YouTube API calls.</div>
                </li>
              </ul>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">03</div>
            <h2 class="editorial-chapter-title">MANAGING YOUR PREFERENCES</h2>
            <div class="editorial-chapter-body">
              <p>
                You can control, block, or clear cookies and local browser storage through your browser settings. For personalized advertising options, visit <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline underline-offset-4">Google Ads Settings</a>.
              </p>
            </div>
          </section>
        </article>
      `;
    }

    function getDisclaimerPageHtml() {
      return `
        <article class="editorial-article-wrap">
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">LEGAL &bull; DISCLAIMER</div>
            <h1 class="editorial-hero-huge-title">
              LEGAL<br />
              <span class="brand-gradient-word">DISCLAIMER</span>
            </h1>
            <div class="editorial-hero-meta-row">
              <span>${LEGAL_CONFIG.siteName}</span>
              <span>&bull;</span>
              <span>${LEGAL_CONFIG.siteDomain}</span>
              <span>&bull;</span>
              <span>Last updated: August 2026</span>
            </div>
          </header>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">GENERAL INFORMATION</h2>
            <div class="editorial-chapter-body">
              <p>
                The information, media player interface, atmospheric visuals, and music playlists curated on ${LEGAL_CONFIG.siteName} (${LEGAL_CONFIG.siteDomain}) are provided for personal, non-commercial entertainment and cultural discovery purposes only. All materials on this platform are provided in good faith on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of any kind.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">THIRD-PARTY CONTENT &amp; EMBEDDED MEDIA</h2>
            <div class="editorial-chapter-body">
              <p>
                ${LEGAL_CONFIG.siteName} operates as an independent streaming directory and player interface. We do not host, store, copy, re-encode, or distribute proprietary audio or video files on our own servers. Audio and video streams are embedded and played directly through official third-party APIs, including the YouTube IFrame Player API.
              </p>
              <p>
                All copyrights, trademarks, musical compositions, sound recordings, lyrics, artist likenesses, and album artwork belong exclusively to their respective creators, record labels, songwriters, and intellectual property rightsholders. The appearance of third-party music, channel titles, or trademarks on this website does not imply endorsement, sponsorship, or affiliation with ${LEGAL_CONFIG.siteName}.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">03</div>
            <h2 class="editorial-chapter-title">ACCURACY OF WEATHER &amp; EXTERNAL APIS</h2>
            <div class="editorial-chapter-body">
              <p>
                Real-time weather data and approximate locality names are retrieved via public meteorological services (such as Open-Meteo). We make no representations or warranties concerning the accuracy, completeness, or timeliness of atmospheric readings displayed on the canvas.
              </p>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">04</div>
            <h2 class="editorial-chapter-title">COPYRIGHT CONCERNS &amp; TAKEDOWN INQUIRIES</h2>
            <div class="editorial-chapter-body">
              <p>
                ${LEGAL_CONFIG.siteName} respects all intellectual property rights. If you are a copyright owner, artist, or authorized representative and believe that any playlist listing or reference on our website infringes your rights, please contact us immediately through our <a href="#/contact" class="text-emerald-400 underline underline-offset-4" data-route="contact">Contact page</a> by selecting <strong>&ldquo;Copyright / Content Concern&rdquo;</strong> with the track title, artist name, and relevant reference link. We review and process verified requests promptly.
              </p>
            </div>
          </section>
        </article>
      `;
    }

    function getContactPageHtml() {
      return `
        <article class="editorial-article-wrap">
          <header class="editorial-monument-hero">
            <div class="editorial-monument-tagline-top">COMMUNICATION &bull; GET IN TOUCH</div>
            <h1 class="editorial-hero-huge-title">
              SEND A<br />
              <span class="brand-gradient-word">MESSAGE</span>
            </h1>
            <p class="editorial-hero-lead-quote">
              Have feedback, found an issue, or want to get in touch?<br />
              Send us a message using the form below.
            </p>
          </header>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">01</div>
            <h2 class="editorial-chapter-title">INQUIRY FORM</h2>
            <div class="editorial-chapter-body">
              <form id="gullygang-contact-form" class="editorial-contact-form-wrap" novalidate>
                <!-- Anti-Spam Honeypot Field (Invisible to human users) -->
                <div style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" aria-hidden="true" tabindex="-1">
                  <label for="contact-hp-website">Website (Leave empty)</label>
                  <input type="text" id="contact-hp-website" name="website" tabindex="-1" autocomplete="off" />
                </div>

                <div class="editorial-form-row">
                  <div class="editorial-form-group">
                    <label for="contact-name" class="editorial-form-label">Your Name</label>
                    <input type="text" id="contact-name" name="name" class="editorial-form-input" placeholder="e.g. Priyabrata Mohanty" maxlength="100" required />
                  </div>

                  <div class="editorial-form-group">
                    <label for="contact-email" class="editorial-form-label">Your Email</label>
                    <input type="email" id="contact-email" name="email" class="editorial-form-input" placeholder="name@example.com" maxlength="255" required />
                  </div>
                </div>

                <div class="editorial-form-group">
                  <label for="contact-category" class="editorial-form-label">Inquiry Category</label>
                  <select id="contact-category" name="category" class="editorial-form-select" required>
                    <option value="general">General Inquiry</option>
                    <option value="technical">Technical / Playback Issue</option>
                    <option value="copyright">Copyright / Content Concern</option>
                    <option value="privacy">Privacy &amp; Data Question</option>
                    <option value="station_request">Station / Song Suggestion</option>
                  </select>
                </div>

                <div class="editorial-form-group">
                  <label for="contact-message" class="editorial-form-label">Message</label>
                  <textarea id="contact-message" name="message" class="editorial-form-textarea" placeholder="How can we assist you?" maxlength="3000" required></textarea>
                </div>

                <div class="editorial-submit-action">
                  <button type="submit" id="btn-submit-contact" class="editorial-submit-btn">
                    SEND MESSAGE &rarr;
                  </button>
                </div>

                <div id="contact-form-status" class="contact-status-msg hidden mt-4" role="status" aria-live="polite"></div>
              </form>
            </div>
          </section>

          <section class="editorial-magazine-chapter">
            <div class="editorial-chapter-num">02</div>
            <h2 class="editorial-chapter-title">COPYRIGHT &amp; CONTENT CONCERNS</h2>
            <div class="editorial-chapter-body">
              <p class="text-sm text-white/60">
                GULLYGANG respects the intellectual property rights of musical artists, songwriters, composers, and record labels. If you are a rights owner or designated agent and have concerns regarding third-party playlist references, please select <strong>&ldquo;Copyright / Content Concern&rdquo;</strong> in the form above with the track title, artist name, and relevant reference link. We handle verified inquiries with priority.
              </p>
            </div>
          </section>
        </article>
      `;
    }

    function openPage(pageKey) {
      const modal = document.getElementById('legal-view-modal');
      const contentBody = document.getElementById('legal-content-body');
      if (!modal || !contentBody) return;

      const normalizedKey = (pageKey || 'about').toLowerCase().replace('#/', '').replace('/', '');
      activePage = normalizedKey;

      let html = '';
      let pageTitle = 'GULLYGANG';

      switch (normalizedKey) {
        case 'about':
          html = getAboutPageHtml();
          pageTitle = 'GULLYGANG — About';
          break;
        case 'privacy':
          html = getPrivacyPageHtml();
          pageTitle = 'GULLYGANG — Privacy Policy';
          break;
        case 'terms':
          html = getTermsPageHtml();
          pageTitle = 'GULLYGANG — Terms of Use';
          break;
        case 'cookies':
          html = getCookiesPageHtml();
          pageTitle = 'GULLYGANG — Cookie Policy';
          break;
        case 'disclaimer':
          html = getDisclaimerPageHtml();
          pageTitle = 'GULLYGANG — Disclaimer';
          break;
        case 'contact':
          html = getContactPageHtml();
          pageTitle = 'GULLYGANG — Contact';
          break;
        default:
          html = getAboutPageHtml();
          pageTitle = 'GULLYGANG — About';
          break;
      }

      contentBody.innerHTML = html;
      modal.scrollTop = 0;
      document.title = pageTitle;

      // Update active nav items
      document.querySelectorAll('.editorial-nav-item, .legal-tab-btn').forEach(btn => {
        const p = btn.getAttribute('data-legal-page');
        btn.classList.toggle('is-active', p === normalizedKey);
      });

      // Show modal fullscreen view
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      // Attach contact form listener if on contact page
      if (normalizedKey === 'contact') {
        attachContactFormHandler();
      }

      // Initialize Adsterra placements ONLY on the about page
      if (normalizedKey === 'about') {
        AdsterraEngine.init();
      }

      // Attach internal links inside legal content
      contentBody.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const target = link.getAttribute('data-route');
          window.location.hash = `#/${target}`;
          openPage(target);
        });
      });
    }

    function close() {
      const modal = document.getElementById('legal-view-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      document.title = 'GULLYGANG — Music That Feels Different';

      AdsterraEngine.cleanupModal();

      if (window.location.hash.startsWith('#/')) {
        history.replaceState(null, null, window.location.pathname + window.location.search);
      }
    }

    let isContactSubmitting = false;

    function attachContactFormHandler() {
      const form = document.getElementById('gullygang-contact-form') || document.getElementById('odiverse-contact-form');
      const statusEl = document.getElementById('contact-form-status');
      if (!form) return;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isContactSubmitting) return; // Prevent duplicate clicks

        const name = (form.name?.value || '').trim();
        const email = (form.email?.value || '').trim();
        const message = (form.message?.value || '').trim();
        const honeypot = (form.website?.value || '').trim();

        // 1. Anti-Spam: If honeypot is filled, silently simulate success
        if (honeypot.length > 0) {
          form.reset();
          if (statusEl) {
            statusEl.innerHTML = `<div class="text-emerald-400 font-semibold mb-1">Message sent successfully.</div>`;
            statusEl.className = 'contact-status-msg text-emerald-400';
            statusEl.classList.remove('hidden');
          }
          return;
        }

        // 2. Validate input fields
        if (!name) {
          if (statusEl) {
            statusEl.textContent = 'Please enter your name.';
            statusEl.className = 'contact-status-msg text-rose-400';
            statusEl.classList.remove('hidden');
          }
          form.name?.focus();
          return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          if (statusEl) {
            statusEl.textContent = 'Please enter a valid email address.';
            statusEl.className = 'contact-status-msg text-rose-400';
            statusEl.classList.remove('hidden');
          }
          form.email?.focus();
          return;
        }

        if (!message) {
          if (statusEl) {
            statusEl.textContent = 'Please enter a message.';
            statusEl.className = 'contact-status-msg text-rose-400';
            statusEl.classList.remove('hidden');
          }
          form.message?.focus();
          return;
        }

        const submitBtn = document.getElementById('btn-submit-contact');
        isContactSubmitting = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending...';
        }
        if (statusEl) {
          statusEl.classList.add('hidden');
        }

        try {
          // 3. Submit data to InsForge via first-party endpoint with REST fallback
          let sentSuccessfully = false;

          try {
            const apiRes = await fetch(`${API_BASE}/api/contact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, email, message, website: honeypot })
            });

            if (apiRes.ok) {
              sentSuccessfully = true;
            } else if (apiRes.status === 429) {
              throw new Error('RATE_LIMITED');
            }
          } catch (apiErr) {
            if (apiErr.message === 'RATE_LIMITED') throw apiErr;
          }

          // Fallback directly to InsForge REST records table if api route had network issue
          if (!sentSuccessfully && INSFORGE_CONFIG.baseUrl && INSFORGE_CONFIG.apiKey) {
            const restRes = await insforgeFetch('/api/database/records/contact_messages', {
              method: 'POST',
              body: JSON.stringify([{
                name,
                email,
                message,
                created_at: new Date().toISOString()
              }])
            });
            if (restRes.ok || restRes.status === 201) {
              sentSuccessfully = true;
            }
          }

          if (sentSuccessfully) {
            // 4. On success: clear form & show clean success message
            form.reset();
            if (statusEl) {
              statusEl.innerHTML = `
                <div class="text-emerald-400 font-semibold mb-1">Message sent successfully.</div>
                <div class="text-white/60 text-xs">Thanks for reaching out. We&rsquo;ll review your message promptly.</div>
              `;
              statusEl.className = 'contact-status-msg text-emerald-400';
              statusEl.classList.remove('hidden');
            }
          } else {
            throw new Error('SUBMIT_FAILED');
          }
        } catch (err) {
          // 5. On failure: keep entered data & show user-friendly error
          console.error('[GULLYGANG CONTACT SUBMISSION ERROR]', err);
          if (statusEl) {
            if (err.message === 'RATE_LIMITED') {
              statusEl.textContent = 'Too many messages sent. Please wait a few minutes before trying again.';
            } else {
              statusEl.textContent = "Couldn't send your message. Please try again.";
            }
            statusEl.className = 'contact-status-msg text-rose-400';
            statusEl.classList.remove('hidden');
          }
        } finally {
          isContactSubmitting = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'SEND MESSAGE \u2192';
          }
        }
      });
    }

    function init() {
      // Listen to navigation buttons in modal topbar
      document.getElementById('btn-close-legal')?.addEventListener('click', close);
      document.getElementById('btn-close-legal-cross')?.addEventListener('click', close);
      document.getElementById('legal-backdrop')?.addEventListener('click', close);

      document.querySelectorAll('.editorial-nav-item, .legal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = btn.getAttribute('data-legal-page');
          window.location.hash = `#/${page}`;
          openPage(page);
        });
      });

      // Listen to footer legal links
      document.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const route = link.getAttribute('data-route');
          window.location.hash = `#/${route}`;
          openPage(route);
        });
      });

      // Discover footer navigation helpers
      document.getElementById('footer-link-home')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      document.getElementById('footer-link-features')?.addEventListener('click', (e) => {
        e.preventDefault();
        const featuresEl = document.getElementById('features');
        if (featuresEl) {
          featuresEl.scrollIntoView({ behavior: 'smooth' });
        }
      });

      document.getElementById('footer-link-playlists')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => {
          document.getElementById('btn-playlist-selector')?.click();
        }, 350);
      });

      document.getElementById('footer-link-stations')?.addEventListener('click', (e) => {
        e.preventDefault();
        const stationsEl = document.getElementById('stations') || document.getElementById('visual-stage');
        if (stationsEl) {
          stationsEl.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });

      document.getElementById('footer-link-visuals')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => {
          document.getElementById('btn-visuals-selector')?.click();
        }, 350);
      });

      // Escape key to close modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modal = document.getElementById('legal-view-modal');
          if (modal && !modal.classList.contains('hidden')) {
            close();
          }
        }
      });

      // Handle initial URL hash on load or hashchange
      function handleHash() {
        const hash = window.location.hash;
        if (hash.startsWith('#/support')) {
          SupportEngine.open();
          return;
        }
        if (hash.startsWith('#/')) {
          const route = hash.replace('#/', '');
          openPage(route);
        }
      }

      window.addEventListener('hashchange', handleHash);
      handleHash();
    }

    return {
      init,
      openPage,
      close,
      getActivePage: () => activePage
    };
  })();

  // ============================================================
  // "LISTEN YOUR PLAYLIST" — TEMPORARY USER PLAYLIST ENGINE
  // User can import any YouTube playlist or single song for their session
  // Pure client-side in-memory queue (ZERO database persistence)
  // ============================================================
  const UserPlaylistEngine = (() => {
    const modal = document.getElementById('user-playlist-modal');
    const inputEl = document.getElementById('input-user-playlist');
    const clearBtn = document.getElementById('btn-clear-user-playlist');
    const submitBtn = document.getElementById('btn-load-user-playlist');
    const btnText = document.getElementById('user-playlist-btn-text');
    const spinner = document.getElementById('user-playlist-spinner');
    const feedback = document.getElementById('user-playlist-feedback');

    function open() {
      if (!modal) return;
      closeAllDropdowns();
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      clearFeedback();
      setTimeout(() => {
        inputEl?.focus();
      }, 100);
    }

    function close() {
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      setLoading(false);
    }

    function setLoading(isLoading) {
      if (submitBtn) submitBtn.disabled = isLoading;
      if (spinner) spinner.classList.toggle('hidden', !isLoading);
      if (btnText) btnText.textContent = isLoading ? 'Loading...' : 'Load Playlist';
    }

    function showFeedback(message, type = 'error') {
      if (!feedback) return;
      feedback.textContent = message;
      feedback.className = `user-playlist-feedback is-${type}`;
      feedback.classList.remove('hidden');
    }

    function clearFeedback() {
      if (!feedback) return;
      feedback.textContent = '';
      feedback.className = 'user-playlist-feedback hidden';
    }

    function parseInput(rawInput) {
      if (!rawInput || typeof rawInput !== 'string') return null;
      const raw = rawInput.trim();

      // 1. Check for playlist URL (e.g. ?list=PLxxx or &list=PLxxx)
      const listMatch = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
      if (listMatch && listMatch[1]) {
        return { type: 'playlist', id: listMatch[1] };
      }

      // 2. Check for raw playlist ID (starts with PL, UU, LL, RD, OLAK5uy_)
      if (/^(?:PL|UU|LL|RD|OLAK5uy_)[A-Za-z0-9_-]{8,}$/.test(raw)) {
        return { type: 'playlist', id: raw };
      }

      // 3. Check for standard YouTube video URLs (youtu.be/xxx, watch?v=xxx, embed/xxx, shorts/xxx)
      const vidMatch = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([A-Za-z0-9_-]{11})/);
      if (vidMatch && vidMatch[1]) {
        return { type: 'video', id: vidMatch[1] };
      }

      // 4. Check for direct 11-char video ID
      if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
        return { type: 'video', id: raw };
      }

      return null;
    }

    async function fetchTracks(input) {
      const parsed = parseInput(input);
      if (!parsed) {
        throw new Error('INVALID_LINK');
      }

      // 1. Try first-party serverless resolver
      try {
        const apiUrl = `${API_BASE}/api/youtube/fetch?input=${encodeURIComponent(input)}`;
        const res = await fetch(apiUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.tracks)) {
            // Strictly sanitize and extract real 11-char video IDs ONLY
            const validTracks = data.tracks
              .map((t, idx) => {
                const vidId = t.videoId || t.id;
                if (!vidId || typeof vidId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(vidId)) {
                  return null; // Strip any invalid or playlist ID
                }
                return {
                  id: vidId,
                  videoId: vidId,
                  title: t.title || 'Untitled Track',
                  artist: t.artist || 'YouTube Artist',
                  thumbnail: normalizeThumbnailUrl(t.thumbnail, vidId),
                  position: idx + 1
                };
              })
              .filter(Boolean);

            if (validTracks.length > 0) {
              return {
                type: data.type,
                id: data.playlistId || data.id,
                title: data.title || (data.type === 'video' ? 'Your Song' : 'Your Playlist'),
                tracks: validTracks
              };
            }
          }

          if (data.code === 'PRIVATE_OR_UNAVAILABLE') {
            throw new Error('PRIVATE_OR_UNAVAILABLE');
          } else if (data.code === 'EMPTY_PLAYLIST') {
            throw new Error('EMPTY_PLAYLIST');
          }
        } else if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          if (data.code === 'QUOTA_EXCEEDED') {
            throw new Error('QUOTA_EXCEEDED');
          }
          throw new Error('RATE_LIMITED');
        } else if (res.status === 404) {
          throw new Error('PRIVATE_OR_UNAVAILABLE');
        }
      } catch (apiErr) {
        if (
          apiErr.message === 'PRIVATE_OR_UNAVAILABLE' ||
          apiErr.message === 'EMPTY_PLAYLIST' ||
          apiErr.message === 'INVALID_LINK' ||
          apiErr.message === 'RATE_LIMITED' ||
          apiErr.message === 'QUOTA_EXCEEDED'
        ) {
          throw apiErr;
        }
      }

      // 2. Client-side fallback for single video via oEmbed
      if (parsed.type === 'video' && /^[A-Za-z0-9_-]{11}$/.test(parsed.id)) {
        let title = 'YouTube Song';
        let artist = 'YouTube Artist';
        let thumb = `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;
        try {
          const oeRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(parsed.id)}&format=json`);
          if (oeRes.ok) {
            const oeData = await oeRes.json();
            if (oeData.title) title = oeData.title.trim();
            if (oeData.author_name) artist = oeData.author_name.trim();
            if (oeData.thumbnail_url) thumb = oeData.thumbnail_url;
          }
        } catch (e) {}

        return {
          type: 'video',
          id: parsed.id,
          title,
          tracks: [
            {
              id: parsed.id,
              videoId: parsed.id,
              title,
              artist,
              thumbnail: normalizeThumbnailUrl(thumb, parsed.id),
              position: 1
            }
          ]
        };
      } else if (parsed.type === 'playlist') {
        // Client-side fallback with browser API key if available
        const clientApiKey = (typeof window !== 'undefined' && (
          window.__ENV__?.YOUTUBE_API_KEY ||
          window.ENV?.YOUTUBE_API_KEY ||
          localStorage.getItem('odiverse_yt_api_key')
        )) || '';

        if (clientApiKey) {
          const ytTracks = await fetchViaYouTubeDataAPI(parsed.id, clientApiKey);
          const validYtTracks = (ytTracks || [])
            .map((t, idx) => {
              const vidId = t.id || t.youtube_id;
              if (!vidId || typeof vidId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(vidId)) {
                return null;
              }
              return {
                id: vidId,
                videoId: vidId,
                title: t.title || 'Untitled Track',
                artist: t.artist || 'YouTube Artist',
                thumbnail: normalizeThumbnailUrl(t.thumbnail, vidId),
                playlistId: `custom-user-${parsed.id}`,
                position: idx + 1
              };
            })
            .filter(Boolean);

          if (validYtTracks.length > 0) {
            return {
              type: 'playlist',
              id: parsed.id,
              title: 'Your Playlist',
              tracks: validYtTracks
            };
          }
        }
      }

      throw new Error('COULD_NOT_LOAD');
    }

    function selectUserCustomPlaylist(customData) {
      const playlistId = `custom-user-session`;
      const userPlaylist = {
        id: playlistId,
        name: customData.title || (customData.type === 'video' ? 'Your Song' : 'Your Playlist'),
        isCustomUserPlaylist: true,
        icon: 'music',
        youtube_playlist_url: customData.type === 'video'
          ? `https://youtube.com/watch?v=${customData.tracks[0].id}`
          : `https://youtube.com/playlist?list=${customData.id}`,
        tracks: customData.tracks
      };

      // Replace or prepend in-memory playlists list
      state.playlists = state.playlists.filter(p => !p.isCustomUserPlaylist);
      state.playlists.unshift(userPlaylist);

      state.currentPlaylist = userPlaylist;
      state.tracks = userPlaylist.tracks;
      state.currentIndex = 0;

      updatePlaylistLabels(userPlaylist.name);
      renderPlaylistMenus();
      setupCardsInitial();
      updateDockUI();

      trackEvent('user_playlist_loaded', {
        type: customData.type,
        trackCount: customData.tracks.length
      });

      if (state.tracks.length > 0) {
        loadTrackAtIndex(0, true, 'direct');
      }
    }

    async function handleImport() {
      const raw = inputEl?.value?.trim() || '';
      if (!raw) {
        showFeedback('Please paste a YouTube playlist URL, ID, or video link.', 'error');
        inputEl?.focus();
        return;
      }

      setLoading(true);
      showFeedback('Loading playlist…', 'info');

      try {
        const data = await fetchTracks(raw);
        if (!data || !data.tracks || data.tracks.length === 0) {
          showFeedback('Playlist is empty', 'error');
          setLoading(false);
          return;
        }

        // REQUIRED DEBUG LOGS
        console.log('[GULLYGANG] USER PLAYLIST INPUT:', raw);
        console.log('[GULLYGANG] INPUT TYPE:', data.type);
        console.log('[GULLYGANG] PLAYLIST ID:', data.type === 'playlist' ? (data.id || data.playlistId) : 'N/A (Single Video)');
        console.log('[GULLYGANG] FETCHED TRACK COUNT:', data.tracks.length);
        console.log('[GULLYGANG] FIRST VIDEO ID:', data.tracks[0]?.id);

        const countText = data.tracks.length === 1 ? '1 song' : `${data.tracks.length} songs`;
        showFeedback(`Playlist loaded — ${countText}`, 'success');

        // Apply to player session
        selectUserCustomPlaylist(data);

        // Auto close modal
        setTimeout(() => {
          close();
          if (inputEl) inputEl.value = '';
          if (clearBtn) clearBtn.classList.add('hidden');
        }, 500);
      } catch (err) {
        setLoading(false);
        if (err.message === 'RATE_LIMITED') {
          showFeedback('Too many requests. Please wait a minute and try again.', 'error');
        } else if (err.message === 'QUOTA_EXCEEDED') {
          showFeedback('YouTube API quota reached. Please try again later.', 'error');
        } else if (err.message === 'INVALID_LINK') {
          showFeedback('Invalid YouTube playlist link', 'error');
        } else if (err.message === 'PRIVATE_OR_UNAVAILABLE') {
          showFeedback('Private or unavailable playlist', 'error');
        } else if (err.message === 'EMPTY_PLAYLIST') {
          showFeedback('Playlist is empty', 'error');
        } else {
          showFeedback('Couldn’t load playlist', 'error');
        }
      }
    }

    function init() {
      document.getElementById('btn-close-user-playlist')?.addEventListener('click', close);
      document.getElementById('user-playlist-modal-backdrop')?.addEventListener('click', close);

      inputEl?.addEventListener('input', () => {
        clearFeedback();
        if (clearBtn) {
          clearBtn.classList.toggle('hidden', !inputEl.value.trim());
        }
      });

      clearBtn?.addEventListener('click', () => {
        if (inputEl) {
          inputEl.value = '';
          inputEl.focus();
        }
        clearBtn.classList.add('hidden');
        clearFeedback();
      });

      document.getElementById('form-user-playlist')?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleImport();
      });

      document.getElementById('btn-load-user-playlist')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleImport();
      });

      // Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
          close();
        }
      });
    }

    return {
      init,
      open,
      close
    };
  })();

  // ============================================================
  // GULLYGANG SUPPORT ENGINE (BUY ME A CHAI INTEGRATION)
  // Non-intrusive support modal with Buy Me A Chai direct creator support
  // ============================================================
  const SupportEngine = (() => {
    function open() {
      const modal = document.getElementById('support-view-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    function close() {
      const modal = document.getElementById('support-view-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');

      if (window.location.hash.startsWith('#/support')) {
        history.replaceState(null, null, window.location.pathname + window.location.search);
      }
    }

    function init() {
      // Topbar Support Pill
      document.getElementById('btn-support-header')?.addEventListener('click', () => open());

      // Close buttons
      document.getElementById('btn-close-support')?.addEventListener('click', close);
      document.getElementById('support-modal-backdrop')?.addEventListener('click', close);

      // Footer Support Link
      document.getElementById('footer-link-support')?.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });

      // About Page & on-page triggers
      document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action="open-support"]');
        if (target) {
          e.preventDefault();
          open();
        }
      });

      // Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modal = document.getElementById('support-view-modal');
          if (modal && !modal.classList.contains('hidden')) {
            close();
          }
        }
      });
    }

    return {
      init,
      open,
      close
    };
  })();

  // ============================================================
  // GULLYGANG PLAYLIST SYNCHRONIZATION ADMIN CENTER ENGINE
  // YouTube to InsForge automated & manual differential synchronization
  // ============================================================
  const PlaylistSyncEngine = (() => {
    let syncData = [];
    let isGlobalSyncing = false;
    let autoSyncTimer = null;

    function formatRelativeTime(isoString) {
      if (!isoString) return 'Never synced';
      try {
        const date = new Date(isoString);
        const now = new Date();
        const diffSecs = Math.floor((now - date) / 1000);
        if (diffSecs < 60) return 'Just now';
        if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
        if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return 'Recently';
      }
    }

    async function loadSyncStatus() {
      const listContainer = document.getElementById('sync-playlists-list');
      const totalPlaylistsEl = document.getElementById('sync-total-playlists-count');
      const totalSongsEl = document.getElementById('sync-total-songs-count');
      const lastGlobalTimeEl = document.getElementById('sync-last-global-time');

      try {
        const res = await fetch(`${API_BASE}/api/playlists/sync`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data && data.success && Array.isArray(data.playlists)) {
          syncData = data.playlists;

          let totalSongs = 0;
          let latestSyncTime = null;

          syncData.forEach(pl => {
            totalSongs += Number(pl.song_count || 0);
            if (pl.last_synced_at) {
              const plTime = new Date(pl.last_synced_at);
              if (!latestSyncTime || plTime > latestSyncTime) {
                latestSyncTime = plTime;
              }
            }
          });

          if (totalPlaylistsEl) totalPlaylistsEl.textContent = `${syncData.length} Active`;
          if (totalSongsEl) totalSongsEl.textContent = `${totalSongs} Songs`;
          if (lastGlobalTimeEl) {
            lastGlobalTimeEl.textContent = latestSyncTime ? formatRelativeTime(latestSyncTime.toISOString()) : 'Never';
          }

          renderSyncCards(syncData);
        }
      } catch (err) {
        console.error('[PlaylistSyncEngine] Failed to load sync status:', err);
        if (listContainer) {
          listContainer.innerHTML = `
            <div class="sync-loading-placeholder">
              <span style="color:#f87171;">Failed to load sync status. Please check your connection.</span>
            </div>
          `;
        }
      }
    }

    function renderSyncCards(playlists) {
      const listContainer = document.getElementById('sync-playlists-list');
      if (!listContainer) return;

      if (!playlists || playlists.length === 0) {
        listContainer.innerHTML = `
          <div class="sync-loading-placeholder">
            <span>No active playlists found in database.</span>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = playlists.map(pl => {
        const status = pl.sync_status || 'idle';
        let badgeClass = 'is-idle';
        let badgeText = 'IDLE';

        if (status === 'syncing') {
          badgeClass = 'is-syncing';
          badgeText = 'SYNCING...';
        } else if (status === 'success') {
          badgeClass = 'is-success';
          badgeText = 'SYNCED';
        } else if (status === 'error') {
          badgeClass = 'is-error';
          badgeText = 'ERROR';
        }

        const stats = pl.sync_stats || { total: pl.song_count || 0, added: 0, removed: 0, updated: 0, reordered: 0 };
        const icon = playlistIconSvg(pl.icon);
        const name = escapeHTML(pl.name);
        const ytId = escapeHTML(pl.youtube_playlist_id || '');
        const timeFormatted = formatRelativeTime(pl.last_synced_at);

        const errorHtml = pl.sync_error ? `
          <div class="sync-error-banner">
            <strong>Sync Warning:</strong> ${escapeHTML(pl.sync_error)}
          </div>
        ` : '';

        return `
          <div class="sync-card" data-playlist-id="${escapeHTML(pl.id)}">
            <div class="sync-card-header">
              <div class="sync-card-left">
                <span class="sync-card-icon">${icon}</span>
                <div class="sync-card-info">
                  <span class="sync-card-name">${name}</span>
                  ${ytId ? `
                    <a href="https://youtube.com/playlist?list=${ytId}" target="_blank" rel="noopener noreferrer" class="sync-card-yt-link" title="Open YouTube Playlist">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      <span>${ytId}</span>
                    </a>
                  ` : ''}
                </div>
              </div>
              <div class="sync-card-right">
                <span class="sync-badge ${badgeClass}">${badgeText}</span>
                <button type="button" class="btn-card-sync" data-action="sync-single" data-playlist-id="${escapeHTML(pl.id)}" title="Trigger YouTube synchronization">
                  <svg class="sync-spin-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Sync Now</span>
                </button>
              </div>
            </div>

            <!-- Stats & Diff Bar -->
            <div class="sync-card-stats-bar">
              <div class="sync-diff-group">
                <span class="sync-diff-item stat-total">Total: ${stats.total || pl.song_count || 0}</span>
                <span class="sync-diff-item stat-added">+${stats.added || 0} added</span>
                <span class="sync-diff-item stat-removed">-${stats.removed || 0} removed</span>
                <span class="sync-diff-item stat-updated">~${stats.updated || 0} updated</span>
                <span class="sync-diff-item stat-reordered">${svgIcon('<path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />', 11)}${stats.reordered || 0} reordered</span>
              </div>
              <span class="sync-time-stamp">${timeFormatted}</span>
            </div>

            ${errorHtml}
          </div>
        `;
      }).join('');

      // Attach single sync click listeners
      listContainer.querySelectorAll('[data-action="sync-single"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const plId = btn.getAttribute('data-playlist-id');
          if (plId) {
            await triggerSync(plId, btn);
          }
        });
      });
    }

    async function triggerSync(playlistId = null, btnEl = null) {
      if (btnEl) {
        btnEl.classList.add('is-syncing');
        const span = btnEl.querySelector('span');
        if (span) span.textContent = 'Syncing...';
      }

      try {
        const payload = playlistId ? { playlist_id: playlistId } : {};
        const res = await fetch(`${API_BASE}/api/playlists/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data && data.success) {
          // Invalidate cache in PlaylistCacheEngine
          if (playlistId) {
            PlaylistCacheEngine.invalidate(playlistId);
          } else {
            // Invalidate all
            if (syncData && syncData.length > 0) {
              syncData.forEach(p => PlaylistCacheEngine.invalidate(p.id));
            }
          }

          // Reload InsForge playlists
          await loadInsForgePlaylists(true);

          // If active playlist was synchronized, reload songs immediately into UI & player
          if (state.currentPlaylist && (!playlistId || state.currentPlaylist.id === playlistId)) {
            await loadPlaylistSongs(state.currentPlaylist, true, false);
          }

          // Reload UI cards in admin modal
          await loadSyncStatus();
        } else {
          alert(`Sync warning: ${data?.error || (data?.errors?.[0]?.error) || 'Failed to complete synchronization'}`);
          await loadSyncStatus();
        }
      } catch (err) {
        console.error('[PlaylistSyncEngine] Sync error:', err);
        alert('Network error while synchronizing with YouTube. Please try again.');
      } finally {
        if (btnEl) {
          btnEl.classList.remove('is-syncing');
          const span = btnEl.querySelector('span');
          if (span) span.textContent = 'Sync Now';
        }
      }
    }

    async function triggerSyncAll() {
      const btnAll = document.getElementById('btn-sync-all-playlists');
      const label = document.getElementById('btn-sync-all-label');
      if (isGlobalSyncing) return;
      isGlobalSyncing = true;

      if (btnAll) btnAll.classList.add('is-syncing');
      if (label) label.textContent = 'Syncing All...';

      try {
        await triggerSync(null, null);
      } finally {
        isGlobalSyncing = false;
        if (btnAll) btnAll.classList.remove('is-syncing');
        if (label) label.textContent = 'Sync All Playlists';
      }
    }

    function open() {
      const modal = document.getElementById('playlist-sync-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      loadSyncStatus();
    }

    function close() {
      const modal = document.getElementById('playlist-sync-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');

      if (window.location.hash.startsWith('#/sync')) {
        history.replaceState(null, null, window.location.pathname + window.location.search);
      }
    }

    function init() {
      // Close button & backdrop
      document.getElementById('btn-close-sync')?.addEventListener('click', close);
      document.getElementById('sync-modal-backdrop')?.addEventListener('click', close);

      // Footer Playlist Sync Link
      document.getElementById('footer-link-sync')?.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });

      // Sync All Button
      document.getElementById('btn-sync-all-playlists')?.addEventListener('click', triggerSyncAll);

      // Auto-Sync interval selector
      const intervalSelect = document.getElementById('sync-global-interval-select');
      intervalSelect?.addEventListener('change', async () => {
        const val = Number(intervalSelect.value);
        if (syncData && syncData.length > 0) {
          for (const pl of syncData) {
            await fetch(`${API_BASE}/api/playlists/sync`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlist_id: pl.id, sync_interval_mins: val })
            }).catch(() => {});
          }
        }
      });

      // On hash route #/sync or #/admin/sync
      if (window.location.hash === '#/sync' || window.location.hash === '#/admin/sync') {
        open();
      }

      window.addEventListener('hashchange', () => {
        if (window.location.hash === '#/sync' || window.location.hash === '#/admin/sync') {
          open();
        }
      });

      // Escape key to close
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modal = document.getElementById('playlist-sync-modal');
          if (modal && !modal.classList.contains('hidden')) {
            close();
          }
        }
      });

      // Periodic background sync: check once every 30 minutes
      if (!autoSyncTimer) {
        autoSyncTimer = setInterval(() => {
          loadSyncStatus().catch(() => {});
        }, 1800000);
      }
    }

    return {
      init,
      open,
      close,
      loadSyncStatus,
      triggerSync,
      triggerSyncAll
    };
  })();

  // --- Bootstrap ---
  function init() {
    let clockTimer = null;
    function startClockTimer() {
      if (clockTimer) clearInterval(clockTimer);
      updateLiveDateTime();
      clockTimer = setInterval(() => {
        if (!document.hidden) updateLiveDateTime();
      }, 1000);
    }
    startClockTimer();

    // Immediately restore cached weather if valid to prevent blank UI or layout shift
    restoreCachedWeatherIfValid();

    let lastWeatherFetch = 0;
    function refreshWeatherIfStale(force = false) {
      const now = Date.now();
      if ((force || now - lastWeatherFetch > 600000) && !document.hidden) {
        lastWeatherFetch = now;
        fetchRealLocationAndWeather(force);
      }
    }
    // --- 1. CRITICAL INITIALIZATION (App Shell, Core Controls & Playlists) ---
    initDropdownHandlers();
    initVisualsSystem();
    attachControlsListeners();
    setupCardsInitial(true);

    // --- 2. DEFERRED COOPERATIVE INITIALIZATION (Executed in Small Idle Time-Slices) ---
    const deferredTasks = [
      () => AmbientAtmosphereEngine.init(),
      () => loadInsForgePlaylists(),
      () => loadInsForgeVisuals(),
      () => initYouTubeAPI(),
      () => {
        const hasValidCache = restoreCachedWeatherIfValid();
        refreshWeatherIfStale(!hasValidCache);
        setInterval(() => refreshWeatherIfStale(false), 600000);
      },
      () => initEditorialExperienceAccordion(),
      () => initScrollReveal(),
      () => initVisualMomentParallax(),
      () => initGrandCta(),
      () => initFaqAccordion(),
      () => initStationCardClicks(),
      () => initPremium3DTilt(),
      () => LegalPagesEngine.init(),
      () => UserPlaylistEngine.init(),
      () => SupportEngine.init(),
      () => PlaylistSyncEngine.init(),
      () => AdsterraEngine.init(),
      () => {
        if (window.WeatherEffects && typeof window.WeatherEffects.init === 'function') {
          window.WeatherEffects.init();
          updateWeatherUI(window.WeatherEffects.getMode());
        }
      }
    ];

    let taskIndex = 0;
    function processDeferredQueue(deadline) {
      while (taskIndex < deferredTasks.length) {
        // If deadline is provided and time remaining is <= 8ms, yield back to browser!
        if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 8) {
          break;
        }
        try {
          deferredTasks[taskIndex++]();
        } catch (err) {
          console.warn('[Bootstrap] Deferred task notice:', err);
        }
        // If no deadline object, execute 1 task per frame and yield
        if (!deadline) break;
      }

      if (taskIndex < deferredTasks.length) {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(processDeferredQueue, { timeout: 1500 });
        } else {
          setTimeout(processDeferredQueue, 40);
        }
      }
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(processDeferredQueue, { timeout: 1200 });
    } else {
      setTimeout(processDeferredQueue, 100);
    }

    // Auto-sync with InsForge on focus (throttled to 5 minutes to eliminate mobile battery drain)
    let lastFocusSync = Date.now();
    window.addEventListener('focus', () => {
      reconcilePlaybackOnForeground();
      const now = Date.now();
      if (now - lastFocusSync > 300000) {
        lastFocusSync = now;
        loadInsForgePlaylists(true);
        loadInsForgeVisuals(true);
      }
    });

    // Page Lifecycle Manager (bfcache & foreground return)
    window.addEventListener('pageshow', () => {
      updateLiveDateTime();
      reconcilePlaybackOnForeground();
    });

    // Central Visibility Manager for progress, audio reconciliation and clock
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updateLiveDateTime();
        reconcilePlaybackOnForeground();
      } else {
        stopProgressTracker();
      }
    });

    // Online / Offline Network Resilience Manager
    window.addEventListener('online', () => {
      console.log('[GULLYGANG Network] Connection restored — background revalidation triggered');
      loadInsForgePlaylists(true);
      if (state.currentPlaylist) {
        loadPlaylistSongs(state.currentPlaylist, false);
      }
    });

    window.addEventListener('offline', () => {
      console.log('[GULLYGANG Network] Offline detected — continuing with cached content & active player');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
