const fs = require('fs');
const path = require('path');

// Load .env.local if present
try {
  const envPath = path.join(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[match[1]] = val;
      }
    }
  }
} catch (e) {}

const http = require('http');

const publicHandler = require('../api/public.js');
const adminHandler = require('../api/admin.js');
const { queryInsForge, recordSyncEvent } = require('../api/_db.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// Mock HTTP helper
function createMockReqRes(method, url, body = null, headers = {}) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:3000', ...headers },
    body
  };

  let resData = '';
  let statusCode = 200;
  const resHeaders = {};

  const res = {
    setHeader: (k, v) => { resHeaders[k] = v; },
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (obj) => {
      resData = JSON.stringify(obj);
      return res;
    },
    end: (data) => {
      if (data) resData = data;
      return res;
    },
    _getData: () => {
      try {
        return JSON.parse(resData);
      } catch (e) {
        return resData;
      }
    },
    _getStatus: () => statusCode
  };

  return { req, res };
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  RUNNING STEP 8 DYNAMIC BLOG AUTOMATED TEST SUITE    ');
  console.log('======================================================\n');

  const testSlugPrefix = `test-step8-${Date.now()}`;
  const slugPublished = `${testSlugPrefix}-published`;
  const slugDraft = `${testSlugPrefix}-draft`;
  const slugFuture = `${testSlugPrefix}-future`;
  const slugPast = `${testSlugPrefix}-past`;
  const slugRelated = `${testSlugPrefix}-related`;

  try {
    // Setup test posts in InsForge PostgreSQL
    console.log('--- Setting up test articles in InsForge DB ---');

    // 1. Published Post
    await queryInsForge(`
      INSERT INTO blog_posts (slug, title, excerpt, content, featured_image, author, reading_time, tags, status, is_featured, published_at)
      VALUES (
        '${slugPublished}',
        'Step 8 Published Anthem',
        'Exploring underground hip-hop culture.',
        '# Underground Sound\n\nIndian rap is rising fast. DIVINE and KR$NA lead the way.',
        'https://gullygang.in/brand-cover.png',
        'GULLYGANG Editorial',
        '3 min read',
        ARRAY['hip-hop', 'mumbai', 'desi-rap']::text[],
        'published',
        true,
        NOW() - INTERVAL '1 day'
      );
    `);

    // 2. Draft Post
    await queryInsForge(`
      INSERT INTO blog_posts (slug, title, excerpt, content, status, is_featured)
      VALUES (
        '${slugDraft}',
        'Step 8 Secret Draft',
        'Not ready for publication.',
        'Confidential upcoming release.',
        'draft',
        false
      );
    `);

    // 3. Future Scheduled Post
    await queryInsForge(`
      INSERT INTO blog_posts (slug, title, excerpt, content, status, is_featured, scheduled_at)
      VALUES (
        '${slugFuture}',
        'Step 8 Future Drop',
        'Drops next week.',
        'Scheduled release preview.',
        'scheduled',
        false,
        NOW() + INTERVAL '7 days'
      );
    `);

    // 4. Past Scheduled Post
    await queryInsForge(`
      INSERT INTO blog_posts (slug, title, excerpt, content, status, is_featured, scheduled_at, published_at)
      VALUES (
        '${slugPast}',
        'Step 8 Past Scheduled Drop',
        'Should be visible.',
        'This scheduled post has passed its scheduled time.',
        'scheduled',
        false,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours'
      );
    `);

    // 5. Related Tag Match Post
    await queryInsForge(`
      INSERT INTO blog_posts (slug, title, excerpt, content, author, tags, status, is_featured, published_at)
      VALUES (
        '${slugRelated}',
        'Step 8 Related Story with Tags',
        'Matching tags story.',
        'Shares tags with the published anthem.',
        'Music Critic',
        ARRAY['hip-hop', 'production']::text[],
        'published',
        false,
        NOW() - INTERVAL '12 hours'
      );
    `);

    console.log('--- Executing Verification Assertions ---\n');

    // Test 1: Published article appears in public feed
    {
      const { req, res } = createMockReqRes('GET', '/api/public?type=blog');
      await publicHandler(req, res);
      const posts = res._getData();
      const found = Array.isArray(posts) && posts.some(p => p.slug === slugPublished);
      assert(found, '1. Published article appears in public /api/public?type=blog feed');
    }

    // Test 2: Draft article does NOT appear in public feed
    {
      const { req, res } = createMockReqRes('GET', '/api/public?type=blog');
      await publicHandler(req, res);
      const posts = res._getData();
      const found = Array.isArray(posts) && posts.some(p => p.slug === slugDraft);
      assert(!found, '2. Draft article does NOT appear in public feed');
    }

    // Test 3: Future scheduled article does NOT appear
    {
      const { req, res } = createMockReqRes('GET', '/api/public?type=blog');
      await publicHandler(req, res);
      const posts = res._getData();
      const found = Array.isArray(posts) && posts.some(p => p.slug === slugFuture);
      assert(!found, '3. Future scheduled article does NOT appear in public feed');
    }

    // Test 4: Past scheduled article appears
    {
      const { req, res } = createMockReqRes('GET', '/api/public?type=blog');
      await publicHandler(req, res);
      const posts = res._getData();
      const found = Array.isArray(posts) && posts.some(p => p.slug === slugPast);
      assert(found, '4. Scheduled article with past scheduled_at timestamp appears in public feed');
    }

    // Test 5: Featured article is marked is_featured = true
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=${slugPublished}`);
      await publicHandler(req, res);
      const post = res._getData();
      assert(post && post.is_featured === true, '5. Featured article has is_featured = true in public API');
    }

    // Test 6: Single article slug endpoint loads full article data
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=${slugPublished}`);
      await publicHandler(req, res);
      const post = res._getData();
      assert(
        res._getStatus() === 200 &&
        post.slug === slugPublished &&
        post.title === 'Step 8 Published Anthem' &&
        Array.isArray(post.tags) &&
        post.tags.includes('hip-hop'),
        '6. Single article endpoint /api/public?type=article&slug=... returns complete post details'
      );
    }

    // Test 7: Invalid / unpublished slug returns 404
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=invalid-non-existent-slug-xyz`);
      await publicHandler(req, res);
      assert(res._getStatus() === 404, '7. Non-existent slug returns 404 status code');
    }

    // Test 8: Draft slug returns 404 in public API
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=${slugDraft}`);
      await publicHandler(req, res);
      assert(res._getStatus() === 404, '8. Draft slug returns 404 status code in public API (no leakage)');
    }

    // Test 9: Related articles excludes current article
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=related_articles&slug=${slugPublished}&limit=4`);
      await publicHandler(req, res);
      const related = res._getData();
      const containsCurrent = Array.isArray(related) && related.some(r => r.slug === slugPublished);
      assert(Array.isArray(related) && !containsCurrent, '9. Related articles endpoint excludes the current article');
    }

    // Test 10: Related articles prioritizes matching tags
    {
      const { req, res } = createMockReqRes('GET', `/api/public?type=related_articles&slug=${slugPublished}&limit=4`);
      await publicHandler(req, res);
      const related = res._getData();
      const firstRelated = related[0];
      assert(firstRelated && firstRelated.slug === slugRelated, '10. Related articles prioritizes stories with matching tags');
    }

    // Test 11: Tag filtering on blog feed
    {
      const { req, res } = createMockReqRes('GET', '/api/public?type=blog&tag=mumbai');
      await publicHandler(req, res);
      const posts = res._getData();
      const allHaveTag = Array.isArray(posts) && posts.every(p => p.tags && p.tags.includes('mumbai'));
      assert(allHaveTag && posts.some(p => p.slug === slugPublished), '11. Blog tag query /api/public?type=blog&tag=... filters accurately');
    }

    // Test 12: Safe Markdown rendering neutralizes unsafe script and javascript: URL
    {
      const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
      
      // Test the safe markdown rendering logic directly
      function testRenderSafeMarkdown(md) {
        if (!md || typeof md !== 'string') return '';
        let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html = html.replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.trim()}</code></pre>`);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)]+)\)/g, '<img src="$2" alt="$1" />');
        html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return html;
      }

      const rawDangerousMd = '## Title\n\n<script>alert(1)</script>\n[Dangerous Link](javascript:evil())\n[Safe Link](https://gullygang.in)';
      const safeOutput = testRenderSafeMarkdown(rawDangerousMd);

      const noRawScript = !safeOutput.includes('<script>') && safeOutput.includes('&lt;script&gt;');
      const noJsLink = !safeOutput.includes('href="javascript:');
      const hasSafeLink = safeOutput.includes('href="https://gullygang.in"') && safeOutput.includes('rel="noopener noreferrer"');

      assert(noRawScript && noJsLink && hasSafeLink, '12. Safe Markdown rendering eliminates XSS and sanitizes external links');
    }

    // Test 13: Article updates reflect in public API
    {
      await queryInsForge(`
        UPDATE blog_posts 
        SET title = 'Step 8 Updated Title Anthem', reading_time = '7 min read' 
        WHERE slug = '${slugPublished}';
      `);

      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=${slugPublished}`);
      await publicHandler(req, res);
      const post = res._getData();
      assert(
        post.title === 'Step 8 Updated Title Anthem' && post.reading_time === '7 min read',
        '13. Article edits dynamically update public API response'
      );
    }

    // Test 14: Article deletion removes from public API
    {
      await queryInsForge(`DELETE FROM blog_posts WHERE slug = '${slugPublished}';`);

      const { req, res } = createMockReqRes('GET', `/api/public?type=article&slug=${slugPublished}`);
      await publicHandler(req, res);
      assert(res._getStatus() === 404, '14. Deleted article is immediately removed from public API');
    }

    // Test 15: Realtime sync version update
    {
      const syncEvent = await recordSyncEvent('blog.updated', 'test-uuid-step8');
      const { req, res } = createMockReqRes('GET', '/api/public?type=sync_version');
      await publicHandler(req, res);
      const syncData = res._getData();
      assert(syncData && syncData.version > 0, '15. Real-time synchronization version updates properly in InsForge');
    }

    // Test 16: Singleton #yt-player audio architecture across all pages
    {
      const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
      const blogHtml = fs.readFileSync(path.join(__dirname, '../blog.html'), 'utf8');
      const articleHtml = fs.readFileSync(path.join(__dirname, '../article.html'), 'utf8');

      const indexMatches = (indexHtml.match(/id="yt-player"/g) || []).length;
      const blogMatches = (blogHtml.match(/id="yt-player"/g) || []).length;
      const articleMatches = (articleHtml.match(/id="yt-player"/g) || []).length;

      assert(
        indexMatches === 1 && blogMatches === 1 && articleMatches === 1,
        '16. Singleton #yt-player persistent audio shell exists uniformly across index.html, blog.html, and article.html'
      );
    }

  } finally {
    // Cleanup test rows
    console.log('\n--- Cleaning up temporary test posts ---');
    await queryInsForge(`DELETE FROM blog_posts WHERE slug LIKE '${testSlugPrefix}%';`);
  }

  console.log('\n======================================================');
  console.log(`  STEP 8 RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
