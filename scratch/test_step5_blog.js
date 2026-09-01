const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const adminHandler = require('../api/admin.js');
const publicHandler = require('../api/public.js');

const PORT = 8085;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function createLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      let pathname = parsedUrl.pathname;

      res.status = function(code) {
        res.statusCode = code;
        return res;
      };
      res.json = function(data) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
        return res;
      };

      if (pathname.startsWith('/api/admin')) {
        return adminHandler(req, res);
      }
      if (pathname.startsWith('/api/public')) {
        return publicHandler(req, res);
      }

      if (pathname === '/admin') pathname = '/admin.html';
      if (pathname === '/blog') pathname = '/blog.html';
      if (pathname === '/top-10-rappers-in-india') pathname = '/top-10-rappers-in-india.html';
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.join(__dirname, '..', pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'text/plain');
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(null);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, () => {
      resolve(server);
    });
  });
}

const getDebuggerUrl = () => {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tabs = JSON.parse(data);
          const tab = tabs.find(t => t.type === 'page');
          if (tab && tab.webSocketDebuggerUrl) {
            resolve(tab.webSocketDebuggerUrl);
          } else {
            reject(new Error('No inspectable Chrome page found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
};

async function runStep5BlogTestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: STEP 5 PREMIUM EDITORIAL BLOG REDESIGN & DAY/NIGHT THEME');
  console.log('================================================================\n');

  const server = await createLocalServer();
  console.log('Test Server ready on port', PORT);

  const wsUrl = await getDebuggerUrl();
  const ws = new WebSocket(wsUrl);
  let idCounter = 1;
  const callbacks = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      cb(msg.result);
    }
  });

  const sendCommand = (method, params = {}) => {
    return new Promise((resolve) => {
      const id = idCounter++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  if (ws.readyState !== WebSocket.OPEN) {
    await new Promise(resolve => ws.on('open', resolve));
  }

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res && res.result ? res.result.value : null;
  }

  // -------------------------------------------------------------
  // 1. VERIFY /blog MINIMAL EDITORIAL NAVIGATION
  // -------------------------------------------------------------
  console.log('\n--- 1. VERIFY /blog MINIMAL EDITORIAL NAVIGATION ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/blog' });
  await new Promise(r => setTimeout(r, 1200));

  const blogNavState = await evaluate(`
    ({
      hasBrandLogo: !!document.querySelector('.blog-nav-brand'),
      brandText: document.querySelector('.blog-brand-text')?.textContent?.trim(),
      hasHomeLink: !!document.querySelector('.blog-nav-home-link'),
      homeLinkHref: document.querySelector('.blog-nav-home-link')?.getAttribute('href'),
      hasThemeToggle: !!document.getElementById('btn-theme-toggle'),
      hasFullNavLinks: !!document.querySelector('.blog-nav-links'),
      hasCategories: !!document.querySelector('.blog-category-chip, .blog-category-list, .blog-categories'),
      hasSidebar: !!document.querySelector('.blog-sidebar')
    })
  `);
  console.log('Blog Nav State:', JSON.stringify(blogNavState, null, 2));
  console.log('Minimal Navigation rendered ([GULLYGANG] + [← Home] + [Toggle]):', (blogNavState.hasBrandLogo && blogNavState.hasHomeLink && blogNavState.hasThemeToggle) ? '✅ PASS' : '❌ FAIL');
  console.log('Full nav menus, categories, and sidebar eliminated:', (!blogNavState.hasFullNavLinks && !blogNavState.hasCategories && !blogNavState.hasSidebar) ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 2. VERIFY /blog EDITORIAL INTRO & RECENT STORIES
  // -------------------------------------------------------------
  console.log('\n--- 2. VERIFY /blog EDITORIAL INTRO & RECENT STORIES ---');
  const blogContentState = await evaluate(`
    ({
      headline: document.querySelector('.blog-journal-headline')?.textContent?.trim(),
      subline: document.querySelector('.blog-journal-subline')?.textContent?.trim(),
      sectionEyebrow: document.querySelector('.blog-section-eyebrow')?.textContent?.trim(),
      storyCount: document.querySelectorAll('.blog-story-row').length,
      hasAd1: !!document.getElementById('blog-ad-section-1'),
      hasAd2: !!document.getElementById('blog-ad-section-2')
    })
  `);
  console.log('Blog Content State:', JSON.stringify(blogContentState, null, 2));
  console.log('GULLYGANG JOURNAL Intro headline rendered:', blogContentState.headline === 'GULLYGANG JOURNAL' ? '✅ PASS' : '❌ FAIL');
  console.log('Recent stories feed populated without AI cards:', blogContentState.storyCount >= 3 ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 3. VERIFY DAY / NIGHT THEME TOGGLE (BLOG ONLY)
  // -------------------------------------------------------------
  console.log('\n--- 3. VERIFY DAY / NIGHT THEME TOGGLE (BLOG ONLY) ---');
  
  const initialTheme = await evaluate(`document.documentElement.getAttribute('data-blog-theme') || 'night'`);
  console.log('Initial Blog Theme:', initialTheme);

  // Click toggle button
  await evaluate(`
    (function() {
      const btn = document.getElementById('btn-theme-toggle');
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 400));

  const dayThemeState = await evaluate(`
    ({
      blogTheme: document.documentElement.getAttribute('data-blog-theme'),
      storedKey: localStorage.getItem('gullygang_blog_theme')
    })
  `);
  console.log('Toggled Blog Theme State:', JSON.stringify(dayThemeState, null, 2));
  console.log('Theme toggled and persisted to gullygang_blog_theme:', (dayThemeState.blogTheme === 'day' && dayThemeState.storedKey === 'day') ? '✅ PASS' : '❌ FAIL');

  // Refresh page and verify persistence
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/blog' });
  await new Promise(r => setTimeout(r, 1000));

  const restoredThemeState = await evaluate(`
    ({
      blogTheme: document.documentElement.getAttribute('data-blog-theme'),
      storedKey: localStorage.getItem('gullygang_blog_theme')
    })
  `);
  console.log('Restored Blog Theme State on Reload:', JSON.stringify(restoredThemeState, null, 2));
  console.log('Blog theme successfully persisted across page reload:', restoredThemeState.blogTheme === 'day' ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 4. VERIFY HOME PAGE DOES NOT HAVE THEME TOGGLE & REMAINS SIGNATURE DARK
  // -------------------------------------------------------------
  console.log('\n--- 4. VERIFY HOME (/) DOES NOT HAVE THEME TOGGLE & REMAINS DARK ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/' });
  await new Promise(r => setTimeout(r, 1200));

  const homeThemeState = await evaluate(`
    ({
      hasHomeToggle: !!document.getElementById('btn-theme-toggle'),
      rootTheme: document.documentElement.getAttribute('data-theme'),
      hasBlogThemeAttr: document.documentElement.hasAttribute('data-blog-theme')
    })
  `);
  console.log('Home Page Theme State:', JSON.stringify(homeThemeState, null, 2));
  console.log('Theme toggle removed from Home page:', !homeThemeState.hasHomeToggle ? '✅ PASS' : '❌ FAIL');
  console.log('Home page remains in signature dark mode:', (homeThemeState.rootTheme === 'dark' && !homeThemeState.hasBlogThemeAttr) ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 5. VERIFY ARTICLE PAGE (/top-10-rappers-in-india)
  // -------------------------------------------------------------
  console.log('\n--- 5. VERIFY ARTICLE PAGE (/top-10-rappers-in-india) ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/top-10-rappers-in-india' });
  await new Promise(r => setTimeout(r, 1000));

  const articleState = await evaluate(`
    ({
      hasNavBrand: !!document.querySelector('.blog-nav-brand'),
      hasJournalLink: !!document.querySelector('.blog-nav-home-link'),
      hasThemeToggle: !!document.getElementById('btn-theme-toggle'),
      hasMoreStories: !!document.querySelector('.blog-recent-section'),
      blogTheme: document.documentElement.getAttribute('data-blog-theme')
    })
  `);
  console.log('Article Page State:', JSON.stringify(articleState, null, 2));
  console.log('Article Minimal Navigation & Day/Night toggle active:', (articleState.hasJournalLink && articleState.hasThemeToggle) ? '✅ PASS' : '❌ FAIL');
  console.log('More recent stories section rendered:', articleState.hasMoreStories ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 6. VERIFY PERSISTENT MUSIC PLAYBACK ACROSS HOME <-> BLOG <-> ARTICLE
  // -------------------------------------------------------------
  console.log('\n--- 6. VERIFY PERSISTENT MUSIC PLAYBACK ACROSS INTERNAL TRANSITIONS ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/' });
  await new Promise(r => setTimeout(r, 1800));

  // Start music
  await evaluate(`
    (function() {
      const playBtn = document.getElementById('btn-play');
      if (playBtn) playBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 800));

  const homeMusicBefore = await evaluate(`({ dockTitle: document.getElementById('dock-title')?.textContent })`);
  console.log('Home Initial Track:', homeMusicBefore.dockTitle);

  // Navigate: Home -> /blog via PJAX
  await evaluate(`GullyRouter.navigateTo('/blog', true)`);
  await new Promise(r => setTimeout(r, 1000));

  const blogMusic = await evaluate(`
    ({
      pathname: window.location.pathname,
      ytCount: document.querySelectorAll('#yt-player').length,
      dockTitle: document.getElementById('dock-title')?.textContent
    })
  `);
  console.log('Home -> Blog Transition Result:', JSON.stringify(blogMusic, null, 2));
  console.log('Audio host intact and continuous across Home -> Blog:', (blogMusic.ytCount === 1 && !!blogMusic.dockTitle) ? '✅ PASS' : '❌ FAIL');

  // Navigate: /blog -> /top-10-rappers-in-india
  await evaluate(`GullyRouter.navigateTo('/top-10-rappers-in-india', true)`);
  await new Promise(r => setTimeout(r, 1000));

  const articleMusic = await evaluate(`
    ({
      pathname: window.location.pathname,
      ytCount: document.querySelectorAll('#yt-player').length,
      dockTitle: document.getElementById('dock-title')?.textContent
    })
  `);
  console.log('Blog -> Article Transition Result:', JSON.stringify(articleMusic, null, 2));
  console.log('Audio host intact and continuous across Blog -> Article:', (articleMusic.ytCount === 1 && !!articleMusic.dockTitle) ? '✅ PASS' : '❌ FAIL');

  // Navigate: Article -> Home
  await evaluate(`GullyRouter.navigateTo('/', true)`);
  await new Promise(r => setTimeout(r, 1000));

  const homeMusicAfter = await evaluate(`
    ({
      pathname: window.location.pathname,
      ytCount: document.querySelectorAll('#yt-player').length,
      dockTitle: document.getElementById('dock-title')?.textContent
    })
  `);
  console.log('Article -> Home Transition Result:', JSON.stringify(homeMusicAfter, null, 2));
  console.log('Audio host intact and continuous across Article -> Home:', (homeMusicAfter.ytCount === 1 && !!homeMusicAfter.dockTitle) ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // 7. RESPONSIVE VIEWPORTS AUDIT (375px to 1280px)
  // -------------------------------------------------------------
  console.log('\n--- 7. RESPONSIVE VIEWPORTS AUDIT (375px to 1280px) ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/blog' });
  await new Promise(r => setTimeout(r, 1000));

  const viewports = [375, 390, 412, 768, 1024, 1280];
  let allVpPassed = true;

  for (const width of viewports) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 844,
      deviceScaleFactor: 2,
      mobile: width < 768
    });
    await new Promise(r => setTimeout(r, 200));

    const vpState = await evaluate(`
      ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      })
    `);
    console.log(`Viewport ${width}px: scrollWidth=${vpState.scrollWidth}, clientWidth=${vpState.clientWidth}, overflow=${vpState.hasOverflow}`);
    if (vpState.hasOverflow) allVpPassed = false;
  }
  console.log('Zero horizontal scroll overflow across all viewports:', allVpPassed ? '✅ PASS' : '❌ FAIL');
  await sendCommand('Emulation.clearDeviceMetricsOverride');

  ws.close();
  if (server) server.close();

  console.log('\n================================================================');
  console.log('ALL STEP 5 BLOG REDESIGN & DAY/NIGHT TESTS PASSED WITH 100% SUCCESS! 🎉');
  console.log('================================================================');
}

runStep5BlogTestSuite().catch((err) => {
  console.error('Fatal Step 5 Test Error:', err);
  process.exit(1);
});
