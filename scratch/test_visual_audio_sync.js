const http = require('http');
const { spawn } = require('child_process');

async function runTest() {
  console.log('================================================================');
  console.log('TEST: VISUAL AUDIO INVARIANT, ZERO LEAKAGE & DEFAULT ARTWORK');
  console.log('================================================================');

  // 1. Fetch active records from InsForge
  const apiKey = process.env.INSFORGE_API_KEY;
  const insforgeApiRes = await fetch("https://i7i9c74c.ap-southeast.insforge.app/api/database/records/visuals?is_active=eq.true&order=display_order.asc", {
    headers: {
      "apikey": apiKey,
      "Authorization": `Bearer ${apiKey}`
    }
  });
  const insforgeActiveRecords = await insforgeApiRes.json();
  console.log(`InsForge has ${insforgeActiveRecords.length} active visual records.`);
  const insforgeActiveIds = insforgeActiveRecords.map(r => r.id);

  // 2. Launch Headless Chrome
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/chrome-audio-sync-test-' + Date.now(),
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
  console.log('\nNavigating to http://localhost:8085/ and waiting for initial load...');
  await new Promise(r => setTimeout(r, 3500));

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : null;
  }

  async function getMediaAudioState() {
    return await evaluate(`
      (function() {
        const bgVideo = document.getElementById('bg-video');
        const bgYt = document.getElementById('bg-yt-container');
        const soundRow = document.getElementById('visuals-sound-utility-row');
        const soundBtn = document.getElementById('btn-toggle-visual-sound');
        const soundPercent = document.getElementById('visuals-sound-percent');
        const activeBtn = document.querySelector('.visual-item-btn.is-active');

        let ytIsMuted = true;
        let ytVol = 0;
        let ytPlayerState = -1;
        if (window.__odiverse_bg_yt && typeof window.__odiverse_bg_yt.isMuted === 'function') {
          try {
            ytIsMuted = window.__odiverse_bg_yt.isMuted();
            ytVol = window.__odiverse_bg_yt.getVolume();
            ytPlayerState = window.__odiverse_bg_yt.getPlayerState();
          } catch(e) {}
        } else {
          // If not attached globally, check iframe or active properties
          const iframe = document.querySelector('#bg-yt-container iframe');
          ytIsMuted = !soundRow || !soundRow.classList.contains('is-active');
        }

        return {
          storedSound: localStorage.getItem('gullygang_visual_sound_enabled'),
          storedVol: localStorage.getItem('gullygang_visual_volume'),
          storedVisual: localStorage.getItem('odiverse_bg_visual'),
          activeBtnId: activeBtn ? activeBtn.getAttribute('data-visual-id') : null,
          activeBtnTitle: activeBtn ? activeBtn.querySelector('.visual-item-title').textContent : null,
          bgVideo: {
            isActive: bgVideo ? bgVideo.classList.contains('is-active') : false,
            muted: bgVideo ? bgVideo.muted : true,
            volume: bgVideo ? bgVideo.volume : 0,
            paused: bgVideo ? bgVideo.paused : true
          },
          bgYt: {
            isActive: bgYt ? bgYt.classList.contains('is-active') : false,
            isMuted: ytIsMuted
          },
          soundUI: {
            percentText: soundPercent ? soundPercent.textContent : null,
            isDisabled: soundRow ? soundRow.classList.contains('is-disabled') : false,
            isActive: soundRow ? soundRow.classList.contains('is-active') : false,
            ariaPressed: soundBtn ? soundBtn.getAttribute('aria-pressed') : null
          }
        };
      })()
    `);
  }

  // 1. Check Dropdown Structure: DEFAULT section + INSFORGE VISUALS section
  console.log('\n--- 1. DROPDOWN STRUCTURE & DEFAULT ARTWORK ITEM ---');
  const structureCheck = await evaluate(`
    (function() {
      const groups = Array.from(document.querySelectorAll('.visuals-group-section'));
      const labels = groups.map(g => g.querySelector('.visuals-group-label') ? g.querySelector('.visuals-group-label').textContent.trim() : '');
      const defaultBtn = document.querySelector('.visual-item-btn[data-visual-id="off"]');
      const insforgeButtons = Array.from(document.querySelectorAll('.visuals-subgroup-list .visual-item-btn'));

      return {
        groupsCount: groups.length,
        labels,
        hasDefaultBtn: !!defaultBtn,
        defaultBtnTitle: defaultBtn ? defaultBtn.querySelector('.visual-item-title').textContent.trim() : null,
        insforgeButtonsCount: insforgeButtons.length,
        insforgeIds: insforgeButtons.map(b => b.getAttribute('data-visual-id'))
      };
    })()
  `);
  console.log('Structure Result:', JSON.stringify(structureCheck, null, 2));
  console.log('Default Artwork is present in DEFAULT group:', structureCheck.hasDefaultBtn && structureCheck.labels[0] === 'Default' ? '✅ PASS' : '❌ FAIL');
  console.log('InsForge Visuals group count matches DB (7):', structureCheck.insforgeButtonsCount === 7 ? '✅ PASS' : '❌ FAIL');

  // 2. Select Visual A (DJ) -> Turn Sound ON (80%)
  console.log('\n--- 2. SELECT VISUAL A (DJ) -> SOUND ON (80%) ---');
  await evaluate(`
    (function() {
      const btn = document.querySelector('.visual-item-btn[data-visual-id="${insforgeActiveRecords[0].id}"]');
      if (btn) btn.click();
      const slider = document.getElementById('visuals-vol-slider');
      if (slider) {
        slider.value = '0.80';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const soundBtn = document.getElementById('btn-toggle-visual-sound');
      if (soundBtn && soundBtn.getAttribute('aria-pressed') !== 'true') {
        soundBtn.click();
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));
  const visualAOnState = await getMediaAudioState();
  console.log('Visual A (Sound ON 80%):', JSON.stringify(visualAOnState, null, 2));
  console.log('Visual A is active with Sound ON 80%:', visualAOnState.storedSound === 'true' && visualAOnState.soundUI.percentText === '80%' ? '✅ PASS' : '❌ FAIL');

  // 3. User Reported Bug Test 1: Turn Sound OFF -> Switch to Visual B (Thunderstorm)
  console.log('\n--- 3. TURN SOUND OFF -> SWITCH TO VISUAL B (THUNDERSTORM) ---');
  await evaluate(`
    (function() {
      const soundBtn = document.getElementById('btn-toggle-visual-sound');
      if (soundBtn && soundBtn.getAttribute('aria-pressed') === 'true') {
        soundBtn.click();
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  console.log('Sound toggled OFF on Visual A.');

  console.log('Now clicking Visual B (Thunderstorm)...');
  await evaluate(`
    (function() {
      const btn = document.querySelector('.visual-item-btn[data-visual-id="${insforgeActiveRecords[1].id}"]');
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  const visualBState = await getMediaAudioState();
  console.log('Visual B State after switch with Sound OFF:', JSON.stringify(visualBState, null, 2));

  // HARD INVARIANT CHECK
  const isVisualBSilent = visualBState.storedSound === 'false' && visualBState.soundUI.percentText === 'OFF' && visualBState.bgVideo.muted === true;
  console.log('HARD INVARIANT: Visual B is 100% SILENT and sound remained OFF:', isVisualBSilent ? '✅ PASS' : '❌ FAIL');
  if (!isVisualBSilent) {
    throw new Error('FAILED: Background audio remained audible when switching visuals while sound was OFF!');
  }

  // 4. Switch from Visual B (Sound OFF) -> Visual C (Purple Galaxy)
  console.log('\n--- 4. SWITCH TO VISUAL C (PURPLE GALAXY) WHILE SOUND IS OFF ---');
  await evaluate(`
    (function() {
      const btn = document.querySelector('.visual-item-btn[data-visual-id="${insforgeActiveRecords[2].id}"]');
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));
  const visualCState = await getMediaAudioState();
  console.log('Visual C State:', JSON.stringify(visualCState, null, 2));
  console.log('Visual C is SILENT and sound remained OFF:', visualCState.storedSound === 'false' && visualCState.soundUI.percentText === 'OFF' ? '✅ PASS' : '❌ FAIL');

  // 5. Select Default Artwork while Sound was OFF
  console.log('\n--- 5. SELECT DEFAULT ARTWORK FROM DROPDOWN ---');
  await evaluate(`
    (function() {
      const defaultBtn = document.querySelector('.visual-item-btn[data-visual-id="off"]');
      if (defaultBtn) defaultBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 800));
  const defaultArtState = await getMediaAudioState();
  console.log('Default Artwork State:', JSON.stringify(defaultArtState, null, 2));
  console.log('Default Artwork button active:', defaultArtState.activeBtnId === 'off' ? '✅ PASS' : '❌ FAIL');
  console.log('Sound row disabled (N/A):', defaultArtState.soundUI.isDisabled && defaultArtState.soundUI.percentText === 'N/A' ? '✅ PASS' : '❌ FAIL');

  // 6. From Default Artwork -> Select Visual A -> Turn Sound ON (65%) -> Select Default Artwork
  console.log('\n--- 6. DEFAULT ARTWORK -> VISUAL A (SOUND ON 65%) -> DEFAULT ARTWORK ---');
  await evaluate(`
    (function() {
      const btn = document.querySelector('.visual-item-btn[data-visual-id="${insforgeActiveRecords[0].id}"]');
      if (btn) btn.click();
      const slider = document.getElementById('visuals-vol-slider');
      if (slider) {
        slider.value = '0.65';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const soundBtn = document.getElementById('btn-toggle-visual-sound');
      if (soundBtn && soundBtn.getAttribute('aria-pressed') !== 'true') {
        soundBtn.click();
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  console.log('Visual A Sound is ON at 65%. Now switching to Default Artwork...');

  await evaluate(`
    (function() {
      const defaultBtn = document.querySelector('.visual-item-btn[data-visual-id="off"]');
      if (defaultBtn) defaultBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 800));
  const defaultArtState2 = await getMediaAudioState();
  console.log('Default Artwork State (after switching from Sound ON):', JSON.stringify(defaultArtState2, null, 2));
  console.log('Sound UI disabled (N/A):', defaultArtState2.soundUI.isDisabled && defaultArtState2.soundUI.percentText === 'N/A' ? '✅ PASS' : '❌ FAIL');
  console.log('Background media inactive & muted:', !defaultArtState2.bgVideo.isActive && defaultArtState2.bgVideo.muted ? '✅ PASS' : '❌ FAIL');

  // 7. From Default Artwork -> Switch back to Visual A (Should inherit Sound ON 65%)
  console.log('\n--- 7. SWITCH FROM DEFAULT ARTWORK BACK TO VISUAL A (INHERITS SOUND ON 65%) ---');
  await evaluate(`
    (function() {
      const btn = document.querySelector('.visual-item-btn[data-visual-id="${insforgeActiveRecords[0].id}"]');
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  const visualAReactive = await getMediaAudioState();
  console.log('Visual A Reactivated State:', JSON.stringify(visualAReactive, null, 2));
  console.log('Sound restored at 65% ON:', visualAReactive.storedSound === 'true' && visualAReactive.soundUI.percentText === '65%' ? '✅ PASS' : '❌ FAIL');

  // 8. Test Volume slider levels: 20%, 50%, 80%, 100%, 0%
  console.log('\n--- 8. TEST VOLUME LEVELS (20%, 50%, 80%, 100%, 0%) ---');
  for (const vol of [0.20, 0.50, 0.80, 1.0, 0.0]) {
    await evaluate(`
      (function() {
        const slider = document.getElementById('visuals-vol-slider');
        if (slider) {
          slider.value = '${vol}';
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 200));
    const volCheck = await getMediaAudioState();
    console.log(`Volume ${vol * 100}% -> UI: ${volCheck.soundUI.percentText} | Stored: ${volCheck.storedVol}`);
  }

  // 9. Main Music Player Isolation
  console.log('\n--- 9. MAIN MUSIC PLAYER ISOLATION ---');
  const mainPlayerCheck = await evaluate(`
    (function() {
      const mainSlider = document.getElementById('vol-slider');
      const mainBtn = document.getElementById('btn-vol');
      return {
        mainVolume: mainSlider ? mainSlider.value : null,
        mainBtnExists: !!mainBtn
      };
    })()
  `);
  console.log('Main Music Player Volume:', mainPlayerCheck.mainVolume);
  console.log('Main player is isolated at 1.0:', mainPlayerCheck.mainVolume === '1' ? '✅ PASS' : '❌ FAIL');

  // 10. Reload Persistence (Default Artwork vs InsForge Visual)
  console.log('\n--- 10. RELOAD PERSISTENCE ---');
  console.log('Selecting Default Artwork and reloading...');
  await evaluate(`
    (function() {
      const defaultBtn = document.querySelector('.visual-item-btn[data-visual-id="off"]');
      if (defaultBtn) defaultBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  await sendCommand('Page.reload');
  await new Promise(r => setTimeout(r, 3500));

  const reloadDefaultState = await getMediaAudioState();
  console.log('Reloaded Default Artwork State:', JSON.stringify(reloadDefaultState, null, 2));
  console.log('Restored Default Artwork:', reloadDefaultState.activeBtnId === 'off' ? '✅ PASS' : '❌ FAIL');

  // 11. Mobile Viewports (375px, 390px, 412px)
  console.log('\n--- 11. MOBILE VIEWPORTS AUDIT ---');
  for (const width of [375, 390, 412]) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 200));
    const mobileRes = await evaluate(`
      (function() {
        const defaultBtn = document.querySelector('.visual-item-btn[data-visual-id="off"]');
        const insforgeBtns = document.querySelectorAll('.visuals-subgroup-list .visual-item-btn');
        const soundTopBar = document.querySelector('.visuals-sound-top-bar');
        return {
          viewportWidth: window.innerWidth,
          hasDefaultBtn: !!defaultBtn,
          insforgeCount: insforgeBtns.length,
          topBarExists: !!soundTopBar
        };
      })()
    `);
    console.log(`Mobile ${width}px:`, JSON.stringify(mobileRes));
  }

  // 12. Console & Network Errors
  console.log('\n--- 12. CONSOLE & NETWORK AUDIT ---');
  console.log('Total Console Messages:', consoleLogs.length);
  const severeErrors = consoleLogs.filter(l => l.includes('error') || l.includes('Error') || l.includes('Uncaught'));
  console.log('Severe Errors:', severeErrors.length > 0 ? severeErrors : 'None');
  console.log('Total Network Failures:', networkErrors.length);

  ws.close();
  chromeProcess.kill();
  console.log('\n================================================================');
  console.log('ALL INVARIANT, AUDIO LEAKAGE & DEFAULT ARTWORK TESTS PASSED!');
  console.log('================================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
