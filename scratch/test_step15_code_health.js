/**
 * GULLYGANG / ODIVERSE — Code Health & Stabilization Verification Suite
 * Verifies syntax, imports, Python compilation, code health, singleton player invariant,
 * production bundle budgets, and security posture across Steps 8-15.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

async function runAll() {
  console.log('============================================================');
  console.log('🛡️  RUNNING CODE HEALTH & STABILIZATION AUDIT');
  console.log('============================================================\n');

  // --- 1. Syntax & Compilation Health ---
  console.log('--- 1. Syntax & Compilation Health ---');

  runTest('Python services compile cleanly with py_compile', () => {
    execSync('python3 -m py_compile services/ytmusic/app.py services/ytmusic/provider.py', { stdio: 'pipe' });
  });

  runTest('Main entrypoints and bundle source files pass node --check', () => {
    const keyFiles = [
      'app.js',
      'weather-effects.js',
      'src/main.js',
      'src/core/router.js',
      'src/core/state.js',
      'src/music/artist.js',
      'src/music/album.js',
      'src/music/discovery.js',
      'src/music/search.js',
      'src/music/queue.js',
      'src/music/playlists.js',
      'src/music/visuals.js',
      'src/blog/feed.js',
      'src/blog/article.js',
      'src/blog/markdown.js',
      'src/growth/opportunities.js',
      'src/growth/seo-health.js',
      'src/growth/internal-links.js',
      'src/analytics/analytics.js',
      'src/realtime/realtime-manager.js',
      'src/features/modals.js',
      'src/features/weather.js',
      'api/music.js',
      'api/music-provider.js',
      'api/admin.js',
      'api/public.js',
      'api/analytics.js',
      'api/growth-helpers.js',
      'api/article_render.js',
      'api/_db.js'
    ];

    keyFiles.forEach(relPath => {
      const fullPath = path.join(__dirname, '..', relPath);
      if (fs.existsSync(fullPath)) {
        execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
      }
    });
  });

  // --- 2. File Health & No Accidental Prose in Executable Files ---
  console.log('\n--- 2. File Health & Prose Leak Audit ---');

  runTest('Executable Python files contain valid docstrings/comments and no raw text', () => {
    const pyFiles = ['services/ytmusic/app.py', 'services/ytmusic/provider.py'];
    pyFiles.forEach(relPath => {
      const fullPath = path.join(__dirname, '..', relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      // Verify line 1 has valid shebang or docstring or comment
      const firstNonEmpty = lines.find(l => l.trim().length > 0);
      assert(
        firstNonEmpty.startsWith('#') || firstNonEmpty.startsWith('"""') || firstNonEmpty.startsWith("'''"),
        `File ${relPath} must start with a comment or docstring`
      );
    });
  });

  // --- 3. Module Import & Export Graph Integrity ---
  console.log('\n--- 3. Module Import & Export Graph ---');

  runTest('All ES module import targets exist on disk', () => {
    const srcDir = path.join(__dirname, '../src');
    function checkImportsInDir(dir) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) {
          checkImportsInDir(full);
        } else if (file.endsWith('.js')) {
          const content = fs.readFileSync(full, 'utf8');
          const importMatches = [...content.matchAll(/import\s+(?:.*?\s+from\s+)?['"](.*?)['"]/g)];
          importMatches.forEach(match => {
            const importPath = match[1];
            if (importPath.startsWith('.')) {
              const target = path.resolve(dir, importPath.endsWith('.js') ? importPath : importPath + '.js');
              assert(fs.existsSync(target), `Import target ${importPath} from ${file} does not exist (${target})`);
            }
          });
        }
      });
    }
    checkImportsInDir(srcDir);
  });

  // --- 4. Production Build & Bundle Budget ---
  console.log('\n--- 4. Production Build & Performance Budget ---');

  runTest('npm run build creates all bundles and dist/app.min.js is <= 50.0 KB', () => {
    execSync('npm run build', { stdio: 'pipe' });
    const appMin = path.join(__dirname, '../dist/app.min.js');
    const artistMin = path.join(__dirname, '../dist/artist.min.js');
    const albumMin = path.join(__dirname, '../dist/album.min.js');
    const discoveryMin = path.join(__dirname, '../dist/discovery.min.js');

    assert(fs.existsSync(appMin), 'dist/app.min.js must exist');
    assert(fs.existsSync(artistMin), 'dist/artist.min.js must exist');
    assert(fs.existsSync(albumMin), 'dist/album.min.js must exist');
    assert(fs.existsSync(discoveryMin), 'dist/discovery.min.js must exist');

    const appSize = fs.statSync(appMin).size;
    assert(appSize <= 51200, `Critical bundle dist/app.min.js must be <= 50 KB (actual: ${appSize} bytes)`);
  });

  // --- 5. Persistent Audio Player Shell Invariant ---
  console.log('\n--- 5. Persistent Player Shell Invariant ---');

  const templates = ['index.html', 'blog.html', 'article.html', 'artist.html', 'album.html'];
  templates.forEach(tpl => {
    runTest(`Exactly one #yt-player shell in ${tpl}`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', tpl), 'utf8');
      const matches = content.match(/id=["']yt-player["']/g) || [];
      assert.strictEqual(matches.length, 1, `Expected 1 #yt-player in ${tpl}, found ${matches.length}`);
    });
  });

  // --- 6. Security & Secret Exposure Audit ---
  console.log('\n--- 6. Security Posture & Secrets Audit ---');

  runTest('No secrets or private tokens in src/ or dist/', () => {
    const sensitivePatterns = [
      /INSFORGE_ADMIN_API_KEY/i,
      /eyJhbGciOi/i, // JWT token prefix
      /SUPABASE_SERVICE_ROLE/i,
      /PRIVATE_KEY/i
    ];

    function scanDir(dir) {
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        const full = path.join(dir, f);
        if (f.endsWith('.map')) return;
        if (fs.statSync(full).isDirectory()) {
          scanDir(full);
        } else if (f.endsWith('.js') || f.endsWith('.html')) {
          const content = fs.readFileSync(full, 'utf8');
          sensitivePatterns.forEach(pattern => {
            assert(!pattern.test(content), `Found sensitive pattern ${pattern} in ${full}`);
          });
        }
      });
    }

    scanDir(path.join(__dirname, '../src'));
    scanDir(path.join(__dirname, '../dist'));
  });

  // --- 7. Music API Route Registration ---
  console.log('\n--- 7. Music Provider API Registration ---');

  runTest('Music provider exports required search and retrieval functions', () => {
    const provider = require('../api/music-provider.js');
    assert(typeof provider.searchMusic === 'function', 'searchMusic function missing');
    assert(typeof provider.getArtist === 'function', 'getArtist function missing');
    assert(typeof provider.getAlbum === 'function', 'getAlbum function missing');
    assert(typeof provider.getMusicSuggestions === 'function', 'getMusicSuggestions missing');
    assert(typeof provider.getRelatedMusic === 'function', 'getRelatedMusic missing');
  });

  console.log('\n============================================================');
  console.log(`📊 CODE HEALTH AUDIT RESULTS: ${passed}/${passed + failed} TESTS PASSED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Code Health Audit Runner Error:', err);
  process.exit(1);
});
