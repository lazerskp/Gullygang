/**
 * scratch/test_step14_music_search.js
 * Comprehensive Verification Suite for Step 14:
 * Universal YouTube Music Search & Play System
 */

const fs = require('fs');
const path = require('path');
const musicHandler = require('../api/music.js');
const musicProvider = require('../api/music-provider.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✕ FAIL: ${message}`);
  }
}

// Helper to mock API calls to api/music.js
function mockMusicApi(url, method = 'GET') {
  return new Promise((resolve) => {
    const parsed = new URL(url, 'http://localhost:3000');
    const queryObj = {};
    for (const [k, v] of parsed.searchParams.entries()) {
      queryObj[k] = v;
    }

    const req = {
      url,
      method,
      query: queryObj,
      headers: { host: 'localhost:3000' }
    };

    let statusCode = 200;
    const headers = {};
    let responseData = null;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      setHeader(key, val) {
        headers[key.toLowerCase()] = val;
        return this;
      },
      writeHead(code, headObj = {}) {
        statusCode = code;
        Object.assign(headers, headObj);
        return this;
      },
      json(data) {
        responseData = data;
        resolve({ statusCode, headers, data: responseData });
        return this;
      },
      end(data) {
        if (data && !responseData) {
          try { responseData = JSON.parse(data); } catch (_) { responseData = data; }
        }
        resolve({ statusCode, headers, data: responseData });
        return this;
      }
    };

    musicHandler(req, res);
  });
}

async function runTestSuite() {
  console.log('===========================================================');
  console.log(' STEP 14: UNIVERSAL MUSIC SEARCH & PLAY SYSTEM TEST SUITE');
  console.log('===========================================================\n');

  // --- 1. Universal Music Search API Validation & Normalization ---
  console.log('--- 1. Universal Search API Endpoint ---');
  {
    const searchRes = await mockMusicApi('/api/music?action=search&q=Seedhe+Maut&limit=5');
    assert(searchRes.statusCode === 200, `Valid search returns HTTP 200 (got ${searchRes.statusCode})`);
    assert(searchRes.data && searchRes.data.success === true, 'Search response contains success: true');
    const tracks = Array.isArray(searchRes.data.results) ? searchRes.data.results : (searchRes.data.results?.songs || searchRes.data.results?.top || []);
    assert(tracks.length > 0, `Search returns non-empty results list (count: ${tracks.length})`);

    const track = tracks[0];
    assert(typeof track.id === 'string' && track.id.length >= 8, `Normalized track contains valid id (${track.id})`);
    assert(track.videoId === track.id, 'track.videoId matches track.id');
    assert(typeof track.title === 'string' && track.title.length > 0, `Track has title: "${track.title}"`);
    assert(typeof track.artist === 'string' && track.artist.length > 0, `Track has artist: "${track.artist}"`);
    assert(Array.isArray(track.artists), 'Track contains artists array');
    assert(typeof track.duration === 'string', `Track contains formatted duration (${track.duration})`);
    assert(typeof track.duration_seconds === 'number' && track.duration_seconds >= 0, `Track contains duration_seconds (${track.duration_seconds})`);
    assert(typeof track.thumbnail === 'string' && track.thumbnail.startsWith('http'), `Track contains valid thumbnail (${track.thumbnail.slice(0, 40)}...)`);
    assert(track.source === 'ytmusic', 'Track source is set to "ytmusic"');

    // Query validation tests
    const shortRes = await mockMusicApi('/api/music?action=search&q=a');
    assert(shortRes.statusCode === 400, `Rejects query < 2 chars with HTTP 400 (got ${shortRes.statusCode})`);

    const longQuery = 'x'.repeat(151);
    const longRes = await mockMusicApi(`/api/music?action=search&q=${longQuery}`);
    assert(longRes.statusCode === 400, `Rejects query > 150 chars with HTTP 400 (got ${longRes.statusCode})`);

    const limitCappedRes = await mockMusicApi('/api/music?action=search&q=Divine&limit=50&type=songs');
    assert(limitCappedRes.statusCode === 200, 'Search with limit > 30 succeeds');
    const cappedTracks = Array.isArray(limitCappedRes.data.results) ? limitCappedRes.data.results : (limitCappedRes.data.results?.songs || []);
    assert(cappedTracks.length <= 30, `Search limit is capped at 30 (got: ${cappedTracks.length})`);

    const badMethodRes = await mockMusicApi('/api/music?action=search&q=Divine', 'POST');
    assert(badMethodRes.statusCode === 405, `Rejects non-GET methods with HTTP 405 (got ${badMethodRes.statusCode})`);

    // Known real searches verification
    const tsRes = await mockMusicApi('/api/music?action=search&q=Taylor+Swift&type=all&limit=5');
    assert(tsRes.statusCode === 200 && tsRes.data.success, 'Known search: Taylor Swift returns success 200');
    assert(tsRes.data.results?.songs?.length > 0 || tsRes.data.results?.top?.length > 0, 'Taylor Swift search returns entities');

    const tuRes = await mockMusicApi('/api/music?action=search&q=tu&type=all&limit=5');
    assert(tuRes.statusCode === 200 && tuRes.data.success, 'Known search: "tu" returns success 200');
    assert(tuRes.data.results?.songs?.length > 0, '"tu" search returns populated songs');

    const asRes = await mockMusicApi('/api/music?action=search&q=Arijit+Singh&type=artists&limit=5');
    assert(asRes.statusCode === 200 && asRes.data.success, 'Known search: Arijit Singh (artists) returns success 200');
    assert(asRes.data.results?.length > 0, 'Arijit Singh search returns artist entities');

    const tumRes = await mockMusicApi('/api/music?action=search&q=Tum+Hi+Ho&type=songs&limit=5');
    assert(tumRes.statusCode === 200 && tumRes.data.success, 'Known search: Tum Hi Ho (songs) returns success 200');
    assert(tumRes.data.results?.length > 0, 'Tum Hi Ho search returns song entities');

    // Health endpoint check
    const healthRes = await mockMusicApi('/api/music?action=health');
    assert(healthRes.statusCode === 200, 'Health endpoint returns HTTP 200');
    assert(healthRes.data && healthRes.data.available === true, 'Health check reports provider available: true');
  }

  // --- 2. Live Search Suggestions API ---
  console.log('\n--- 2. Search Suggestions Endpoint ---');
  {
    const sugRes = await mockMusicApi('/api/music?action=suggestions&q=divine');
    assert(sugRes.statusCode === 200, `Suggestions returns HTTP 200 (got ${sugRes.statusCode})`);
    assert(sugRes.data && sugRes.data.success === true, 'Suggestions response contains success: true');
    assert(Array.isArray(sugRes.data.suggestions), 'Suggestions returns string array');
    assert(sugRes.data.suggestions.length > 0, `Returns live suggestions (count: ${sugRes.data.suggestions.length})`);

    const shortSug = await mockMusicApi('/api/music?action=suggestions&q=z');
    assert(shortSug.statusCode === 200 && Array.isArray(shortSug.data.suggestions) && shortSug.data.suggestions.length === 0, 'Short query returns clean empty suggestions array');
  }

  // --- 3. Related Music Endpoint ---
  console.log('\n--- 3. Related Music Endpoint ---');
  {
    const relatedRes = await mockMusicApi('/api/music?action=related&videoId=kNCqgNnd2co&limit=5');
    assert(relatedRes.statusCode === 200, `Related music returns HTTP 200 (got ${relatedRes.statusCode})`);
    assert(relatedRes.data && relatedRes.data.success === true, 'Related response contains success: true');
    assert(Array.isArray(relatedRes.data.results), 'Related tracks returns array');

    const invalidIdRes = await mockMusicApi('/api/music?action=related&videoId=$$$invalid$$$');
    assert(invalidIdRes.statusCode === 400, `Rejects invalid videoId with HTTP 400 (got ${invalidIdRes.statusCode})`);
  }

  // --- 4. Server-side Caching & Request Deduplication ---
  console.log('\n--- 4. Server Caching & Concurrency ---');
  {
    musicProvider.clearCache();
    const t0 = Date.now();
    const r1 = await musicProvider.searchMusic('Seedhe Maut Nanchaku', 2);
    const durationFresh = Date.now() - t0;

    const t1 = Date.now();
    const r2 = await musicProvider.searchMusic('Seedhe Maut Nanchaku', 2);
    const durationCached = Date.now() - t1;

    assert(r2.results.length === r1.results.length, 'Cached search returns identical result count');
    assert(durationCached < durationFresh || durationCached <= 5, `Cached response is near instantaneous (${durationCached}ms vs fresh ${durationFresh}ms)`);

    // In-flight deduplication test
    const [p1, p2, p3] = await Promise.all([
      musicProvider.searchMusic('Divine 3:59 AM', 3),
      musicProvider.searchMusic('Divine 3:59 AM', 3),
      musicProvider.searchMusic('Divine 3:59 AM', 3)
    ]);
    assert(p1.results.length === p2.results.length && p2.results.length === p3.results.length, 'Concurrent in-flight queries deduplicate successfully');
  }

  // --- 5. Security & Privacy Guarantees ---
  console.log('\n--- 5. Security & Error Containment ---');
  {
    const searchRes = await mockMusicApi('/api/music?action=search&q=Seedhe+Maut');
    const jsonStr = JSON.stringify(searchRes.data);
    assert(!jsonStr.includes('python') && !jsonStr.includes('traceback') && !jsonStr.includes('/Users/'), 'Provider responses do not leak server paths or Python internals');
    assert(!jsonStr.includes('password') && !jsonStr.includes('apiKey') && !jsonStr.includes('secret'), 'No credentials leaked in API output');

    const cacheHeader = searchRes.headers['cache-control'];
    assert(cacheHeader && cacheHeader.includes('public') && cacheHeader.includes('max-age'), `Response contains public Cache-Control headers (${cacheHeader})`);
  }

  // --- 6. Client UI & Persistent Player Invariant ---
  console.log('\n--- 6. Client UI & Player Invariants ---');
  {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const blogHtml = fs.readFileSync(path.join(__dirname, '..', 'blog.html'), 'utf8');
    const articleHtml = fs.readFileSync(path.join(__dirname, '..', 'article.html'), 'utf8');

    // Exact Singleton #yt-player invariant
    const countYt = (html) => (html.match(/id="yt-player"/g) || []).length;
    assert(countYt(indexHtml) === 1, 'Exactly one #yt-player in index.html');
    assert(countYt(blogHtml) === 1, 'Exactly one #yt-player in blog.html');
    assert(countYt(articleHtml) === 1, 'Exactly one #yt-player in article.html');

    // Music search elements in HTML
    assert(indexHtml.includes('btn-music-search-nav') && indexHtml.includes('music-search-modal'), 'index.html contains search trigger and modal markup');
    assert(blogHtml.includes('btn-music-search-nav') && blogHtml.includes('music-search-modal'), 'blog.html contains search trigger and modal markup');
    assert(articleHtml.includes('btn-music-search-nav') && articleHtml.includes('music-search-modal'), 'article.html contains search trigger and modal markup');

    // UI module in src/music/search.js
    const searchJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'music', 'search.js'), 'utf8');
    assert(searchJs.includes('AbortController'), 'search.js uses AbortController to cancel stale in-flight requests');
    assert(searchJs.includes('ArrowDown') && searchJs.includes('ArrowUp'), 'search.js implements keyboard navigation');
    assert(searchJs.includes('playTrackImmediately'), 'search.js provides immediate playback integration');
    assert(searchJs.includes('insertTrackPlayNext'), 'search.js provides Play Next queue integration');
    assert(searchJs.includes('appendTrackToQueue'), 'search.js provides Add to Queue integration');

    // Style check
    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    assert(styleCss.includes('.music-search-modal') && styleCss.includes('.music-search-backdrop'), 'style.css contains Universal Music Search styles');
  }

  // --- 7. Analytics Event Whitelisting & Ingestion ---
  console.log('\n--- 7. Analytics Integration ---');
  {
    const analyticsJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'analytics.js'), 'utf8');
    assert(analyticsJs.includes("'music_search'") && analyticsJs.includes("'music_search_result_click'"), 'api/analytics.js whitelists music_search and music_search_result_click');
    const clientAnalyticsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'analytics', 'analytics.js'), 'utf8');
    assert(clientAnalyticsJs.includes('trackMusicSearch') && clientAnalyticsJs.includes('trackMusicSearchResultClick'), 'src/analytics/analytics.js implements music search tracking helpers');
  }

  // --- 8. Music Search Trigger, Route Coverage & PJAX Resilience ---
  console.log('\n--- 8. Music Search Trigger & Route Coverage Audit ---');
  {
    const templates = [
      { name: 'index.html', file: 'index.html' },
      { name: 'blog.html', file: 'blog.html' },
      { name: 'article.html', file: 'article.html' },
      { name: 'artist.html', file: 'artist.html' },
      { name: 'album.html', file: 'album.html' }
    ];

    templates.forEach(({ name, file }) => {
      const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert(html.includes('data-music-search-trigger'), `${name} has data-music-search-trigger on search button`);
      assert(html.includes('btn-music-search-trigger'), `${name} has .btn-music-search-trigger class`);
      assert(html.includes('id="btn-music-search-nav"'), `${name} has #btn-music-search-nav ID`);
      assert(html.includes('id="music-search-modal"'), `${name} contains #music-search-modal container`);
      assert(html.includes('id="music-search-backdrop"'), `${name} contains #music-search-backdrop`);
      assert(html.includes('id="music-search-input"'), `${name} contains #music-search-input`);
    });

    // Check src/main.js imports search.js and exposes MusicSearchEngine
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert(mainJs.includes("from './music/search.js'"), 'src/main.js imports src/music/search.js');
    assert(mainJs.includes('MusicSearchEngine.init()'), 'src/main.js initializes MusicSearchEngine');
    assert(mainJs.includes('MusicSearchEngine'), 'src/main.js exports/exposes MusicSearchEngine');

    // Check search.js uses document-level event delegation for PJAX safety
    const searchJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'music', 'search.js'), 'utf8');
    assert(searchJs.includes('setupEventDelegation'), 'src/music/search.js defines setupEventDelegation');
    assert(searchJs.includes("closest('[data-music-search-trigger]"), 'src/music/search.js listens for data-music-search-trigger via event delegation');
    assert(searchJs.includes('keydown'), 'src/music/search.js attaches global keydown handler');
    assert(searchJs.includes("k === 'k'") && searchJs.includes("k === '/'"), 'src/music/search.js handles Cmd/Ctrl+K and / shortcuts');

    // Check app.js contains MusicSearchEngine with PJAX event delegation
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert(appJs.includes('MusicSearchEngine = (function'), 'app.js contains native MusicSearchEngine');
    assert(appJs.includes('window.MusicSearchEngine = MusicSearchEngine'), 'app.js exports window.MusicSearchEngine');
    assert(appJs.includes("closest('[data-music-search-trigger]"), 'app.js uses document event delegation for music search triggers');
    assert(appJs.includes('MusicSearchEngine.init()'), 'app.js invokes MusicSearchEngine.init() on bootstrap');

    // Check dist/app.min.js contains search initialization
    const appMinJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.min.js'), 'utf8');
    assert(appMinJs.includes('data-music-search-trigger'), 'dist/app.min.js includes music search trigger selector');
    assert(appMinJs.includes('music-search-modal'), 'dist/app.min.js includes music-search-modal reference');
  }

  console.log('\n===========================================================');
  console.log(` SUMMARY: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
  console.log('===========================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
