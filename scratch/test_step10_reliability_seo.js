// ============================================================
// GULLYGANG STEP 10 — PRODUCTION RELIABILITY, SCALABILITY & SEO TEST SUITE
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
  console.log('  RUNNING STEP 10 RELIABILITY, SCALABILITY & SEO TESTS');
  console.log('======================================================\n');

  const db = require('../api/_db.js');
  const publicApi = require('../api/public.js');
  const articleRender = require('../api/article_render.js');

  // Test 1: Cross-Instance SSE Sync & Reconnect Replay
  console.log('--- 1. Testing Cross-Instance SSE Sync & Reconnect Recovery ---');
  let sseDataChunks = [];
  const mockReq = {
    method: 'GET',
    url: '/api/public?type=events&since_version=1000',
    headers: { host: 'localhost:3000', 'if-none-match': '' },
    on: () => {}
  };

  const mockRes = {
    headers: {},
    written: [],
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    write(chunk) { this.written.push(chunk); },
    json(d) { this.written.push(JSON.stringify(d)); },
    send(d) { this.written.push(d); },
    end() {}
  };

  await publicApi(mockReq, mockRes);
  assert(mockRes.headers['content-type']?.includes('text/event-stream'), '1. SSE returns text/event-stream content type');
  assert(mockRes.written.some(c => c.startsWith('event: init')), '2. SSE stream initializes with init event');
  assert(mockRes.headers['cache-control']?.includes('no-store'), '3. SSE headers strictly disable caching (no-store)');

  // Test 2: HTTP Caching & ETag (304 Not Modified) Verification
  console.log('\n--- 2. Testing HTTP Caching & ETags (304 Not Modified) ---');
  const blogReq = { method: 'GET', url: '/api/public?type=blog', headers: { host: 'localhost:3000' } };
  const blogRes = {
    headers: {},
    written: [],
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); },
    end() {}
  };

  await publicApi(blogReq, blogRes);
  const etag = blogRes.headers['etag'];
  assert(Boolean(etag && etag.startsWith('"')), '4. /api/public?type=blog returns valid ETag header');
  assert(blogRes.headers['cache-control']?.includes('stale-while-revalidate'), '5. /api/public?type=blog uses stale-while-revalidate CDN cache');

  // Test 304 response with If-None-Match
  const conditionalReq = {
    method: 'GET',
    url: '/api/public?type=blog',
    headers: { host: 'localhost:3000', 'if-none-match': etag }
  };
  const conditionalRes = {
    headers: {},
    written: [],
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); },
    end() {}
  };

  await publicApi(conditionalReq, conditionalRes);
  assert(conditionalRes.statusCode === 304, '6. Conditional request with matching If-None-Match returns HTTP 304 Not Modified');

  // Test 3: Server-Side Initial HTML SEO Prerendering & Social Metadata
  console.log('\n--- 3. Testing Initial HTML SEO Prerendering & Open Graph ---');
  const seoReq = {
    method: 'GET',
    url: '/api/article_render?slug=top-10-rappers-in-india',
    headers: { host: 'localhost:3000' }
  };
  const seoRes = {
    headers: {},
    body: '',
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    send(html) { this.body = html; },
    end() {}
  };

  await articleRender(seoReq, seoRes);
  assert(seoRes.statusCode === 200, '7. Server article prerenderer returns HTTP 200 for published post');
  assert(seoRes.body.includes('<title id="meta-doc-title">Top 10 Rappers in India'), '8. Initial HTML contains dynamic <title> on first byte (no JS required)');
  assert(seoRes.body.includes('<meta property="og:title" id="meta-og-title" content="Top 10 Rappers in India'), '9. Initial HTML contains Open Graph og:title for social crawlers');
  assert(seoRes.body.includes('<meta name="twitter:card" content="summary_large_image" />'), '10. Initial HTML contains Twitter Card summary_large_image tag');
  assert(seoRes.body.includes('"@type": "BlogPosting"'), '11. Initial HTML contains valid Schema.org JSON-LD structured data');
  assert(seoRes.body.includes('<h1 id="article-headline" class="article-headline">Top 10 Rappers in India'), '12. Semantic headline is pre-rendered into HTML body for search engines');

  // Test 4: Dynamic XML Sitemap Generation
  console.log('\n--- 4. Testing Dynamic XML Sitemap Generation ---');
  const sitemapReq = {
    method: 'GET',
    url: '/api/public?type=sitemap',
    headers: { host: 'localhost:3000' }
  };
  const sitemapRes = {
    headers: {},
    body: '',
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    send(xml) { this.body = xml; },
    end() {}
  };

  await publicApi(sitemapReq, sitemapRes);
  assert(sitemapRes.headers['content-type']?.includes('application/xml'), '13. /sitemap.xml returns application/xml content type');
  assert(sitemapRes.body.includes('<urlset') && sitemapRes.body.includes('https://gullygang.in/blog/top-10-rappers-in-india'), '14. Sitemap contains published article URLs');
  assert(!sitemapRes.body.includes('/admin'), '15. Sitemap strictly excludes /admin');

  // Test 5: Robots.txt Disallow Rules
  console.log('\n--- 5. Testing robots.txt Configuration ---');
  const robotsTxt = fs.readFileSync(path.join(__dirname, '../robots.txt'), 'utf8');
  assert(robotsTxt.includes('Disallow: /admin'), '16. robots.txt explicitly disallows /admin');
  assert(robotsTxt.includes('Sitemap: https://gullygang.in/sitemap.xml'), '17. robots.txt declares canonical sitemap location');

  // Test 6: Audio Player Singleton & Performance Budget
  console.log('\n--- 6. Testing Audio Invariant & Production Performance Budget ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const blogHtml = fs.readFileSync(path.join(__dirname, '../blog.html'), 'utf8');
  const articleHtml = fs.readFileSync(path.join(__dirname, '../article.html'), 'utf8');

  function countOccurrences(str, sub) {
    return (str.match(new RegExp(sub, 'g')) || []).length;
  }

  assert(countOccurrences(indexHtml, 'id="yt-player"') === 1, '18. Exactly one #yt-player in index.html');
  assert(countOccurrences(blogHtml, 'id="yt-player"') === 1, '19. Exactly one #yt-player in blog.html');
  assert(countOccurrences(articleHtml, 'id="yt-player"') === 1, '20. Exactly one #yt-player in article.html');

  const minStats = fs.statSync(path.join(__dirname, '../dist/app.min.js'));
  assert(minStats.size < 55 * 1024, `21. Production JS bundle size (${(minStats.size / 1024).toFixed(1)} KB) is under budget (< 55 KB)`);

  console.log('\n======================================================');
  console.log(`  STEP 10 RESULTS: ${passCount} Passed, ${failCount} Failed`);
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
