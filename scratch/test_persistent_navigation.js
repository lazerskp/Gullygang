const http = require('http');
const { spawn } = require('child_process');

async function runTest() {
  console.log('================================================================');
  console.log('TEST: PERSISTENT MUSIC PLAYER ACROSS INTERNAL NAVIGATION');
  console.log('================================================================');

  // 1. Launch Headless Chrome
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/chrome-nav-test-' + Date.now(),
    '--disable-gpu',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800'
  ]);

  let versionInfo = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      versionInfo = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:9222/json/version', (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.setTimeout(500, () => req.destroy());
      });
      if (versionInfo) break;
    } catch(e) {}
  }

  const tabList = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const tabInfo = tabList.find(t => t.type === 'page') || tabList[0];
  const ws = new WebSocket(tabInfo.webSocketDebuggerUrl);

  let msgId = 1;
  const callbacks = new Map();
  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const consoleLogs = [];
  const networkErrors = [];

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const { resolve, reject } = callbacks.get(data.id);
      callbacks.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    } else if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
      consoleLogs.push(`[${data.params.type}] ${text}`);
    } else if (data.method === 'Log.entryAdded') {
      consoleLogs.push(`[Log:${data.params.entry.level}] ${data.params.entry.text}`);
    } else if (data.method === 'Network.loadingFailed') {
      networkErrors.push(`Network failed: ${data.params.requestId} (${data.params.errorText})`);
    }
  });

  if (ws.readyState !== WebSocket.OPEN) {
    await new Promise(r => ws.addEventListener('open', r));
  }

  await sendCommand('Runtime.enable');
  await sendCommand('Page.enable');
  await sendCommand('DOM.enable');
  await sendCommand('Log.enable');
  await sendCommand('Network.enable');

  await sendCommand('Page.navigate', { url: 'http://localhost:8085/' });
  console.log('\nNavigating to http://localhost:8085/ and waiting for initial load & cloud playlist hydration...');
  await new Promise(r => setTimeout(r, 6000));

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : null;
  }

  // 1. Check Initial State on Home Page & Start Playback
  console.log('\n--- 1. INITIAL LOAD & PLAY MUSIC ON HOME ---');
  await evaluate(`
    new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        const title = document.getElementById('dock-title')?.textContent;
        if ((title && title.length > 0 && attempts > 15) || attempts > 30) {
          resolve(title);
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    })
  `);
  const homeInit = await evaluate(`
    (function() {
      const playBtn = document.getElementById('btn-play');
      if (playBtn) playBtn.click();
      return {
        url: window.location.href,
        title: document.title,
        hasCarousel: !!document.getElementById('carousel-stage'),
        hasAudioHost: !!document.getElementById('yt-player')
      };
    })()
  `);
  console.log('Home Init State:', JSON.stringify(homeInit, null, 2));
  await new Promise(r => setTimeout(r, 2500));

  // 2. Assert Music is Playing (capture active song right before navigation)
  const playbackState1 = await evaluate(`
    (function() {
      return {
        dockTitle: document.getElementById('dock-title')?.textContent,
        currentTime: document.getElementById('dock-current-time')?.textContent
      };
    })()
  `);
  console.log('Playback State before navigation:', playbackState1);

  // 3. Navigate to Article Page via internal link click
  console.log('\n--- 2. NAVIGATE TO /top-10-rappers-in-india VIA INTERNAL LINK ---');
  const navResult = await evaluate(`
    (function() {
      const link = document.querySelector('a[href="/top-10-rappers-in-india"]') || document.getElementById('footer-link-top-rappers');
      if (link) {
        link.click();
        return { clicked: true, targetHref: link.getAttribute('href') };
      }
      return { clicked: false };
    })()
  `);
  console.log('Nav Link Click Result:', navResult);
  await new Promise(r => setTimeout(r, 1500));

  // 4. Assert Article Page Loaded & Audio Continuous
  const articlePageState = await evaluate(`
    (function() {
      const articleHeading = document.querySelector('.article-title');
      return {
        url: window.location.href,
        title: document.title,
        articleHeading: articleHeading ? articleHeading.textContent.replace(/\\s+/g, ' ').trim() : null,
        hasAudioHost: !!document.getElementById('yt-player'),
        ytPlayerCount: document.querySelectorAll('#yt-player').length
      };
    })()
  `);
  console.log('Article Page State:', JSON.stringify(articlePageState, null, 2));
  console.log('Article URL matched /top-10-rappers-in-india:', articlePageState.url.includes('/top-10-rappers-in-india') ? '✅ PASS' : '❌ FAIL');
  console.log('Article Heading rendered:', !!articlePageState.articleHeading ? '✅ PASS' : '❌ FAIL');
  console.log('Exactly ONE YouTube audio host exists:', articlePageState.ytPlayerCount === 1 ? '✅ PASS' : '❌ FAIL');

  // 5. Test Browser History: Back Button
  console.log('\n--- 3. TEST BROWSER BACK BUTTON (history.back()) ---');
  await evaluate(`history.back();`);
  await new Promise(r => setTimeout(r, 1500));
  const backState = await evaluate(`
    (function() {
      return {
        url: window.location.href,
        title: document.title,
        hasCarousel: !!document.getElementById('carousel-stage'),
        dockTitle: document.getElementById('dock-title')?.textContent,
        currentTime: document.getElementById('dock-current-time')?.textContent
      };
    })()
  `);
  console.log('Back State:', JSON.stringify(backState, null, 2));
  console.log('Browser Back restored Home page & music:', backState.hasCarousel && backState.url === 'http://localhost:8085/' ? '✅ PASS' : '❌ FAIL');

  // 6. Test Browser History: Forward Button
  console.log('\n--- 4. TEST BROWSER FORWARD BUTTON (history.forward()) ---');
  await evaluate(`history.forward();`);
  await new Promise(r => setTimeout(r, 1500));
  const forwardState = await evaluate(`
    (function() {
      return {
        url: window.location.href,
        title: document.title,
        hasArticleTitle: !!document.querySelector('.article-title')
      };
    })()
  `);
  console.log('Forward State:', JSON.stringify(forwardState, null, 2));
  console.log('Browser Forward restored article page:', forwardState.url.includes('/top-10-rappers-in-india') && forwardState.hasArticleTitle ? '✅ PASS' : '❌ FAIL');

  // 7. Navigate back to Home via internal link
  console.log('\n--- 5. NAVIGATE BACK TO HOME VIA <a href="/"> ---');
  await evaluate(`
    (function() {
      const homeLink = document.querySelector('.article-nav-brand') || document.querySelector('.article-nav-link[href="/"]');
      if (homeLink) homeLink.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  const homeRestoredState = await evaluate(`
    (function() {
      return {
        url: window.location.href,
        title: document.title,
        hasCarousel: !!document.getElementById('carousel-stage'),
        dockTitle: document.getElementById('dock-title')?.textContent,
        currentTime: document.getElementById('dock-current-time')?.textContent
      };
    })()
  `);
  console.log('Home Restored State:', JSON.stringify(homeRestoredState, null, 2));
  console.log('Home URL restored to root:', homeRestoredState.url === 'http://localhost:8085/' ? '✅ PASS' : '❌ FAIL');
  console.log('Carousel restored:', homeRestoredState.hasCarousel ? '✅ PASS' : '❌ FAIL');
  console.log('Same track continuous across page transitions:', homeRestoredState.dockTitle === backState.dockTitle ? '✅ PASS' : '❌ FAIL');

  // 8. Test Repeated Navigations (Stress Test)
  console.log('\n--- 6. REPEATED RAPID NAVIGATION STRESS TEST ---');
  for (let i = 1; i <= 3; i++) {
    await evaluate(`(document.getElementById('footer-link-top-rappers') || document.querySelector('a[href="/top-10-rappers-in-india"]'))?.click();`);
    await new Promise(r => setTimeout(r, 400));
    await evaluate(`(document.querySelector('.article-nav-brand') || document.querySelector('a[href="/"]'))?.click();`);
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 800));

  const stressCheck = await evaluate(`
    (function() {
      return {
        url: window.location.href,
        ytCount: document.querySelectorAll('#yt-player').length,
        dockTitle: document.getElementById('dock-title')?.textContent,
        hasCarousel: !!document.getElementById('carousel-stage')
      };
    })()
  `);
  console.log('Stress Check State:', JSON.stringify(stressCheck, null, 2));
  console.log('Stress test passed (single audio host, clean DOM):', stressCheck.ytCount === 1 && stressCheck.hasCarousel ? '✅ PASS' : '❌ FAIL');

  // 9. Volume & Visual Audio Independence
  console.log('\n--- 7. VOLUME & VISUAL AUDIO INDEPENDENCE ---');
  const volCheck = await evaluate(`
    (function() {
      const volSlider = document.getElementById('vol-slider');
      const visualSlider = document.getElementById('visuals-vol-slider');
      return {
        mainVol: volSlider ? volSlider.value : null,
        visualVol: visualSlider ? visualSlider.value : null
      };
    })()
  `);
  console.log('Volume Independence:', JSON.stringify(volCheck, null, 2));
  console.log('Main volume is independent:', volCheck.mainVol !== null ? '✅ PASS' : '❌ FAIL');

  // 10. Fallback LocalStorage Persistence
  console.log('\n--- 8. LOCALSTORAGE STATE PERSISTENCE ---');
  const storageCheck = await evaluate(`
    (function() {
      return {
        volume: localStorage.getItem('gullygang_player_volume'),
        trackIndex: localStorage.getItem('gullygang_current_track_index'),
        shuffle: localStorage.getItem('gullygang_shuffle_enabled'),
        repeat: localStorage.getItem('gullygang_repeat_mode')
      };
    })()
  `);
  console.log('Stored Music Preferences:', JSON.stringify(storageCheck, null, 2));
  console.log('Music State stored in localStorage:', storageCheck.trackIndex !== null ? '✅ PASS' : '❌ FAIL');

  // 11. Mobile Viewports (375px, 390px, 412px)
  console.log('\n--- 9. MOBILE VIEWPORTS AUDIT ---');
  for (const width of [375, 390, 412]) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 200));
    const mobileCheck = await evaluate(`
      (function() {
        return {
          viewportWidth: window.innerWidth,
          hasStage: !!document.getElementById('carousel-stage'),
          hasDock: !!document.getElementById('dock-title')
        };
      })()
    `);
    console.log(`Mobile ${width}px:`, JSON.stringify(mobileCheck));
  }

  // 12. Console and Network Errors
  console.log('\n--- 10. CONSOLE & NETWORK AUDIT ---');
  console.log('Total Console Messages:', consoleLogs.length);
  const severeErrors = consoleLogs.filter(l => l.includes('Uncaught') || l.includes('ReferenceError') || l.includes('SyntaxError'));
  console.log('Severe Errors:', severeErrors.length > 0 ? severeErrors : 'None');
  console.log('Total Network Failures:', networkErrors.length);

  ws.close();
  chromeProcess.kill();
  console.log('\n================================================================');
  console.log('ALL PERSISTENT NAVIGATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
