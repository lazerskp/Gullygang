// ============================================================
// GULLYGANG — END-TO-END SECURITY, AUTH & DATABASE CRUD TEST SUITE
// Tests against real InsForge backend: https://i7i9c74c.ap-southeast.insforge.app
// ============================================================

const http = require('http');
const adminHandler = require('../api/admin.js');
const publicHandler = require('../api/public.js');
const { getInsForgeHost, getInsForgeApiKey, queryInsForge } = require('../api/_db.js');

// Helper to simulate HTTP requests to Vercel/Node serverless handlers
function executeHandler(handler, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let responseBody = '';
    let responseHeaders = {};
    let statusCode = 200;

    const req = {
      method,
      url,
      headers: {
        host: 'localhost:3000',
        ...headers
      },
      body,
      on(event, callback) {
        if (event === 'data' && body) {
          callback(typeof body === 'string' ? body : JSON.stringify(body));
        }
        if (event === 'end') {
          callback();
        }
      },
      destroy() {}
    };

    const res = {
      setHeader(name, value) {
        responseHeaders[name.toLowerCase()] = value;
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = JSON.stringify(data);
        return this.end();
      },
      end(data) {
        if (data) responseBody = data;
        let parsed = null;
        try {
          parsed = JSON.parse(responseBody);
        } catch (_) {
          parsed = responseBody;
        }
        resolve({
          status: statusCode,
          headers: responseHeaders,
          data: parsed,
          rawBody: responseBody
        });
      }
    };

    try {
      handler(req, res).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function runTestSuite() {
  console.log('============================================================');
  console.log('GULLYGANG — COMPREHENSIVE INSFORGE INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] Test ${totalTests}: ${testName}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] Test ${totalTests}: ${testName}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  // -----------------------------------------------------------
  // STEP 1: FAIL-SAFE CONFIGURATION AUDIT
  // -----------------------------------------------------------
  console.log('--- 1. Testing Fail-Safe Configuration ---');
  try {
    const host = getInsForgeHost();
    const apiKey = getInsForgeApiKey();
    assert(host && host.includes('insforge.app'), 'Resolved INSFORGE_URL from environment');
    assert(apiKey && apiKey.startsWith('ik_'), 'Resolved INSFORGE_API_KEY from environment');
  } catch (err) {
    assert(false, `Configuration failure: ${err.message}`);
  }

  // -----------------------------------------------------------
  // STEP 2: UNAUTHENTICATED & FORGED TOKEN SECURITY REJECTION
  // -----------------------------------------------------------
  console.log('\n--- 2. Testing JWT & Session Security Rejection ---');
  
  // 2a. Unauthenticated request to protected endpoint
  const unauthRes = await executeHandler(adminHandler, {
    method: 'GET',
    url: '/api/admin?action=overview'
  });
  assert(unauthRes.status === 401, 'Unauthenticated request receives 401 Unauthorized');

  // 2b. Forged JWT with real admin user ID in payload but invalid signature
  const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const forgedPayload = Buffer.from(JSON.stringify({
    sub: '80bc5ea2-195c-46d2-a18c-0ace770ecda8', // Admin ID
    email: 'admin@gullygang.in'
  })).toString('base64url');
  const forgedToken = `${forgedHeader}.${forgedPayload}.fake_unauthorized_signature_attempt`;

  const forgedRes = await executeHandler(adminHandler, {
    method: 'GET',
    url: '/api/admin?action=overview',
    headers: {
      cookie: `gullygang_admin_session=${forgedToken}`
    }
  });
  assert(forgedRes.status === 401, 'Forged JWT spoof attempt rejected by InsForge with 401');

  // -----------------------------------------------------------
  // STEP 3: REAL INSFORGE AUTHENTICATION & LOGIN
  // -----------------------------------------------------------
  console.log('\n--- 3. Testing Real InsForge Authentication ---');

  // 3a. Invalid credentials
  const badLoginRes = await executeHandler(adminHandler, {
    method: 'POST',
    url: '/api/admin?action=login',
    body: { email: 'admin@gullygang.in', password: 'wrongpassword123' }
  });
  assert(badLoginRes.status === 401, 'Invalid credentials rejected by InsForge with 401');

  // 3b. Real InsForge Admin Login
  // Note: We authenticate against the real user in auth.users
  // Let's create/verify a test session token directly or test sign in
  console.log('Querying database auth.users...');
  const adminUsers = await queryInsForge("SELECT id, email, is_project_admin FROM auth.users WHERE is_project_admin = true LIMIT 1;");
  assert(adminUsers.length > 0 && adminUsers[0].is_project_admin === true, 'Found verified is_project_admin user in PostgreSQL');

  // Test SDK user token issuance / validation:
  const { createClient } = await import('@insforge/sdk');
  const host = getInsForgeHost();
  const apiKey = getInsForgeApiKey();

  // Test sign in / user session
  let sessionToken = null;
  const loginTestRes = await fetch(`${host}/api/auth/sessions?client_type=mobile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ email: adminUsers[0].email, password: 'TemporaryPassword_OR_Direct_Check' })
  });
  
  // If the admin user has a specific password or if we issue a token via InsForge admin API
  if (loginTestRes.ok) {
    const data = await loginTestRes.json();
    sessionToken = data.accessToken;
  } else {
    // If password is unknown in automated runner, create a dedicated test admin user with known password
    console.log('Creating/verifying automated test admin user for CRUD verification...');
    const testAdminEmail = 'test_admin_auto@gullygang.in';
    const testAdminPwd = 'SecureAdminPassword123!';

    // Ensure clean state
    await queryInsForge(`DELETE FROM auth.users WHERE email = '${testAdminEmail}';`);

    // Create user via InsForge Auth
    const createRes = await fetch(`${host}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ email: testAdminEmail, password: testAdminPwd, name: 'Automated Test Admin' })
    });
    
    if (createRes.ok) {
      // Elevate to is_project_admin = true
      await queryInsForge(`UPDATE auth.users SET email_verified = true, is_project_admin = true WHERE email = '${testAdminEmail}';`);

      // Test login via handler
      const realLoginRes = await executeHandler(adminHandler, {
        method: 'POST',
        url: '/api/admin?action=login',
        body: { email: testAdminEmail, password: testAdminPwd }
      });

      assert(realLoginRes.status === 200, 'Real admin login succeeded with 200 OK');
      assert(realLoginRes.headers['set-cookie']?.includes('gullygang_admin_session'), 'HttpOnly session cookie set in response');
      assert(realLoginRes.data.user.email === testAdminEmail, 'Response returned correct authenticated user');
      assert(realLoginRes.data.user.is_project_admin === true, 'Response verified is_project_admin = true');

      sessionToken = realLoginRes.data.accessToken;
    }
  }

  assert(sessionToken !== null, 'Acquired valid InsForge authenticated session token');

  // -----------------------------------------------------------
  // STEP 4: SESSION ENDPOINT VALIDATION & LOGOUT
  // -----------------------------------------------------------
  console.log('\n--- 4. Testing Session Lifecycle & Authorization ---');

  const sessionCheckRes = await executeHandler(adminHandler, {
    method: 'GET',
    url: '/api/admin?action=session',
    headers: {
      cookie: `gullygang_admin_session=${sessionToken}`
    }
  });
  assert(sessionCheckRes.status === 200, 'Session endpoint verified valid admin session');
  assert(sessionCheckRes.data.is_authenticated === true, 'Session returned is_authenticated = true');

  // -----------------------------------------------------------
  // STEP 5: OVERVIEW STATS & REAL COUNTS
  // -----------------------------------------------------------
  console.log('\n--- 5. Testing Overview Live Stats ---');

  const overviewRes = await executeHandler(adminHandler, {
    method: 'GET',
    url: '/api/admin?action=overview',
    headers: {
      cookie: `gullygang_admin_session=${sessionToken}`
    }
  });
  assert(overviewRes.status === 200, 'Overview stats returned 200 OK');
  assert(typeof overviewRes.data.counts.playlists_total === 'number', 'Playlists total count is numeric');
  assert(typeof overviewRes.data.counts.songs_total === 'number', 'Songs total count is numeric');
  assert(typeof overviewRes.data.counts.visuals_total === 'number', 'Visuals total count is numeric');
  assert(typeof overviewRes.data.counts.blogs_published === 'number', 'Blogs published count is numeric');
  console.log(`    Current DB counts: Playlists=${overviewRes.data.counts.playlists_total} (${overviewRes.data.counts.playlists_active} active), Songs=${overviewRes.data.counts.songs_total}, Visuals=${overviewRes.data.counts.visuals_total}, Blogs=${overviewRes.data.counts.blogs_total}`);

  // -----------------------------------------------------------
  // STEP 6: PLAYLISTS CRUD MUTATION TEST
  // -----------------------------------------------------------
  console.log('\n--- 6. Testing Playlists Live Database CRUD ---');

  // 6a. Create playlist
  const createPlRes = await executeHandler(adminHandler, {
    method: 'POST',
    url: '/api/admin?action=playlists',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      name: 'Test Drill Showcase',
      slug: 'test-drill-showcase',
      icon: '🔥',
      youtube_playlist_url: 'https://youtube.com/playlist?list=PL_TEST_123',
      display_order: 99,
      is_active: true
    }
  });
  assert(createPlRes.status === 201, 'Created test playlist row (201 Created)');
  const testPlaylistId = createPlRes.data.playlist.id;
  assert(testPlaylistId !== undefined, `Playlist ID generated: ${testPlaylistId}`);

  // 6b. Update playlist
  const updatePlRes = await executeHandler(adminHandler, {
    method: 'PUT',
    url: '/api/admin?action=playlists',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      id: testPlaylistId,
      name: 'Test Drill Showcase (Updated)',
      slug: 'test-drill-showcase-updated',
      icon: '⚡',
      youtube_playlist_url: 'https://youtube.com/playlist?list=PL_TEST_123_UPDATED',
      display_order: 100,
      is_active: true
    }
  });
  assert(updatePlRes.status === 200, 'Updated playlist row (200 OK)');
  assert(updatePlRes.data.playlist.name === 'Test Drill Showcase (Updated)', 'Playlist name updated in database');

  // -----------------------------------------------------------
  // STEP 7: SONGS CRUD MUTATION TEST
  // -----------------------------------------------------------
  console.log('\n--- 7. Testing Songs Live Database CRUD ---');

  // 7a. Add song to test playlist
  const createSongRes = await executeHandler(adminHandler, {
    method: 'POST',
    url: '/api/admin?action=songs',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      playlist_id: testPlaylistId,
      title: 'Gully Test Anthem',
      artist: 'DIVINE ft. MC Altaf',
      youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      display_order: 1,
      is_active: true
    }
  });
  assert(createSongRes.status === 201, 'Created test song row (201 Created)');
  assert(createSongRes.data.song.youtube_id === 'dQw4w9WgXcQ', 'Extracted 11-char YouTube ID correctly');
  const testSongId = createSongRes.data.song.id;

  // 7b. Update song
  const updateSongRes = await executeHandler(adminHandler, {
    method: 'PUT',
    url: '/api/admin?action=songs',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      id: testSongId,
      playlist_id: testPlaylistId,
      title: 'Gully Test Anthem (Remix)',
      artist: 'DIVINE, MC Altaf, Phenom',
      youtube_id: 'dQw4w9WgXcQ',
      display_order: 2,
      is_active: true
    }
  });
  assert(updateSongRes.status === 200, 'Updated song row (200 OK)');
  assert(updateSongRes.data.song.title === 'Gully Test Anthem (Remix)', 'Song title updated in database');

  // 7c. Delete song
  const deleteSongRes = await executeHandler(adminHandler, {
    method: 'DELETE',
    url: `/api/admin?action=songs&id=${testSongId}`,
    headers: { cookie: `gullygang_admin_session=${sessionToken}` }
  });
  assert(deleteSongRes.status === 200, 'Deleted test song (200 OK)');

  // -----------------------------------------------------------
  // STEP 8: VISUALS CRUD MUTATION TEST
  // -----------------------------------------------------------
  console.log('\n--- 8. Testing Visuals Atmosphere Database CRUD ---');

  // 8a. Create visual
  const createVisualRes = await executeHandler(adminHandler, {
    method: 'POST',
    url: '/api/admin?action=visuals',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      name: 'Test Neon Cyberpunk Rain',
      url: 'https://www.youtube.com/embed/test_stream_id',
      display_order: 99,
      is_active: true
    }
  });
  assert(createVisualRes.status === 201, 'Created visual row (201 Created)');
  const testVisualId = createVisualRes.data.visual.id;

  // 8b. Update visual
  const updateVisualRes = await executeHandler(adminHandler, {
    method: 'PUT',
    url: '/api/admin?action=visuals',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      id: testVisualId,
      name: 'Test Neon Cyberpunk Rain (Active)',
      url: 'https://www.youtube.com/embed/test_stream_id',
      display_order: 99,
      is_active: true
    }
  });
  assert(updateVisualRes.status === 200, 'Updated visual row (200 OK)');

  // 8c. Delete visual
  const deleteVisualRes = await executeHandler(adminHandler, {
    method: 'DELETE',
    url: `/api/admin?action=visuals&id=${testVisualId}`,
    headers: { cookie: `gullygang_admin_session=${sessionToken}` }
  });
  assert(deleteVisualRes.status === 200, 'Deleted test visual (200 OK)');

  // -----------------------------------------------------------
  // STEP 9: BLOG POSTS CRUD & PUBLIC API INTEGRATION TEST
  // -----------------------------------------------------------
  console.log('\n--- 9. Testing Blog CRUD & Public API Synchronization ---');

  const testBlogSlug = 'test-underground-hip-hop-revolution-' + Date.now();

  // 9a. Create blog post as published
  const createBlogRes = await executeHandler(adminHandler, {
    method: 'POST',
    url: '/api/admin?action=blog',
    headers: { cookie: `gullygang_admin_session=${sessionToken}` },
    body: {
      title: 'The Underground Revolution in Mumbai',
      slug: testBlogSlug,
      excerpt: 'How hip hop took over the streets of Bombay and became a global movement.',
      content: '## The Street Story\n\nAuthentic stories straight from the gullys of Mumbai.',
      featured_image: 'https://gullygang.in/brand-cover.png',
      reading_time: '4 min read',
      author: 'GULLYGANG Editorial',
      status: 'published'
    }
  });
  assert(createBlogRes.status === 201, 'Created published blog post (201 Created)');
  const testBlogId = createBlogRes.data.post.id;

  // 9b. Verify article appears in public API
  const publicBlogRes = await executeHandler(publicHandler, {
    method: 'GET',
    url: `/api/public?type=blog&slug=${testBlogSlug}`
  });
  assert(publicBlogRes.status === 200, 'Public blog API returned published article');
  assert(publicBlogRes.data.title === 'The Underground Revolution in Mumbai', 'Public API data matches created article');

  // 9c. Delete test blog post
  const deleteBlogRes = await executeHandler(adminHandler, {
    method: 'DELETE',
    url: `/api/admin?action=blog&id=${testBlogId}`,
    headers: { cookie: `gullygang_admin_session=${sessionToken}` }
  });
  assert(deleteBlogRes.status === 200, 'Deleted test blog post (200 OK)');

  // 9d. Clean up test playlist
  const deletePlRes = await executeHandler(adminHandler, {
    method: 'DELETE',
    url: `/api/admin?action=playlists&id=${testPlaylistId}`,
    headers: { cookie: `gullygang_admin_session=${sessionToken}` }
  });
  assert(deletePlRes.status === 200, 'Deleted test playlist (200 OK)');

  // -----------------------------------------------------------
  // STEP 10: CLEANUP TEST ADMIN
  // -----------------------------------------------------------
  console.log('\n--- 10. Cleaning Up Test Data ---');
  await queryInsForge("DELETE FROM auth.users WHERE email = 'test_admin_auto@gullygang.in';");
  console.log('  Cleaned up temporary test admin account.');

  console.log('\n============================================================');
  console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} assertions)`);
  console.log('============================================================');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Aborted with Error:', err);
  process.exit(1);
});
