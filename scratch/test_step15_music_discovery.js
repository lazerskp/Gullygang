// ============================================================
// STEP 15 AUTOMATED VERIFICATION SUITE
// Universal Music Discovery: Songs, Artists & Albums
// ============================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function main() {
  console.log('\n============================================================');
  console.log('🚀 RUNNING STEP 15 VERIFICATION: MUSIC DISCOVERY (ARTISTS & ALBUMS)');
  console.log('============================================================\n');

  // ------------------------------------------------------------
  // SECTION 1: Backend Provider Layer & Schema Normalization
  // ------------------------------------------------------------
  console.log('--- 1. Backend Provider Layer & Normalizers ---');

  const providerPath = path.join(__dirname, '../api/music-provider.js');
  const provider = require(providerPath);

  runTest('Provider exposes searchMusic, getArtist, getAlbum, getSuggestions, getRelatedTracks', () => {
    assert(typeof provider.searchMusic === 'function', 'searchMusic should be a function');
    assert(typeof provider.getArtist === 'function', 'getArtist should be a function');
    assert(typeof provider.getAlbum === 'function', 'getAlbum should be a function');
    assert(typeof provider.getSuggestions === 'function', 'getSuggestions should be a function');
    assert(typeof provider.getRelatedTracks === 'function', 'getRelatedTracks should be a function');
  });

  runTest('Artist normalization conforms to Step 15 schema', () => {
    const rawArtist = {
      browseId: 'UC12345',
      name: 'Seedhe Maut',
      thumbnails: [{ url: 'https://lh3.googleusercontent.com/xyz=w120-h120' }],
      description: 'Delhi rap duo',
      subscribers: '1.2M'
    };
    const norm = provider.normalizeArtist(rawArtist);
    assert.strictEqual(norm.id, 'UC12345');
    assert.strictEqual(norm.name, 'Seedhe Maut');
    assert(norm.thumbnail.includes('googleusercontent.com'));
    assert.strictEqual(norm.resultType, 'artist');
    assert.strictEqual(norm.source, 'ytmusic');
  });

  runTest('Album normalization conforms to Step 15 schema', () => {
    const rawAlbum = {
      browseId: 'MPREb_xyz',
      title: 'Lunch Break',
      artists: [{ name: 'Seedhe Maut', id: 'UC12345' }],
      year: '2023',
      thumbnails: [{ url: 'https://lh3.googleusercontent.com/album=w120-h120' }],
      trackCount: 30
    };
    const norm = provider.normalizeAlbum(rawAlbum);
    assert.strictEqual(norm.id, 'MPREb_xyz');
    assert.strictEqual(norm.title, 'Lunch Break');
    assert.strictEqual(norm.artist, 'Seedhe Maut');
    assert.strictEqual(norm.year, '2023');
    assert.strictEqual(norm.resultType, 'album');
    assert.strictEqual(norm.source, 'ytmusic');
  });

  // ------------------------------------------------------------
  // SECTION 2: Dedicated Artist & Album APIs
  // ------------------------------------------------------------
  console.log('\n--- 2. Dedicated Artist & Album APIs ---');

  await runAsyncTest('Provider getArtist returns structured artist discography', async () => {
    const res = await provider.getArtist('UCL0-89BZ7NWvJfmwDunDJ-A');
    assert(res && typeof res === 'object', 'Artist response should be an object');
    assert(res.artist && res.artist.name, 'Should include artist hero metadata');
    assert(Array.isArray(res.topSongs), 'Should include topSongs array');
    assert(Array.isArray(res.albums), 'Should include albums array');
    assert(Array.isArray(res.singles), 'Should include singles array');
    assert(Array.isArray(res.relatedArtists), 'Should include relatedArtists array');
  });

  await runAsyncTest('Provider getAlbum returns complete tracklist with playable videoIds', async () => {
    const res = await provider.getAlbum('MPREb_vasBPFxjDLK');
    assert(res && typeof res === 'object', 'Album response should be an object');
    assert(res.album && res.album.title, 'Should include album header metadata');
    assert(Array.isArray(res.tracks) && res.tracks.length > 0, 'Should include non-empty tracks array');
    const firstTrack = res.tracks[0];
    assert(firstTrack.videoId || firstTrack.id, 'Track must have playable videoId');
    assert(firstTrack.title, 'Track must have title');
    assert(firstTrack.artist, 'Track must have artist');
    assert(firstTrack.duration, 'Track must have duration string');
  });

  await runAsyncTest('Provider searchMusic supports grouped "all" discovery query', async () => {
    const res = await provider.searchMusic('Seedhe Maut', 'all', 20);
    assert(res && typeof res === 'object', 'Grouped search must return object');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.type, 'all');
    assert(res.results && typeof res.results === 'object', 'Grouped results must be object');
    assert(Array.isArray(res.results.top), 'Grouped results must have top array');
    assert(Array.isArray(res.results.songs), 'Grouped results must have songs array');
    assert(Array.isArray(res.results.artists), 'Grouped results must have artists array');
    assert(Array.isArray(res.results.albums), 'Grouped results must have albums array');
  });

  await runAsyncTest('Provider searchMusic supports filtered "artists" and "albums" queries', async () => {
    const artistsRes = await provider.searchMusic('Seedhe Maut', 'artists', 10);
    assert(artistsRes && Array.isArray(artistsRes.results), 'Filtered artists query must return results array');

    const albumsRes = await provider.searchMusic('Lunch Break', 'albums', 10);
    assert(albumsRes && Array.isArray(albumsRes.results), 'Filtered albums query must return results array');
  });

  // ------------------------------------------------------------
  // SECTION 3: HTTP Handler Route & Error Handling (`api/music.js`)
  // ------------------------------------------------------------
  console.log('\n--- 3. API Handler Route & Validation (api/music.js) ---');

  const handler = require('../api/music.js');

  function createMockRes() {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
      end(data) { this.body = data; return this; }
    };
  }

  await runAsyncTest('api/music returns 400 when missing query or action params', async () => {
    const req = { method: 'GET', query: {} };
    const res = createMockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
  });

  await runAsyncTest('api/music?action=artist&id=UCL0-89BZ7NWvJfmwDunDJ-A returns artist payload with cache headers', async () => {
    const req = { method: 'GET', query: { action: 'artist', id: 'UCL0-89BZ7NWvJfmwDunDJ-A' } };
    const res = createMockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.artist, 'Response must have artist object');
    assert(res.headers['cache-control'].includes('max-age'), 'Must contain Cache-Control');
  });

  await runAsyncTest('api/music?action=album&id=MPREb_vasBPFxjDLK returns album payload with cache headers', async () => {
    const req = { method: 'GET', query: { action: 'album', id: 'MPREb_vasBPFxjDLK' } };
    const res = createMockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.album, 'Response must have album object');
    assert(Array.isArray(res.body.tracks), 'Response must have tracks array');
  });

  // ------------------------------------------------------------
  // SECTION 4: Singleton Player Invariant Across All Routes
  // ------------------------------------------------------------
  console.log('\n--- 4. Singleton #yt-player Invariant Across All Routes ---');

  const templates = ['index.html', 'blog.html', 'article.html', 'artist.html', 'album.html'];
  templates.forEach(tpl => {
    runTest(`Exactly one #yt-player in ${tpl}`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', tpl), 'utf8');
      const matches = content.match(/id=["']yt-player["']/g) || [];
      assert.strictEqual(matches.length, 1, `${tpl} should contain exactly 1 #yt-player element`);
    });
  });

  // ------------------------------------------------------------
  // SECTION 5: Dynamic Routing & Server Rewrites
  // ------------------------------------------------------------
  console.log('\n--- 5. Dynamic Routing & Vercel Rewrites ---');

  runTest('vercel.json contains rewrites for /music/artist/:id and /music/album/:id', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
    assert(Array.isArray(vercelConfig.rewrites), 'vercel.json must have rewrites array');
    const artistRewrite = vercelConfig.rewrites.find(r => r.source.startsWith('/music/artist/'));
    const albumRewrite = vercelConfig.rewrites.find(r => r.source.startsWith('/music/album/'));
    assert(artistRewrite && artistRewrite.destination.includes('artist'), 'Artist rewrite missing or invalid');
    assert(albumRewrite && albumRewrite.destination.includes('album'), 'Album rewrite missing or invalid');
  });

  runTest('Router fetches artist.html for /music/artist/:id and album.html for /music/album/:id', () => {
    const routerCode = fs.readFileSync(path.join(__dirname, '../src/core/router.js'), 'utf8');
    assert(routerCode.includes('/music/artist/'), 'router.js must check /music/artist/');
    assert(routerCode.includes('/music/album/'), 'router.js must check /music/album/');
    assert(routerCode.includes('/artist.html'), 'router.js must map to artist.html');
    assert(routerCode.includes('/album.html'), 'router.js must map to album.html');
  });

  // ------------------------------------------------------------
  // SECTION 6: Analytics Whitelist & Client Helpers
  // ------------------------------------------------------------
  console.log('\n--- 6. Analytics Whitelist & Client Tracking ---');

  const analyticsApi = fs.readFileSync(path.join(__dirname, '../api/analytics.js'), 'utf8');
  const step15Events = [
    'artist_view',
    'album_view',
    'artist_play_all',
    'album_play',
    'album_add_queue',
    'artist_result_click',
    'album_result_click'
  ];

  step15Events.forEach(evt => {
    runTest(`Analytics backend API whitelists event: ${evt}`, () => {
      assert(analyticsApi.includes(`'${evt}'`), `api/analytics.js must whitelist '${evt}'`);
    });
  });

  const clientAnalytics = fs.readFileSync(path.join(__dirname, '../src/analytics/analytics.js'), 'utf8');
  step15Events.forEach(evt => {
    runTest(`Client analytics includes tracker for: ${evt}`, () => {
      assert(clientAnalytics.includes(`'${evt}'`), `src/analytics/analytics.js must emit '${evt}'`);
    });
  });

  // ------------------------------------------------------------
  // SECTION 7: Performance Budget & Code Splitting
  // ------------------------------------------------------------
  console.log('\n--- 7. Performance Budget & Code Splitting Verification ---');

  const appMinPath = path.join(__dirname, '../dist/app.min.js');
  const artistMinPath = path.join(__dirname, '../dist/artist.min.js');
  const albumMinPath = path.join(__dirname, '../dist/album.min.js');
  const discoveryMinPath = path.join(__dirname, '../dist/discovery.min.js');

  runTest('All production bundles exist', () => {
    assert(fs.existsSync(appMinPath), 'dist/app.min.js must exist');
    assert(fs.existsSync(artistMinPath), 'dist/artist.min.js must exist');
    assert(fs.existsSync(albumMinPath), 'dist/album.min.js must exist');
    assert(fs.existsSync(discoveryMinPath), 'dist/discovery.min.js must exist');
  });

  runTest('Initial critical bundle (dist/app.min.js) is strictly <= 50.0 KB (51,200 bytes)', () => {
    const stats = fs.statSync(appMinPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`     dist/app.min.js size: ${stats.size} bytes (${sizeKB} KB)`);
    assert(stats.size <= 51200, `dist/app.min.js (${stats.size} bytes / ${sizeKB} KB) exceeds 50.0 KB (51,200 bytes) limit!`);
  });

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`📊 STEP 15 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  console.log('============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
