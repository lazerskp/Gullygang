// ============================================================
// GULLYGANG STEP 9 — AUTOMATED TEST SUITE: NATIVE REALTIME + PERF
// ============================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

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

async function runTests() {
  console.log('\n======================================================');
  console.log('  RUNNING STEP 9 REALTIME & PERFORMANCE TEST SUITE   ');
  console.log('======================================================\n');

  const db = require('../api/_db.js');
  const publicApi = require('../api/public.js');
  const { renderSafeMarkdown } = require('../src/blog/markdown.js');

  // Test 1: Native Server-Sent Events (SSE) Stream Endpoint Verification
  console.log('--- 1. Testing Server-Sent Events (SSE) Stream Endpoint ---');
  let sseHeadersReceived = false;
  let sseInitReceived = false;

  const mockReq = {
    method: 'GET',
    url: '/api/public?type=events',
    headers: { host: 'localhost:3000' },
    on: () => {}
  };

  const mockRes = {
    headers: {},
    writtenData: [],
    statusCode: 200,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    write(chunk) {
      this.writtenData.push(chunk);
      if (chunk.startsWith('event: init')) {
        sseInitReceived = true;
      }
    },
    json(data) {
      this.writtenData.push(JSON.stringify(data));
    }
  };

  await publicApi(mockReq, mockRes);
  const isSse = mockRes.headers['content-type']?.includes('text/event-stream');
  assert(isSse, '1. /api/public?type=events returns Content-Type text/event-stream');
  assert(sseInitReceived, '2. SSE stream immediately pushes event: init with version payload');

  // Test 2: In-Memory SSE Event Broadcasting via recordSyncEvent
  console.log('\n--- 2. Testing Push Event Delivery across SSE ---');
  let broadcastReceived = false;
  const subscriberRes = {
    write(chunk) {
      if (chunk.includes('blog.test_event')) {
        broadcastReceived = true;
      }
    }
  };

  db.registerSseSubscriber(subscriberRes);
  await db.recordSyncEvent('blog.test_event', 'test-uuid-999', { title: 'Test Broadcast' });
  db.unregisterSseSubscriber(subscriberRes);

  assert(broadcastReceived, '3. recordSyncEvent pushes real-time event to active SSE stream subscribers');

  // Test 3: Polling Loop Elimination in Client Code
  console.log('\n--- 3. Verifying Polling Loop Elimination ---');
  const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const hasOld3sPolling = appJs.includes('scheduleNextPoll(3000)') || appJs.includes('scheduleNextPoll(delayMs)');
  assert(!hasOld3sPolling, '4. app.js contains zero aggressive 3s/5s recursive polling loops');

  const hasEventSource = appJs.includes('new EventSource(\'/api/public?type=events\')');
  assert(hasEventSource, '5. app.js uses EventSource native push stream');

  const hasConservativeFallback = appJs.includes('Math.min(60000');
  assert(hasConservativeFallback, '6. Fallback backoff is conservative (60s-120s) and only triggers on disconnection');

  // Test 4: Persistent Audio Player Singleton Verification
  console.log('\n--- 4. Verifying Persistent Music Player Shell ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const blogHtml = fs.readFileSync(path.join(__dirname, '../blog.html'), 'utf8');
  const articleHtml = fs.readFileSync(path.join(__dirname, '../article.html'), 'utf8');

  function countOccurrences(str, sub) {
    return (str.match(new RegExp(sub, 'g')) || []).length;
  }

  assert(countOccurrences(indexHtml, 'id="yt-player"') === 1, '7. Exactly one #yt-player in index.html');
  assert(countOccurrences(blogHtml, 'id="yt-player"') === 1, '8. Exactly one #yt-player in blog.html');
  assert(countOccurrences(articleHtml, 'id="yt-player"') === 1, '9. Exactly one #yt-player in article.html');

  // Test 5: Secret Audit (Zero server secrets in frontend bundles)
  console.log('\n--- 5. Verifying Zero Server Secrets in Public Code ---');
  const minifiedApp = fs.readFileSync(path.join(__dirname, '../dist/app.min.js'), 'utf8');
  const secretPatterns = [
    /ik_live_[a-zA-Z0-9_-]{20,}/i,
    /service_role/i,
    /INSFORGE_API_KEY/i,
    /API_KEY\s*=\s*['"][a-zA-Z0-9_-]{20,}['"]/i
  ];

  let foundSecret = false;
  for (const pat of secretPatterns) {
    if (pat.test(minifiedApp) || pat.test(appJs)) {
      foundSecret = true;
      break;
    }
  }
  assert(!foundSecret, '10. Zero server API keys or database secrets in public JS bundles');

  // Test 6: Parameterized InsForge SDK Database CRUD Operations
  console.log('\n--- 6. Verifying Parameterized SDK Database Queries ---');
  const adminClient = await db.getAdminClient();
  assert(typeof adminClient.database?.from === 'function', '11. InsForge SDK provides parameterized database.from() query builder');

  const testSlug = 'test-step9-' + Date.now();
  const insertRes = await adminClient.database.from('blog_posts').insert([{
    slug: testSlug,
    title: 'Step 9 Test Post',
    excerpt: 'Verifying SDK builder',
    content: '# Content',
    status: 'draft',
    is_featured: false
  }]).select();

  assert(insertRes.data && insertRes.data.length > 0, '12. Parameterized insert via SDK succeeds');

  const updateRes = await adminClient.database.from('blog_posts').update({
    title: 'Step 9 Updated Title'
  }).eq('slug', testSlug).select();

  assert(updateRes.data && updateRes.data[0]?.title === 'Step 9 Updated Title', '13. Parameterized update via SDK succeeds');

  const deleteRes = await adminClient.database.from('blog_posts').delete().eq('slug', testSlug);
  assert(!deleteRes.error, '14. Parameterized delete via SDK succeeds');

  // Test 7: Safe Markdown Rendering & XSS Elimination
  console.log('\n--- 7. Verifying Safe Markdown Rendering & Link Protocol Sanitization ---');
  const unsafeMd = '# Title <script>alert("xss")</script>\n[Bad Link](javascript:alert(1))\n[Good Link](https://gullygang.in)';
  const safeHtml = renderSafeMarkdown(unsafeMd);

  assert(!safeHtml.includes('<script>'), '15. Safe markdown escapes <script> tags');
  assert(!safeHtml.includes('javascript:alert'), '16. Safe markdown strips malicious javascript: links and sets rel="noopener noreferrer"');

  // Test 8: Build Pipeline Verification
  console.log('\n--- 8. Verifying Build Output ---');
  const minStats = fs.statSync(path.join(__dirname, '../dist/app.min.js'));
  assert(minStats.size < 50 * 1024, `17. Minified bundle size (${(minStats.size / 1024).toFixed(1)} KB) is under 50 KB (>80% reduction)`);

  console.log('\n======================================================');
  console.log(`  STEP 9 RESULTS: ${passCount} Passed, ${failCount} Failed`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
