// ============================================================
// GULLYGANG STEP 11 — SEARCH, DISCOVERY & GROWTH TEST SUITE
// ============================================================

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
  console.log('  RUNNING STEP 11 SEARCH & DISCOVERY AUTOMATED TESTS  ');
  console.log('======================================================\n');

  const db = require('../api/_db.js');
  const publicApi = require('../api/public.js');
  const { normalizeTagSlug } = require('../src/core/state.js');

  // Test 1: Tag Normalization Utility
  console.log('--- 1. Testing Tag Slug Normalization ---');
  assert(normalizeTagSlug('Indian Hip Hop') === 'indian-hip-hop', '1. Normalizes spaces to hyphens');
  assert(normalizeTagSlug('  UNDERGROUND RAP  ') === 'underground-rap', '2. Trims whitespace and lowercases');
  assert(normalizeTagSlug('Desi_Hip---Hop!') === 'desi-hip-hop', '3. Strips invalid characters & collapses hyphens');

  // Test 2: Search Query API Validation & Sanitization
  console.log('\n--- 2. Testing Public Search API (/api/public?type=search) ---');
  
  // Create temporary mock test articles (published, draft, and future scheduled)
  const testIdPub = '00000000-0000-4000-a000-000000000111';
  const testIdDraft = '00000000-0000-4000-a000-000000000112';
  const testIdSched = '00000000-0000-4000-a000-000000000113';

  try {
    await db.queryInsForge(`
      INSERT INTO blog_posts (id, slug, title, excerpt, content, author, tags, status, published_at)
      VALUES 
        ('${testIdPub}', 'test-search-published-unique-xyz', 'Unique Seedhe Maut Article', 'Exclusive story about Seedhe Maut in Delhi', 'Deep dive into Delhi underground hip hop', 'GULLYGANG Editorial', ARRAY['seedhe-maut', 'delhi-rap'], 'published', NOW()),
        ('${testIdDraft}', 'test-search-draft-secret-xyz', 'Secret Draft Seedhe Maut Interview', 'Unpublished draft excerpt', 'Confidential interview content', 'Admin', ARRAY['seedhe-maut'], 'draft', NOW()),
        ('${testIdSched}', 'test-search-scheduled-future-xyz', 'Future Seedhe Maut Album Review', 'Upcoming album review', 'Scheduled future content', 'Writer', ARRAY['seedhe-maut'], 'scheduled', NOW() + INTERVAL '10 days')
      ON CONFLICT (id) DO NOTHING;
    `);
  } catch (err) {
    console.warn('Notice setting up test posts:', err.message);
  }

  // 2a: Short query rejection (< 2 chars)
  const shortReq = { method: 'GET', url: '/api/public?type=search&q=a', headers: { host: 'localhost:3000' } };
  const shortRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(shortReq, shortRes);
  const shortData = shortRes.written[0];
  assert(shortData?.results?.length === 0, '4. Short queries (< 2 chars) return empty results safely');

  // 2b: Search matching published article
  const validReq = { method: 'GET', url: '/api/public?type=search&q=Seedhe+Maut', headers: { host: 'localhost:3000' } };
  const validRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(validReq, validRes);
  const validData = validRes.written[0];
  const results = validData?.results || [];
  
  assert(results.some(r => r.slug === 'test-search-published-unique-xyz'), '5. Published matching article is found in search results');
  assert(!results.some(r => r.slug === 'test-search-draft-secret-xyz'), '6. Draft article is NEVER leaked in search results');
  assert(!results.some(r => r.slug === 'test-search-scheduled-future-xyz'), '7. Future scheduled article is NEVER leaked in search results');
  assert(validData?.pagination?.total >= 1, '8. Search returns accurate pagination metadata');

  // Test 3: Tag Archive Endpoint (/api/public?type=blog&tag=...)
  console.log('\n--- 3. Testing Tag Archive Query ---');
  const tagReq = { method: 'GET', url: '/api/public?type=blog&tag=delhi-rap', headers: { host: 'localhost:3000' } };
  const tagRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(tagReq, tagRes);
  const tagPosts = tagRes.written[0] || [];
  assert(tagPosts.some(p => p.slug === 'test-search-published-unique-xyz'), '9. Tag archive query returns matching published post');

  // Nonexistent tag test
  const emptyTagReq = { method: 'GET', url: '/api/public?type=blog&tag=nonexistent-random-tag-12345', headers: { host: 'localhost:3000' } };
  const emptyTagRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(emptyTagReq, emptyTagRes);
  const emptyTagPosts = emptyTagRes.written[0] || [];
  assert(Array.isArray(emptyTagPosts) && emptyTagPosts.length === 0, '10. Nonexistent tag returns clean empty array');

  // Test 4: Progressive Pagination on /api/public?type=blog&page=1&limit=2
  console.log('\n--- 4. Testing Progressive Pagination ---');
  const pageReq = { method: 'GET', url: '/api/public?type=blog&page=1&limit=2&format=paginated', headers: { host: 'localhost:3000' } };
  const pageRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(pageReq, pageRes);
  const pageData = pageRes.written[0];
  assert(pageData?.stories?.length <= 2, '11. Limit parameter restricts returned count');
  assert(typeof pageData?.pagination?.total === 'number', '12. Pagination metadata contains total post count');

  // Test 5: Dynamic Sitemap Tag Inclusions
  console.log('\n--- 5. Testing Dynamic Sitemap Tag Inclusions ---');
  const sitemapReq = { method: 'GET', url: '/api/public?type=sitemap', headers: { host: 'localhost:3000' } };
  const sitemapRes = {
    headers: {}, body: '', statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    send(xml) { this.body = xml; }, end() {}
  };
  await publicApi(sitemapReq, sitemapRes);
  assert(sitemapRes.body.includes('https://gullygang.in/blog/tag/delhi-rap'), '13. Sitemap dynamically indexes active tag archives');
  assert(!sitemapRes.body.includes('?q='), '14. Sitemap strictly excludes search query URLs');

  // Test 6: Enhanced Related Articles Scoring
  console.log('\n--- 6. Testing Enhanced Related Stories Ranking ---');
  const relatedReq = { method: 'GET', url: '/api/public?type=related_articles&slug=test-search-published-unique-xyz', headers: { host: 'localhost:3000' } };
  const relatedRes = {
    headers: {}, written: [], statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.written.push(d); }, end() {}
  };
  await publicApi(relatedReq, relatedRes);
  const relatedPosts = relatedRes.written[0] || [];
  assert(!relatedPosts.some(r => r.slug === 'test-search-published-unique-xyz'), '15. Current article is strictly excluded from related stories');

  // Test 7: Clean Up Temporary Test Posts
  try {
    await db.queryInsForge(`
      DELETE FROM blog_posts WHERE id IN ('${testIdPub}', '${testIdDraft}', '${testIdSched}');
    `);
  } catch (_) {}

  // Test 8: Singleton Audio Player Invariant
  console.log('\n--- 7. Testing Audio Singleton Invariant ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const blogHtml = fs.readFileSync(path.join(__dirname, '../blog.html'), 'utf8');
  const articleHtml = fs.readFileSync(path.join(__dirname, '../article.html'), 'utf8');

  function countOccurrences(str, sub) {
    return (str.match(new RegExp(sub, 'g')) || []).length;
  }

  assert(countOccurrences(indexHtml, 'id="yt-player"') === 1, '16. Exactly one #yt-player in index.html');
  assert(countOccurrences(blogHtml, 'id="yt-player"') === 1, '17. Exactly one #yt-player in blog.html');
  assert(countOccurrences(articleHtml, 'id="yt-player"') === 1, '18. Exactly one #yt-player in article.html');

  const minStats = fs.statSync(path.join(__dirname, '../dist/app.min.js'));
  assert(minStats.size < 50 * 1024, `19. Minified production bundle (${(minStats.size / 1024).toFixed(1)} KB) is under 50 KB`);

  console.log('\n======================================================');
  console.log(`  STEP 11 RESULTS: ${passCount} Passed, ${failCount} Failed`);
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
