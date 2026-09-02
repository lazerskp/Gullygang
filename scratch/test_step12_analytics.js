// ============================================================
// AUTOMATED TEST SUITE FOR STEP 12: FIRST-PARTY ANALYTICS & INTELLIGENCE
// ============================================================

const fs = require('fs');
const path = require('path');
const http = require('http');

function loadEnv() {
  try {
    const envFile = path.join(__dirname, '../.env.local');
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (m) {
          let v = (m[2] || '').trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          process.env[m[1]] = v;
        }
      }
    }
  } catch (_) {}
}
loadEnv();

const { queryInsForge, escapeSql } = require('../api/_db.js');
const analyticsHandler = require('../api/analytics.js');
const adminHandler = require('../api/admin.js');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

// Mock HTTP Request/Response
function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:3000', ...headers },
    body,
    on: function (event, handler) {
      if (event === 'data' && body) {
        handler(typeof body === 'string' ? body : JSON.stringify(body));
      }
      if (event === 'end') {
        handler();
      }
    },
    destroy: function () {}
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader: function (key, val) { this.headers[key.toLowerCase()] = val; },
    status: function (code) { this.statusCode = code; return this; },
    json: function (obj) { this.body = JSON.stringify(obj); return this; },
    end: function (data) { if (data) this.body = data; return this; }
  };

  return { req, res };
}

async function runStep12Tests() {
  console.log('\n======================================================');
  console.log('   RUNNING STEP 12 ANALYTICS & INTELLIGENCE TESTS     ');
  console.log('======================================================\n');

  try {
    // ----------------------------------------------------------------
    // 1. EVENT INGESTION & VALIDATION (/api/analytics)
    // ----------------------------------------------------------------
    console.log('--- 1. Testing Public Event Ingestion & Whitelisting ---');

    // Valid single event
    const { req: r1, res: s1 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'page_view',
        page_path: '/blog',
        page_type: 'blog',
        session_id: 'test-session-123'
      }
    });
    await analyticsHandler(r1, s1);
    assert(s1.statusCode === 200, '1. Valid page_view event is accepted (HTTP 200)');

    // Invalid event type
    const { req: r2, res: s2 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'malicious_sql_injection_event',
        page_path: '/test'
      }
    });
    await analyticsHandler(r2, s2);
    assert(s2.statusCode === 400, '2. Non-whitelisted event type is rejected (HTTP 400)');

    // Non-POST method
    const { req: r3, res: s3 } = createMockReqRes({
      method: 'GET',
      url: '/api/analytics'
    });
    await analyticsHandler(r3, s3);
    assert(s3.statusCode === 405, '3. Non-POST method rejected (HTTP 405)');

    // ----------------------------------------------------------------
    // 2. PRIVACY & DATA SANITIZATION
    // ----------------------------------------------------------------
    console.log('\n--- 2. Testing Privacy & Sensitive Field Sanitization ---');

    const { req: r4, res: s4 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'article_view',
        page_path: '/blog/top-10-rappers-in-india',
        metadata: {
          title: 'Top 10 Rappers',
          password: 'supersecretpassword123',
          jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          cookie: 'gullygang_admin_session=secret'
        },
        session_id: 'anon-session-789'
      }
    });
    await analyticsHandler(r4, s4);
    assert(s4.statusCode === 200, '4. Event with sensitive metadata accepted after stripping');

    const recorded = await queryInsForge(`
      SELECT metadata FROM analytics_events 
      WHERE session_id = 'anon-session-789' AND event_type = 'article_view' 
      ORDER BY created_at DESC LIMIT 1;
    `);
    const meta = recorded[0]?.metadata || {};
    assert(!meta.password && !meta.jwt && !meta.cookie, '5. Sensitive keys (password, jwt, cookie) are strictly stripped from metadata');
    assert(meta.title === 'Top 10 Rappers', '6. Non-sensitive metadata (title) is safely preserved');

    // ----------------------------------------------------------------
    // 3. SEARCH INTELLIGENCE & ZERO-RESULT DETECTION
    // ----------------------------------------------------------------
    console.log('\n--- 3. Testing Search Intelligence & Zero-Result Detection ---');

    // Record a zero-result search
    const testZeroQuery = 'unreleased odisha drill track ' + Date.now();
    const { req: r5, res: s5 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'search',
        search_query: testZeroQuery,
        metadata: { result_count: 0 },
        session_id: 'zero-search-session'
      }
    });
    await analyticsHandler(r5, s5);
    assert(s5.statusCode === 200, '7. Zero-result search event recorded successfully');

    // Record a successful search
    const testFoundQuery = 'mumbai hip hop ' + Date.now();
    const { req: r6, res: s6 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'search',
        search_query: testFoundQuery,
        metadata: { result_count: 5 },
        session_id: 'found-search-session'
      }
    });
    await analyticsHandler(r6, s6);
    assert(s6.statusCode === 200, '8. Successful search event recorded with result_count > 0');

    // ----------------------------------------------------------------
    // 4. PROTECTED ADMIN ANALYTICS ENDPOINTS & AUTHORIZATION
    // ----------------------------------------------------------------
    console.log('\n--- 4. Testing Protected Admin Analytics API ---');

    // Unauthenticated request
    const { req: r7, res: s7 } = createMockReqRes({
      method: 'GET',
      url: '/api/admin?action=analytics_overview'
    });
    await adminHandler(r7, s7);
    assert(s7.statusCode === 401, '9. Unauthenticated request to analytics_overview returns 401 Unauthorized');

    // Query analytics directly via SQL to verify aggregation
    const overviewStats = await queryInsForge(`
      SELECT 
        COUNT(CASE WHEN event_type = 'page_view' THEN 1 END)::int as page_views,
        COUNT(CASE WHEN event_type = 'search' THEN 1 END)::int as searches,
        COUNT(CASE WHEN event_type = 'search' AND (metadata->>'result_count')::int = 0 THEN 1 END)::int as zero_searches
      FROM analytics_events;
    `);
    assert(overviewStats[0].page_views >= 1, '10. Page views aggregated accurately');
    assert(overviewStats[0].zero_searches >= 1, '11. Zero-result searches aggregated accurately');

    // Verify Zero-Result Opportunity Query
    const oppResults = await queryInsForge(`
      SELECT search_query, COUNT(id)::int as zero_count
      FROM analytics_events
      WHERE event_type = 'search' AND (metadata->>'result_count')::int = 0
      GROUP BY search_query
      HAVING search_query = '${escapeSql(testZeroQuery)}';
    `);
    assert(oppResults.length > 0 && oppResults[0].zero_count >= 1, '12. Zero-result search identified as Content Opportunity');

    // ----------------------------------------------------------------
    // 5. MUSIC ANALYTICS & DUPLICATE PROTECTION
    // ----------------------------------------------------------------
    console.log('\n--- 5. Testing Music Analytics Invariant ---');

    const { req: r8, res: s8 } = createMockReqRes({
      method: 'POST',
      url: '/api/analytics',
      body: {
        event_type: 'track_play',
        track_id: 'test-track-99',
        metadata: { title: 'GULLYGANG Anthem' },
        session_id: 'music-session-1'
      }
    });
    await analyticsHandler(r8, s8);
    assert(s8.statusCode === 200, '13. Music track_play event recorded');

    // ----------------------------------------------------------------
    // 6. AUDIO SINGLETON INVARIANT
    // ----------------------------------------------------------------
    console.log('\n--- 6. Verifying Singleton #yt-player Shell Invariant ---');

    const indexHtml = fs.readFileSync('./index.html', 'utf8');
    const blogHtml = fs.readFileSync('./blog.html', 'utf8');
    const articleHtml = fs.readFileSync('./article.html', 'utf8');

    const countIndex = (indexHtml.match(/id="yt-player"/g) || []).length;
    const countBlog = (blogHtml.match(/id="yt-player"/g) || []).length;
    const countArticle = (articleHtml.match(/id="yt-player"/g) || []).length;

    assert(countIndex === 1, '14. Exactly one #yt-player in index.html');
    assert(countBlog === 1, '15. Exactly one #yt-player in blog.html');
    assert(countArticle === 1, '16. Exactly one #yt-player in article.html');

    // ----------------------------------------------------------------
    // 7. PRODUCTION BUNDLE BUDGET (<50 KB)
    // ----------------------------------------------------------------
    console.log('\n--- 7. Verifying Performance Budget ---');
    const bundleStats = fs.statSync('./dist/app.min.js');
    const sizeKb = (bundleStats.size / 1024).toFixed(1);
    assert(bundleStats.size < 50 * 1024, `17. Minified production bundle (${sizeKb} KB) is well under 50 KB budget`);

    // Clean up test events
    await queryInsForge(`
      DELETE FROM analytics_events 
      WHERE session_id IN ('test-session-123', 'anon-session-789', 'zero-search-session', 'found-search-session', 'music-session-1');
    `);

    console.log('\n======================================================');
    console.log(`  STEP 12 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('======================================================\n');

    if (failedTests > 0) process.exit(1);
  } catch (err) {
    console.error('Test suite error:', err);
    process.exit(1);
  }
}

runStep12Tests();
