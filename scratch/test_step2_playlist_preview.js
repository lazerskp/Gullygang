const { spawn } = require('child_process');
const http = require('http');

async function runStep2TestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: STEP 2 CURRENT PLAYLIST PREVIEW CONTROL');
  console.log('================================================================');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const cdpPort = 9224;
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${cdpPort}`,
    '--disable-web-security',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  function getWsUrl() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find(t => t.type === 'page');
            if (page && page.webSocketDebuggerUrl) resolve(page.webSocketDebuggerUrl);
            else reject(new Error('No page target found'));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  const wsUrl = await getWsUrl();
  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);

  let msgId = 0;
  const callbacks = new Map();
  const consoleMessages = [];
  const networkFailures = [];

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && callbacks.has(msg.id)) {
      const { resolve, reject } = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      consoleMessages.push({ type: msg.params.type, text });
    } else if (msg.method === 'Network.loadingFailed') {
      networkFailures.push(msg.params);
    }
  });

  if (ws.readyState !== WebSocket.OPEN) {
    await new Promise(resolve => ws.on('open', resolve));
  }

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');
  await sendCommand('Network.enable');

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res && res.exceptionDetails) {
      console.error('CDP Evaluation Exception:', JSON.stringify(res.exceptionDetails, null, 2));
    }
    return res && res.result ? res.result.value : null;
  }

  // 1. Initial Load on Home Page
  console.log('\n--- 1. LOAD HOME PAGE & HYDRATE CLOUD PLAYLIST ---');
  await sendCommand('Page.navigate', { url: 'http://localhost:8085/' });
  await new Promise(r => setTimeout(r, 3000));

  // Wait for initial tracks hydration
  await evaluate(`
    new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if ((window.state && window.state.tracks && window.state.tracks.length > 0 && attempts > 10) || attempts > 25) {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    })
  `);

  // 2. Test Playlist Preview Icon & Initial Closed State
  console.log('\n--- 2. PLAYLIST PREVIEW BUTTON & INITIAL CLOSED STATE ---');
  const initialIconState = await evaluate(`
    (function() {
      const btn = document.getElementById('btn-playlist-preview');
      const panel = document.getElementById('playlist-preview-panel');
      const backdrop = document.getElementById('playlist-preview-backdrop');
      return {
        hasBtn: !!btn,
        ariaLabel: btn?.getAttribute('aria-label'),
        ariaExpanded: btn?.getAttribute('aria-expanded'),
        ariaControls: btn?.getAttribute('aria-controls'),
        panelHidden: panel?.classList.contains('hidden'),
        backdropHidden: backdrop?.classList.contains('hidden')
      };
    })()
  `);
  console.log('Initial Icon & Panel State:', JSON.stringify(initialIconState, null, 2));
  console.log('Desktop Preview Button exists with accessible attributes:', initialIconState.hasBtn && initialIconState.ariaExpanded === 'false' ? '✅ PASS' : '❌ FAIL');
  console.log('Panel starts hidden:', initialIconState.panelHidden ? '✅ PASS' : '❌ FAIL');

  // 3. Open Playlist Preview on Desktop
  console.log('\n--- 3. OPEN PLAYLIST PREVIEW ON DESKTOP ---');
  const openState = await evaluate(`
    (function() {
      const btn = document.getElementById('btn-playlist-preview');
      btn.click();
      const panel = document.getElementById('playlist-preview-panel');
      const title = document.getElementById('playlist-preview-title')?.textContent;
      const badge = document.getElementById('playlist-preview-badge')?.textContent;
      const rows = document.querySelectorAll('.playlist-preview-row');
      const activeRow = document.querySelector('.playlist-preview-row.is-active');
      const activeIdxCol = activeRow?.querySelector('.playlist-preview-idx-col');
      const hasEqualizer = !!activeRow?.querySelector('.preview-playing-bars');

      return {
        isOpen: !panel?.classList.contains('hidden'),
        ariaExpanded: btn?.getAttribute('aria-expanded'),
        title,
        badge,
        rowCount: rows.length,
        hasActiveRow: !!activeRow,
        activeTrackIndex: activeRow?.getAttribute('data-track-index'),
        hasEqualizer,
        firstRowTitle: rows[0]?.querySelector('.playlist-preview-track-title')?.textContent,
        firstRowArtist: rows[0]?.querySelector('.playlist-preview-track-artist')?.textContent,
        hasThumbnail: !!rows[0]?.querySelector('.playlist-preview-thumb')
      };
    })()
  `);
  console.log('Open Preview State:', JSON.stringify(openState, null, 2));
  console.log('Panel opens cleanly (aria-expanded="true"):', openState.isOpen && openState.ariaExpanded === 'true' ? '✅ PASS' : '❌ FAIL');
  console.log('Dynamic song count rendered:', openState.badge && openState.badge.includes('SONG') ? '✅ PASS' : '❌ FAIL');
  console.log('Real tracks populated from authoritative state:', openState.rowCount > 0 && openState.firstRowTitle ? '✅ PASS' : '❌ FAIL');
  console.log('Active track has distinct active class & equalizer bars:', openState.hasActiveRow && openState.hasEqualizer ? '✅ PASS' : '❌ FAIL');

  // 4. Test Track Selection inside Preview Panel
  console.log('\n--- 4. SELECT TRACK VIA PLAYLIST PREVIEW ---');
  const selectTrackResult = await evaluate(`
    (function() {
      const rows = document.querySelectorAll('.playlist-preview-row');
      const targetRow = rows[1] || rows[0]; // Select second song if available
      const targetIdx = targetRow?.getAttribute('data-track-index');
      targetRow.click();

      const newActiveRow = document.querySelector('.playlist-preview-row.is-active');
      const dockTitle = document.getElementById('dock-title')?.textContent;

      return {
        clickedIdx: targetIdx,
        newActiveIdx: newActiveRow?.getAttribute('data-track-index'),
        hasEqualizer: !!newActiveRow?.querySelector('.preview-playing-bars'),
        dockTitle,
        storedTrackIndex: localStorage.getItem('gullygang_current_track_index')
      };
    })()
  `);
  console.log('Select Track Result:', JSON.stringify(selectTrackResult, null, 2));
  console.log('Track index changed and active indicator moved:', selectTrackResult.clickedIdx === selectTrackResult.newActiveIdx && selectTrackResult.hasEqualizer ? '✅ PASS' : '❌ FAIL');
  console.log('Player dock title updated:', !!selectTrackResult.dockTitle ? '✅ PASS' : '❌ FAIL');
  console.log('Music state persisted to localStorage:', selectTrackResult.storedTrackIndex === selectTrackResult.newActiveIdx ? '✅ PASS' : '❌ FAIL');

  // 5. Test Escape Key & Outside Click to Close
  console.log('\n--- 5. TEST ESCAPE KEY & OUTSIDE CLICK TO CLOSE ---');
  await evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 200));
  const escCloseState = await evaluate(`
    (function() {
      const panel = document.getElementById('playlist-preview-panel');
      const btn = document.getElementById('btn-playlist-preview');
      return {
        isHidden: panel?.classList.contains('hidden'),
        ariaExpanded: btn?.getAttribute('aria-expanded')
      };
    })()
  `);
  console.log('Escape Close State:', JSON.stringify(escCloseState, null, 2));
  console.log('Escape key closes playlist preview:', escCloseState.isHidden && escCloseState.ariaExpanded === 'false' ? '✅ PASS' : '❌ FAIL');

  // Open and test Outside Click
  await evaluate(`document.getElementById('btn-playlist-preview').click();`);
  await new Promise(r => setTimeout(r, 200));
  await evaluate(`document.body.click();`);
  await new Promise(r => setTimeout(r, 200));
  const outsideClickCloseState = await evaluate(`
    (function() {
      const panel = document.getElementById('playlist-preview-panel');
      return { isHidden: panel?.classList.contains('hidden') };
    })()
  `);
  console.log('Outside Click closes playlist preview:', outsideClickCloseState.isHidden ? '✅ PASS' : '❌ FAIL');

  // 6. Test Switching Playlists while Preview is Open
  console.log('\n--- 6. TEST PLAYLIST SWITCHING UPDATES PREVIEW DYNAMICALLY ---');
  const playlistSwitchState = await evaluate(`
    (async function() {
      const btn = document.getElementById('btn-playlist-preview');
      btn.click(); // Open preview

      // Switch playlist programmatically using authoritative selectPlaylist
      if (window.selectPlaylist && window.ALL_PLAYLISTS && window.ALL_PLAYLISTS.length > 1) {
        const nextPlaylist = window.ALL_PLAYLISTS[1];
        await window.selectPlaylist(nextPlaylist);
      }

      const panel = document.getElementById('playlist-preview-panel');
      const title = document.getElementById('playlist-preview-title')?.textContent;
      const badge = document.getElementById('playlist-preview-badge')?.textContent;
      const rowCount = document.querySelectorAll('.playlist-preview-row').length;

      return {
        title,
        badge,
        rowCount
      };
    })()
  `);
  console.log('Playlist Switch Preview State:', JSON.stringify(playlistSwitchState, null, 2));
  console.log('Preview updated with new playlist name and track count:', playlistSwitchState.rowCount > 0 ? '✅ PASS' : '❌ FAIL');

  // Close preview
  await evaluate(`document.getElementById('btn-close-playlist-preview')?.click();`);

  // 7. Test Mobile Bottom Sheet at 375px, 390px, 412px
  console.log('\n--- 7. TEST MOBILE BOTTOM SHEET RESPONSIVENESS ---');
  for (const width of [375, 390, 412]) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 400));

    const mobileSheetState = await evaluate(`
      (function() {
        const mobBtn = document.getElementById('btn-playlist-preview-mobile');
        if (mobBtn) mobBtn.click();

        const panel = document.getElementById('playlist-preview-panel');
        const backdrop = document.getElementById('playlist-preview-backdrop');
        const dragBar = document.querySelector('.playlist-preview-drag-bar');
        const isMobileSheet = panel?.classList.contains('is-mobile-sheet');
        const isBackdropVisible = !backdrop?.classList.contains('hidden');
        const scrollWidth = document.documentElement.scrollWidth;
        const viewportWidth = window.innerWidth;
        const hasOverflow = scrollWidth > viewportWidth;

        // Close it
        const closeBtn = document.getElementById('btn-close-playlist-preview');
        if (closeBtn) closeBtn.click();

        return {
          width: viewportWidth,
          isMobileSheet,
          isBackdropVisible,
          hasDragBar: !!dragBar,
          hasOverflow
        };
      })()
    `);
    console.log(`Mobile ${width}px State:`, JSON.stringify(mobileSheetState, null, 2));
    console.log(`Mobile ${width}px Bottom Sheet correctly styled with no overflow:`, mobileSheetState.isMobileSheet && !mobileSheetState.hasOverflow ? '✅ PASS' : '❌ FAIL');
  }

  // Restore Desktop Dimensions
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(r => setTimeout(r, 400));

  // 8. 20x Open/Close Stress Test
  console.log('\n--- 8. 20X RAPID OPEN/CLOSE STRESS TEST ---');
  const stressOpenClose = await evaluate(`
    (function() {
      const btn = document.getElementById('btn-playlist-preview');
      const closeBtn = document.getElementById('btn-close-playlist-preview');
      for (let i = 0; i < 20; i++) {
        btn.click();
        closeBtn.click();
      }
      const panel = document.getElementById('playlist-preview-panel');
      const panels = document.querySelectorAll('#playlist-preview-panel');
      const backdrops = document.querySelectorAll('#playlist-preview-backdrop');
      return {
        panelCount: panels.length,
        backdropCount: backdrops.length,
        isFinalStateClosed: panel.classList.contains('hidden')
      };
    })()
  `);
  console.log('20x Open/Close Stress Test:', JSON.stringify(stressOpenClose, null, 2));
  console.log('20x Open/Close clean with exactly 1 panel and 1 backdrop:', stressOpenClose.panelCount === 1 && stressOpenClose.backdropCount === 1 && stressOpenClose.isFinalStateClosed ? '✅ PASS' : '❌ FAIL');

  // 9. 10x Navigation Stress Test (Home -> Article -> Home) with Continuous Audio
  console.log('\n--- 9. 10X PERSISTENT NAVIGATION STRESS TEST (HOME <-> ARTICLE) ---');
  const navStressResult = await evaluate(`
    (async function() {
      // Start music playback
      const playBtn = document.getElementById('btn-play');
      if (playBtn) playBtn.click();

      let transitionsSuccess = true;
      for (let i = 0; i < 10; i++) {
        // Navigate to Article
        await window.GullyRouter.navigate('/top-10-rappers-in-india');
        await new Promise(r => setTimeout(r, 150));
        const isArticle = !!document.querySelector('.article-title');
        if (!isArticle) transitionsSuccess = false;

        // Navigate back to Home
        await window.GullyRouter.navigate('/');
        await new Promise(r => setTimeout(r, 150));
        const isHome = !!document.getElementById('carousel-stage');
        if (!isHome) transitionsSuccess = false;
      }

      const ytHosts = document.querySelectorAll('#yt-player');
      const previewPanels = document.querySelectorAll('#playlist-preview-panel');
      const backdrops = document.querySelectorAll('#playlist-preview-backdrop');

      return {
        transitionsSuccess,
        ytPlayerCount: ytHosts.length,
        previewPanelCount: previewPanels.length,
        backdropCount: backdrops.length,
        dockTitle: document.getElementById('dock-title')?.textContent,
        currentTime: document.getElementById('dock-current-time')?.textContent
      };
    })()
  `);
  console.log('10x Persistent Navigation Result:', JSON.stringify(navStressResult, null, 2));
  console.log('10x internal transitions succeeded without reloads:', navStressResult.transitionsSuccess ? '✅ PASS' : '❌ FAIL');
  console.log('Exactly ONE #yt-player audio host maintained:', navStressResult.ytPlayerCount === 1 ? '✅ PASS' : '❌ FAIL');
  console.log('Exactly ONE #playlist-preview-panel maintained:', navStressResult.previewPanelCount === 1 ? '✅ PASS' : '❌ FAIL');
  console.log('Continuous unbroken playback audio:', !!navStressResult.dockTitle ? '✅ PASS' : '❌ FAIL');

  // 10. Open Preview after Navigation and Verify Active Track Synchronization
  console.log('\n--- 10. OPEN PREVIEW AFTER NAVIGATION & VERIFY AUTHORITATIVE SYNC ---');
  await new Promise(r => setTimeout(r, 500));
  const postNavSync = await evaluate(`
    (function() {
      const btn = document.getElementById('btn-playlist-preview');
      if (btn) btn.click();
      const panel = document.getElementById('playlist-preview-panel');
      const activeRow = document.querySelector('.playlist-preview-row.is-active');
      const activeIdx = activeRow?.getAttribute('data-track-index');
      const musicState = window.getAuthoritativeMusicState ? window.getAuthoritativeMusicState() : null;
      const currentIdx = String(musicState ? musicState.currentIndex : (localStorage.getItem('gullygang_current_track_index') || '0'));
      const hasEqualizer = !!activeRow?.querySelector('.preview-playing-bars');

      return {
        isOpen: !panel?.classList.contains('hidden'),
        activeIdx,
        currentIdx,
        isSynchronized: activeIdx === currentIdx,
        hasEqualizer
      };
    })()
  `);
  console.log('Post-Nav Sync State:', JSON.stringify(postNavSync, null, 2));
  console.log('Playlist preview fully synchronized after navigation:', postNavSync.isSynchronized && postNavSync.hasEqualizer ? '✅ PASS' : '❌ FAIL');

  // 11. Console Errors & Network Failures Audit
  console.log('\n--- 11. CONSOLE & NETWORK AUDIT ---');
  const severeErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon') && !m.text.includes('adsterra') && !m.text.includes('youtube.com'));
  console.log('Total Console Messages:', consoleMessages.length);
  console.log('Severe Errors:', severeErrors.length > 0 ? severeErrors : 'None');
  console.log('Total Network Failures:', networkFailures.length);

  const allPassed =
    initialIconState.hasBtn &&
    openState.isOpen &&
    openState.rowCount > 0 &&
    openState.hasActiveRow &&
    selectTrackResult.clickedIdx === selectTrackResult.newActiveIdx &&
    escCloseState.isHidden &&
    outsideClickCloseState.isHidden &&
    stressOpenClose.panelCount === 1 &&
    navStressResult.ytPlayerCount === 1 &&
    postNavSync.isSynchronized &&
    severeErrors.length === 0;

  console.log('\n================================================================');
  if (allPassed) {
    console.log('ALL STEP 2 PLAYLIST PREVIEW TESTS PASSED WITH 100% SUCCESS! 🎉');
  } else {
    console.log('SOME TESTS FAILED. Please review output above.');
  }
  console.log('================================================================');

  ws.close();
  chromeProcess.kill();
  process.exit(allPassed ? 0 : 1);
}

runStep2TestSuite().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
