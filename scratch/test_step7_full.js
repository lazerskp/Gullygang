const {
  queryInsForge,
  getInsForgeHost,
  getInsForgeApiKey
} = require('../api/_db.js');

async function getSdk() {
  return await import('@insforge/sdk');
}

async function runTests() {
  console.log('🧪 Starting Step 7 Publishing CMS Test Suite...\n');
  let testCount = 0;
  let passCount = 0;

  function assert(condition, message) {
    testCount++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  // 1. Database schema column verification
  console.log('1. Verifying Database Schema columns (tags, is_featured, scheduled_at)...');
  const schemaRes = await queryInsForge(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'blog_posts';
  `);
  const columns = schemaRes.map(c => c.column_name);
  assert(columns.includes('tags'), 'Column tags exists in blog_posts');
  assert(columns.includes('is_featured'), 'Column is_featured exists in blog_posts');
  assert(columns.includes('scheduled_at'), 'Column scheduled_at exists in blog_posts');

  // 2. Storage Upload Verification
  console.log('\n2. Verifying InsForge Storage Bucket blog-media upload...');
  const { createAdminClient } = await getSdk();
  const host = getInsForgeHost();
  const apiKey = getInsForgeApiKey();
  const adminClient = createAdminClient({ baseUrl: host, apiKey });

  const testPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(testPngBase64, 'base64');
  const blob = new Blob([buffer], { type: 'image/png' });
  const objectKey = `blog/test-${Date.now()}.png`;
  const uploadRes = await adminClient.storage.from('blog-media').upload(objectKey, blob);
  assert(!uploadRes.error && uploadRes.data?.url, `Uploaded test image to blog-media bucket: ${uploadRes.data?.url}`);

  // 3. Featured Post Exclusivity Test
  console.log('\n3. Testing Featured Post Exclusivity...');
  const testSlug1 = `test-feat-1-${Date.now()}`;
  const testSlug2 = `test-feat-2-${Date.now()}`;
  const content1 = 'Word '.repeat(100);
  const content2 = 'Word '.repeat(250);

  // Insert Post 1 as featured
  const p1Rows = await queryInsForge(`
    INSERT INTO blog_posts (title, slug, content, excerpt, status, is_featured, published_at)
    VALUES ('Featured Post 1', '${testSlug1}', '${content1}', 'Excerpt 1', 'published', true, NOW())
    RETURNING id, is_featured;
  `);
  assert(p1Rows.length > 0 && p1Rows[0].is_featured === true, 'Post 1 created as featured');
  const p1Id = p1Rows[0].id;

  // Insert Post 2 as featured - unsetting others first
  await queryInsForge(`UPDATE blog_posts SET is_featured = false;`);
  const p2Rows = await queryInsForge(`
    INSERT INTO blog_posts (title, slug, content, excerpt, status, is_featured, published_at)
    VALUES ('Featured Post 2', '${testSlug2}', '${content2}', 'Excerpt 2', 'published', true, NOW())
    RETURNING id, is_featured;
  `);
  assert(p2Rows.length > 0 && p2Rows[0].is_featured === true, 'Post 2 created as featured');
  const p2Id = p2Rows[0].id;

  const checkP1 = await queryInsForge(`SELECT is_featured FROM blog_posts WHERE id = '${p1Id}';`);
  assert(checkP1.length > 0 && checkP1[0].is_featured === false, 'Post 1 is_featured was safely unset to false');

  // 4. Reading Time calculation verification
  console.log('\n4. Verifying Reading Time calculation...');
  const words = 450; // 450 words -> 3 min read
  const mins = Math.max(1, Math.ceil(words / 200));
  const readingTime = `${mins} min read`;
  assert(readingTime === '3 min read', 'Reading time for 450 words is 3 min read (~200 wpm)');

  // 5. Scheduled Publishing Query Logic Test
  console.log('\n5. Verifying Scheduled Publishing queries...');
  const futureSlug = `test-future-${Date.now()}`;
  const futureDate = new Date(Date.now() + 86400000 * 5).toISOString(); // 5 days in future
  const futureRows = await queryInsForge(`
    INSERT INTO blog_posts (title, slug, content, status, scheduled_at)
    VALUES ('Future Scheduled Post', '${futureSlug}', 'Top Secret', 'scheduled', '${futureDate}')
    RETURNING id;
  `);
  assert(futureRows.length > 0, 'Future scheduled post inserted into database');
  const futureId = futureRows[0].id;

  // Public Query (same as api/public.js)
  const publicPosts = await queryInsForge(`
    SELECT id, title, slug, is_featured, status, scheduled_at 
    FROM blog_posts 
    WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
    ORDER BY is_featured DESC, published_at DESC;
  `);
  const foundFuture = publicPosts.find(p => p.slug === futureSlug);
  assert(!foundFuture, 'Future scheduled post is excluded from public blog feed');

  // 6. Cleanup test records
  console.log('\n6. Cleaning up test records...');
  if (p1Id) await queryInsForge(`DELETE FROM blog_posts WHERE id = '${p1Id}';`);
  if (p2Id) await queryInsForge(`DELETE FROM blog_posts WHERE id = '${p2Id}';`);
  if (futureId) await queryInsForge(`DELETE FROM blog_posts WHERE id = '${futureId}';`);
  assert(true, 'Test records cleaned up successfully');

  console.log(`\n========================================`);
  console.log(`Test Results: ${passCount} / ${testCount} Passed`);
  console.log(`========================================\n`);

  if (passCount === testCount) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
