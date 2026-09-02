/**
 * test_step13_growth_intelligence.js
 * Comprehensive Verification Suite for Step 13:
 * Growth Intelligence, Content Opportunities & SEO Performance Engine
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Load .env.local if present
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...vals] = trimmed.split('=');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}
loadEnv();

const growthHelpers = require('../api/growth-helpers.js');
const adminHandler = require('../api/admin.js');

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

async function runTests() {
  console.log('===========================================================');
  console.log(' STEP 13: GROWTH INTELLIGENCE & SEO ENGINE TEST SUITE');
  console.log('===========================================================\n');

  // 1. Content Opportunity Scoring & Trend Calculation
  console.log('--- 1. Content Opportunity Intelligence ---');
  {
    const searches = [
      { search_query: 'Divine new album', count: 12, prev_count: 4, zero_count: 10 },
      { search_query: 'DIVINE NEW ALBUM', count: 3, prev_count: 1, zero_count: 3 },
      { search_query: 'gully gang tour 2026', count: 8, prev_count: 0, zero_count: 8 },
      { search_query: 'desi hip hop history', count: 5, prev_count: 5, zero_count: 0 }
    ];

    const existingArticles = [
      { id: '1', title: 'The Complete Desi Hip Hop History', slug: 'desi-hip-hop-history', tags: ['hip-hop', 'history'] }
    ];

    const opps = growthHelpers.calculateContentOpportunities(searches, existingArticles);
    assert(Array.isArray(opps), 'calculateContentOpportunities returns an array');
    assert(opps.length > 0, 'Generates opportunity records');
    
    const divineOpp = opps.find(o => o.query === 'divine new album');
    assert(divineOpp !== undefined, 'Normalizes and aggregates case-insensitive search queries');
    assert(divineOpp.searches === 15, `Aggregates search counts accurately (expected 15, got ${divineOpp?.searches})`);
    assert(divineOpp.opportunity_score >= 50, `Calculates high opportunity score for unmet demand (${divineOpp?.opportunity_score})`);
    assert(divineOpp.recommended_action === 'create_article', `Recommends create_article when coverage is 0 (got ${divineOpp?.recommended_action})`);

    const desiOpp = opps.find(o => o.query === 'desi hip hop history');
    assert(desiOpp !== undefined, 'Identifies existing coverage for covered queries');
    assert(desiOpp.existing_coverage >= 1, `Finds existing article coverage (got ${desiOpp?.existing_coverage})`);
    assert(desiOpp.recommended_action === 'improve_existing_coverage' || desiOpp.recommended_action === 'update_existing_article', `Recommends coverage improvement when article exists`);
  }

  // 2. Search-to-Article Conversion & CTR Intelligence
  console.log('\n--- 2. Search-to-Article Conversion Intelligence ---');
  {
    const searchStats = [
      { search_query: 'seedhe maut tour', search_count: 20, result_clicks: 0, zero_count: 15 },
      { search_query: 'raftaar news', search_count: 50, result_clicks: 25, zero_count: 0 }
    ];

    const conversion = growthHelpers.calculateSearchConversion(searchStats);
    assert(conversion.total_searches === 70, `Aggregates total searches (70, got ${conversion.total_searches})`);
    assert(conversion.total_clicks === 25, `Aggregates total clicks (25, got ${conversion.total_clicks})`);
    assert(conversion.search_ctr === 35.7, `Calculates overall search CTR percentage (35.7%, got ${conversion.search_ctr}%)`);
    
    const lowMatch = conversion.queries.find(q => q.query === 'seedhe maut tour');
    assert(lowMatch && lowMatch.needs_better_content_match === true, 'Flags low-CTR / high-zero searches as "needs_better_content_match"');

    const highMatch = conversion.queries.find(q => q.query === 'raftaar news');
    assert(highMatch && highMatch.needs_better_content_match === false, 'Maintains healthy status for high-conversion searches');
  }

  // 3. Trending Content Detection (Balanced Growth Scoring)
  console.log('\n--- 3. Trending Content Detection ---');
  {
    const currentArticles = [
      { id: 'art-1', title: 'Major Rap Festival 2026', slug: 'rap-fest-2026', current_views: 450, previous_views: 100 },
      { id: 'art-2', title: 'Niche Track Release', slug: 'niche-track', current_views: 8, previous_views: 1 },
      { id: 'art-3', title: 'Steady Classic Guide', slug: 'steady-classic', current_views: 500, previous_views: 490 }
    ];

    const trending = growthHelpers.detectTrendingContent(currentArticles);
    assert(Array.isArray(trending), 'detectTrendingContent returns an array');
    assert(trending.length >= 2, 'Detects trending articles with positive growth');
    
    // Balanced scoring: art-1 (+350 views) should rank higher than art-2 (+7 views, 700% growth)
    assert(trending[0].article.id === 'art-1', `Balanced scoring prioritizes meaningful volume growth over tiny baseline distortions (1st: ${trending[0]?.article?.id})`);
    assert(trending[0].absolute_growth === 350, `Computes absolute growth (+350 views)`);
    assert(trending[0].percentage_growth === 350, `Computes percentage growth (+350%)`);
  }

  // 4. Content Decay Detection
  console.log('\n--- 4. Content Decay Detection ---');
  {
    const articles = [
      { id: 'decayed-1', title: 'Old Tour Dates 2025', slug: 'old-tour', current_views: 10, previous_views: 100, published_at: new Date(Date.now() - 40 * 86400000).toISOString() },
      { id: 'new-1', title: 'Fresh Drop Today', slug: 'fresh-drop', current_views: 5, previous_views: 20, published_at: new Date(Date.now() - 5 * 86400000).toISOString() },
      { id: 'stable-1', title: 'Evergreen Glossary', slug: 'evergreen', current_views: 95, previous_views: 100, published_at: new Date(Date.now() - 60 * 86400000).toISOString() }
    ];

    const decay = growthHelpers.detectContentDecay(articles);
    assert(Array.isArray(decay), 'detectContentDecay returns an array');
    assert(decay.length === 1, `Correctly identifies only established articles with >= 25% traffic drop (found ${decay.length})`);
    assert(decay[0].article.id === 'decayed-1', 'Targets the decayed article');
    assert(decay[0].decline_percent === 90, `Calculates decline percent (90%, got ${decay[0]?.decline_percent}%)`);
  }

  // 5. SEO Health Engine Audit Checks
  console.log('\n--- 5. SEO Health Engine Audit ---');
  {
    const perfectPost = {
      id: 'p1',
      title: 'Top 10 Indian Hip-Hop Producers Shaping the Global Sound in 2026',
      slug: 'top-10-indian-hip-hop-producers-2026',
      excerpt: 'Discover the most innovative Indian hip-hop beatmakers and producers crafting chart-topping drill, boom bap, and fusion tracks in 2026.',
      seo_title: 'Top 10 Indian Hip-Hop Producers (2026 Edition) | GULLYGANG',
      seo_description: 'Discover the most innovative Indian hip-hop beatmakers crafting chart-topping drill and boom bap tracks in 2026.',
      featured_image: 'https://cdn.gullygang.in/images/producers.webp',
      tags: ['hip-hop', 'producers', 'beatmakers'],
      content: '## Introduction\n\n' + 'Indian hip-hop production has evolved exponentially with groundbreaking rhythm and sound design. '.repeat(45) + '\n\nRead our guide on [underground rap](/blog/underground-rap-india) for more background.',
      status: 'published'
    };

    const audit = growthHelpers.auditArticleSeo(perfectPost);
    assert(audit.score >= 85, `Audits high-quality article with top score (got ${audit.score}/100)`);
    assert(audit.word_count >= 300, `Counts markdown word depth correctly (${audit.word_count} words)`);
    assert(audit.internal_links_count >= 1, `Detects internal links in markdown (${audit.internal_links_count} links)`);
    assert(audit.checks.title_length.passed === true, 'Title length check passed');
    assert(audit.checks.seo_description.passed === true, 'SEO description check passed');
    assert(audit.checks.featured_image.passed === true, 'Featured image check passed');
    assert(audit.checks.topic_tags.passed === true, 'Topic tags check passed');
    assert(audit.checks.canonical_slug.passed === true, 'Canonical slug check passed');

    const poorPost = {
      id: 'p2',
      title: 'Short',
      slug: 'INVALID SLUG!',
      content: 'too short',
      status: 'draft'
    };
    const poorAudit = growthHelpers.auditArticleSeo(poorPost);
    assert(poorAudit.score < 50, `Penalizes low-effort content (got ${poorAudit.score}/100)`);
    assert(poorAudit.checks.word_count.passed === false, 'Fails low word count');
    assert(poorAudit.checks.canonical_slug.passed === false, 'Fails invalid slug');
  }

  // 6. Internal Link Recommendations
  console.log('\n--- 6. Internal Link Intelligence ---');
  {
    const targetPost = {
      id: 't1',
      title: 'Mumbai Gully Rap Origins and Revolution',
      slug: 'mumbai-gully-rap-origins',
      tags: ['mumbai', 'gully-rap', 'desi-hip-hop', 'divine'],
      content: 'The Mumbai rap movement sparked by Divine and Naezy revolutionized Indian hip hop street culture.'
    };

    const corpus = [
      targetPost,
      {
        id: 'c1',
        title: 'Divine: The Street Voice That Built an Empire',
        slug: 'divine-street-voice-empire',
        tags: ['divine', 'gully-rap', 'interviews'],
        content: 'Divine emerged from Mumbai slums to pioneer desi hip hop with authentic storytelling and lyricism.'
      },
      {
        id: 'c2',
        title: 'Delhi Underground Drill Movement',
        slug: 'delhi-underground-drill',
        tags: ['delhi', 'drill', 'underground'],
        content: 'A complete breakdown of drill music from the national capital.'
      }
    ];

    const suggestions = growthHelpers.suggestInternalLinks(targetPost, corpus);
    assert(Array.isArray(suggestions), 'suggestInternalLinks returns an array');
    assert(suggestions.length > 0, 'Finds relevant internal linking targets');
    assert(!suggestions.some(s => s.article.id === targetPost.id), 'Strictly excludes self-referential article links');
    assert(suggestions[0].article.id === 'c1', `Ranks highest relevance match (c1 with shared tags: ${suggestions[0]?.shared_tags?.join(', ')})`);
    assert(suggestions[0].relevance_score >= 40, `Scores high relevance for shared tags (${suggestions[0]?.relevance_score})`);
    assert(Array.isArray(suggestions[0].suggested_anchors) && suggestions[0].suggested_anchors.length > 0, 'Provides natural suggested anchor text keywords');
  }

  // 7. Backend API Router Handlers & Admin Security
  console.log('\n--- 7. Backend Admin API Router Integration ---');
  {
    // Helper to invoke admin handler mock with Express/Vercel shape
    function mockApiCall(url, sessionCookie = null) {
      return new Promise((resolve) => {
        const parsedUrl = new URL(url, 'http://localhost:3000');
        const queryObj = {};
        for (const [k, v] of parsedUrl.searchParams.entries()) {
          queryObj[k] = v;
        }

        const req = {
          url,
          query: queryObj,
          method: 'GET',
          headers: {
            host: 'localhost:3000',
            cookie: sessionCookie || ''
          }
        };

        let statusCode = 200;
        let responseData = null;

        const res = {
          status: function(code) {
            statusCode = code;
            return this;
          },
          setHeader: function() { return this; },
          writeHead: function(code) { statusCode = code; return this; },
          json: function(data) {
            responseData = data;
            resolve({ statusCode, data: responseData });
            return this;
          },
          end: function(data) {
            if (data && !responseData) {
              try {
                responseData = JSON.parse(data);
              } catch(e) {
                responseData = data;
              }
            }
            resolve({ statusCode, data: responseData });
            return this;
          }
        };

        adminHandler(req, res);
      });
    }

    // Test unauthenticated access rejection
    const unauthRes = await mockApiCall('/api/admin?action=content_opportunities');
    assert(unauthRes.statusCode === 401 || unauthRes.statusCode === 403, `Unauthenticated growth API call rejected (${unauthRes.statusCode})`);

    const unauthSeo = await mockApiCall('/api/admin?action=seo_overview');
    assert(unauthSeo.statusCode === 401 || unauthSeo.statusCode === 403, `Unauthenticated SEO overview rejected (${unauthSeo.statusCode})`);
  }

  // 8. Bundle Size & UI File Verification
  console.log('\n--- 8. Bundle Budget & UI Architecture ---');
  {
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    assert(adminHtml.includes('First-Party Growth Intelligence & SEO Engine'), 'admin.html contains Growth Intelligence title header');
    assert(adminHtml.includes('analytics-opportunities-body'), 'admin.html contains Content Opportunities table container');
    assert(adminHtml.includes('analytics-trending-body'), 'admin.html contains Trending Now table container');
    assert(adminHtml.includes('analytics-decay-body'), 'admin.html contains Content Decay table container');
    assert(adminHtml.includes('analytics-conversion-body'), 'admin.html contains Search Conversion table container');
    assert(adminHtml.includes('analytics-seo-body'), 'admin.html contains SEO Health Overview table container');
    assert(adminHtml.includes('m-post-intelligence-wrap'), 'admin.html contains Article Intelligence Panel for Blog Editor');
    assert(adminHtml.includes('m-seo-checks-list'), 'admin.html contains Live SEO Audit Checklist container');
    assert(adminHtml.includes('m-internal-links-list'), 'admin.html contains Internal Link Suggestions container');
    assert(adminHtml.includes('insertInternalLink'), 'admin.html contains insertInternalLink handler');
    assert(adminHtml.includes('runLiveSeoAudit'), 'admin.html contains runLiveSeoAudit handler');

    const distPath = path.join(__dirname, '..', 'dist', 'app.min.js');
    if (fs.existsSync(distPath)) {
      const stats = fs.statSync(distPath);
      const sizeKb = (stats.size / 1024).toFixed(2);
      assert(stats.size < 50 * 1024, `Production client bundle is under 50 KB (actual: ${sizeKb} KB)`);
    } else {
      assert(false, 'dist/app.min.js exists');
    }
  }

  console.log('\n===========================================================');
  console.log(` SUMMARY: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
  console.log('===========================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
