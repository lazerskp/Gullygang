// ============================================================
// GULLYGANG — SERVER GROWTH & SEO INTELLIGENCE ENGINE HELPERS
// Privacy-first algorithms for growth scoring, SEO audits, and internal linking
// ============================================================

/**
 * Calculate growth percentage between two equivalent time windows
 */
function calculateTrendPercent(current, previous) {
  const c = Math.max(0, parseInt(current, 10) || 0);
  const p = Math.max(0, parseInt(previous, 10) || 0);
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

/**
 * Calculate opportunity score (1 - 100) based on search demand, growth trend,
 * zero-result frequency, and existing coverage penalty.
 */
function calculateOpportunityScore({
  searches = 0,
  previous_searches = 0,
  zero_searches = 0,
  existing_coverage = 0,
  trend_percent = null
} = {}) {
  const total = Math.max(0, parseInt(searches, 10) || 0);
  const prev = Math.max(0, parseInt(previous_searches, 10) || 0);
  const zero = Math.max(0, parseInt(zero_searches, 10) || 0);
  const coverage = Math.max(0, parseInt(existing_coverage, 10) || 0);

  if (total === 0 && zero === 0) return 0;

  const trend = trend_percent !== null ? trend_percent : calculateTrendPercent(total, prev);

  // 1. Search Volume Base Component (up to 40 pts)
  const volumeScore = Math.min(40, total * 4);

  // 2. Trend Acceleration Component (up to 25 pts)
  let trendScore = 0;
  if (trend > 0) {
    trendScore = Math.min(25, Math.round(trend * 0.25));
  } else if (trend < -50) {
    trendScore = -10;
  }

  // 3. Zero-Result Unmet Demand Bonus (up to 35 pts)
  const zeroRatio = total > 0 ? zero / total : (zero > 0 ? 1 : 0);
  const unmetScore = Math.round(zeroRatio * 35);

  // 4. Existing Coverage Penalty
  const coveragePenalty = Math.min(40, coverage * 20);

  // Raw Composite
  let rawScore = volumeScore + trendScore + unmetScore - coveragePenalty;

  // Normalization range 1 - 100
  return Math.min(100, Math.max(1, Math.round(rawScore)));
}

/**
 * Determine the optimal editorial recommendation for a search opportunity
 */
function determineRecommendedAction({
  existing_coverage = 0,
  searches = 0,
  zero_searches = 0,
  click_through_rate = null
} = {}) {
  const coverage = parseInt(existing_coverage, 10) || 0;
  const zero = parseInt(zero_searches, 10) || 0;
  const total = parseInt(searches, 10) || 0;
  const ctr = click_through_rate !== null ? parseFloat(click_through_rate) : null;

  if (coverage === 0) {
    return 'create_article';
  }

  if (zero > 0 && total > 0 && (zero / total) > 0.5) {
    return 'update_existing_article';
  }

  if (ctr !== null && ctr < 15 && total >= 3) {
    return 'improve_existing_coverage';
  }

  if (coverage > 0) {
    return 'update_existing_article';
  }

  return 'create_article';
}

/**
 * Clean and normalize search query text
 */
function normalizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Count clean words in a markdown or HTML string
 */
function countWords(content) {
  if (!content || typeof content !== 'string') return 0;
  const clean = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*`_~\[\]()>-]/g, ' ')
    .trim();
  return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Count internal article links in markdown or HTML content
 */
function countInternalLinks(content) {
  if (!content || typeof content !== 'string') return 0;
  const mdPattern = /\[([^\]]+)\]\((?:\/blog\/|https?:\/\/(?:www\.)?gullygang\.in\/blog\/|\/top-10-rappers-in-india)([^)\s]*)\)/gi;
  const htmlPattern = /<a\s+[^>]*href=["'](?:\/blog\/|https?:\/\/(?:www\.)?gullygang\.in\/blog\/|\/top-10-rappers-in-india)([^"'>\s]*)["'][^>]*>/gi;
  
  const mdMatches = content.match(mdPattern) || [];
  const htmlMatches = content.match(htmlPattern) || [];
  return mdMatches.length + htmlMatches.length;
}

/**
 * Run a full on-page SEO health audit on an article object
 */
function auditArticleSeo(article = {}, allPosts = []) {
  if (!article || typeof article !== 'object') {
    return { score: 0, checks: [] };
  }

  const checks = [];
  let score = 100;

  const title = (article.seo_title || article.title || '').trim();
  const desc = (article.seo_description || article.excerpt || '').trim();
  const content = (article.content || '').trim();
  const slug = (article.slug || '').trim();
  const featuredImage = (article.featured_image || '').trim();
  const tags = Array.isArray(article.tags) 
    ? article.tags 
    : (typeof article.tags === 'string' ? article.tags.split(',').map(t => t.trim()).filter(Boolean) : []);
  const status = article.status || 'published';
  const articleId = article.id || null;

  // 1. SEO Title
  if (!title) {
    score -= 20;
    checks.push({
      id: 'seo_title',
      label: 'SEO Title',
      status: 'fail',
      message: 'Missing SEO title. Search engines require a descriptive headline.'
    });
  } else if (title.length < 25) {
    score -= 8;
    checks.push({
      id: 'seo_title',
      label: 'SEO Title Length',
      status: 'warning',
      message: `SEO title is too short (${title.length} chars). Aim for 30–65 characters.`
    });
  } else if (title.length > 68) {
    score -= 6;
    checks.push({
      id: 'seo_title',
      label: 'SEO Title Length',
      status: 'warning',
      message: `SEO title may be truncated in search snippets (${title.length} chars). Keep under 65.`
    });
  } else {
    checks.push({
      id: 'seo_title',
      label: 'SEO Title',
      status: 'pass',
      message: `Optimal length (${title.length} characters).`
    });
  }

  // 2. SEO Description
  if (!desc) {
    score -= 20;
    checks.push({
      id: 'seo_description',
      label: 'Meta Description',
      status: 'fail',
      message: 'Missing meta description for search snippets and social cards.'
    });
  } else if (desc.length < 50) {
    score -= 8;
    checks.push({
      id: 'seo_description',
      label: 'Meta Description Length',
      status: 'warning',
      message: `Description is brief (${desc.length} chars). Aim for 80–160 characters.`
    });
  } else if (desc.length > 175) {
    score -= 6;
    checks.push({
      id: 'seo_description',
      label: 'Meta Description Length',
      status: 'warning',
      message: `Description exceeds typical snippet limit (${desc.length} chars). Keep under 160.`
    });
  } else {
    checks.push({
      id: 'seo_description',
      label: 'Meta Description',
      status: 'pass',
      message: `Optimal description length (${desc.length} characters).`
    });
  }

  // 3. Featured Image
  if (!featuredImage) {
    score -= 15;
    checks.push({
      id: 'featured_image',
      label: 'Featured Image',
      status: 'fail',
      message: 'No featured image set. Images are critical for Open Graph and Twitter cards.'
    });
  } else {
    checks.push({
      id: 'featured_image',
      label: 'Featured Image',
      status: 'pass',
      message: 'Featured image is configured for rich social cards.'
    });
  }

  // 4. Topic Tags
  if (tags.length === 0) {
    score -= 10;
    checks.push({
      id: 'tags',
      label: 'Topic Tags',
      status: 'fail',
      message: 'No topic tags assigned. Tags enhance internal discovery and topic clustering.'
    });
  } else if (tags.length === 1) {
    score -= 4;
    checks.push({
      id: 'tags',
      label: 'Topic Tags',
      status: 'warning',
      message: 'Only 1 tag assigned. Adding 2–4 relevant tags improves internal recommendations.'
    });
  } else {
    checks.push({
      id: 'tags',
      label: 'Topic Tags',
      status: 'pass',
      message: `${tags.length} topic tags configured.`
    });
  }

  // 5. Content Word Count
  const words = countWords(content);
  if (words < 100) {
    score -= 15;
    checks.push({
      id: 'word_count',
      label: 'Content Depth',
      status: 'fail',
      message: `Thin content (${words} words). High-ranking articles typically exceed 300 words.`
    });
  } else if (words < 300) {
    score -= 6;
    checks.push({
      id: 'word_count',
      label: 'Content Depth',
      status: 'warning',
      message: `Short article (${words} words). Consider expanding with more context or media.`
    });
  } else {
    checks.push({
      id: 'word_count',
      label: 'Content Depth',
      status: 'pass',
      message: `Thorough editorial depth (${words} words).`
    });
  }

  // 6. Canonical Slug Validation
  const isValidSlugFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug);
  if (!slug || !isValidSlugFormat) {
    score -= 10;
    checks.push({
      id: 'canonical_slug',
      label: 'Canonical Slug',
      status: 'fail',
      message: 'Invalid URL slug format. Use lowercase letters, numbers, and single hyphens.'
    });
  } else {
    checks.push({
      id: 'canonical_slug',
      label: 'Canonical Slug',
      status: 'pass',
      message: `Clean canonical URL path (/${slug}).`
    });
  }

  // 7. Duplicate Titles Check
  if (title && allPosts && allPosts.length > 0) {
    const isDupTitle = allPosts.some(p => {
      if (articleId && p.id === articleId) return false;
      const otherTitle = (p.seo_title || p.title || '').trim().toLowerCase();
      return otherTitle === title.toLowerCase();
    });

    if (isDupTitle) {
      score -= 15;
      checks.push({
        id: 'duplicate_title',
        label: 'Title Uniqueness',
        status: 'fail',
        message: 'Duplicate SEO title detected. Another article has the exact same title tag.'
      });
    } else {
      checks.push({
        id: 'duplicate_title',
        label: 'Title Uniqueness',
        status: 'pass',
        message: 'Title is unique across the publication.'
      });
    }
  }

  // 8. Internal Links Count
  const internalLinkCount = countInternalLinks(content);
  if (internalLinkCount === 0) {
    score -= 8;
    checks.push({
      id: 'internal_links',
      label: 'Internal Links',
      status: 'warning',
      message: 'No internal links found in article body. Cross-linking improves user discovery.'
    });
  } else {
    checks.push({
      id: 'internal_links',
      label: 'Internal Links',
      status: 'pass',
      message: `${internalLinkCount} internal link${internalLinkCount > 1 ? 's' : ''} connected.`
    });
  }

  // 9. Publication Visibility
  if (status === 'published') {
    checks.push({
      id: 'status',
      label: 'Publication Status',
      status: 'pass',
      message: 'Article is published and indexable.'
    });
  } else {
    checks.push({
      id: 'status',
      label: 'Publication Status',
      status: 'warning',
      message: `Article is currently "${status}". Not yet visible to search engines.`
    });
  }

  const finalScore = Math.min(100, Math.max(0, score));

  // Structured checks dictionary for easy programatic assertions
  const checksDict = {};
  for (const c of checks) {
    const key = c.id === 'seo_title' ? 'title_length' : (c.id === 'tags' ? 'topic_tags' : c.id);
    checksDict[key] = {
      passed: c.status === 'pass',
      warning: c.status === 'warning',
      failed: c.status === 'fail',
      label: c.label,
      message: c.message
    };
  }

  return {
    score: finalScore,
    checks: checksDict,
    checks_list: checks,
    word_count: words,
    internal_links_count: internalLinkCount
  };
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
  'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here',
  'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
  'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it',
  'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t',
  'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some',
  'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
  'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
  'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which',
  'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would',
  'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours',
  'yourself', 'yourselves'
]);

/**
 * Extract meaningful keywords from a string, filtering out punctuation and stop words
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Generate natural anchor text options for a target article
 */
function generateSuggestedAnchors(targetArticle, sharedTags = []) {
  const anchors = new Set();
  const title = (targetArticle.title || '').trim();

  if (title) {
    anchors.add(title);
    
    // Sub-phrase anchor if title is long
    const cleanTitle = title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
    if (cleanTitle && cleanTitle !== title) {
      anchors.add(cleanTitle);
    }
  }

  // Tag-based anchor
  if (sharedTags && sharedTags.length > 0) {
    const formattedTag = sharedTags[0].replace(/-/g, ' ');
    anchors.add(formattedTag);
  }

  return Array.from(anchors).slice(0, 3);
}

/**
 * Compute relevance score and suggestions for a source article against all candidate articles
 */
function generateInternalLinkSuggestions(sourceArticle, candidateArticles = [], limit = 5) {
  if (!sourceArticle || !candidateArticles || candidateArticles.length === 0) {
    return [];
  }

  const sourceId = sourceArticle.id || null;
  const sourceTags = new Set(
    (Array.isArray(sourceArticle.tags) ? sourceArticle.tags : (sourceArticle.tags || '').split(','))
      .map(t => String(t).trim().toLowerCase())
      .filter(Boolean)
  );

  const sourceTitleKeywords = new Set(extractKeywords(sourceArticle.title || ''));
  const sourceContentLower = (sourceArticle.content || '').toLowerCase();

  const results = [];

  for (const candidate of candidateArticles) {
    // Strictly exclude the current article itself
    if (sourceId && candidate.id === sourceId) continue;
    if (sourceArticle.slug && candidate.slug === sourceArticle.slug) continue;

    const candTags = (Array.isArray(candidate.tags) ? candidate.tags : (candidate.tags || '').split(','))
      .map(t => String(t).trim().toLowerCase())
      .filter(Boolean);

    // 1. Shared Tags (up to 45 pts)
    const sharedTags = candTags.filter(t => sourceTags.has(t));
    const tagScore = Math.min(45, sharedTags.length * 20);

    // 2. Title Keyword Matches (up to 30 pts)
    const candTitleKeywords = extractKeywords(candidate.title || '');
    const matchingTitleKeywords = candTitleKeywords.filter(k => sourceTitleKeywords.has(k));
    const titleScore = Math.min(30, matchingTitleKeywords.length * 15);

    // 3. Content Context Matches (up to 25 pts)
    let contentScore = 0;
    for (const kw of candTitleKeywords) {
      if (kw.length >= 4 && sourceContentLower.includes(kw)) {
        contentScore += 5;
      }
    }
    contentScore = Math.min(25, contentScore);

    const totalRelevance = tagScore + titleScore + contentScore;

    const suggestedAnchors = generateSuggestedAnchors(candidate, sharedTags);

    results.push({
      id: candidate.id,
      title: candidate.title,
      slug: candidate.slug,
      article: {
        id: candidate.id,
        title: candidate.title,
        slug: candidate.slug
      },
      shared_tags: sharedTags,
      relevance_score: Math.min(100, Math.max(1, totalRelevance)),
      suggested_anchors: suggestedAnchors,
      suggested_anchor_keywords: suggestedAnchors
    });
  }

  // Sort descending by relevance score
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  return results.slice(0, limit);
}

/**
 * Calculate content opportunities from raw search logs and existing articles
 */
function calculateContentOpportunities(searches = [], existingArticles = []) {
  const queryMap = new Map();

  for (const s of searches) {
    const rawQuery = s.search_query || s.query || '';
    const norm = normalizeSearchQuery(rawQuery);
    if (!norm) continue;

    if (!queryMap.has(norm)) {
      queryMap.set(norm, {
        query: norm,
        searches: 0,
        previous_searches: 0,
        zero_searches: 0,
        result_clicks: 0,
        related_tags: []
      });
    }

    const entry = queryMap.get(norm);
    entry.searches += parseInt(s.count || s.searches || 1, 10);
    entry.previous_searches += parseInt(s.prev_count || s.previous_searches || 0, 10);
    entry.zero_searches += parseInt(s.zero_count || s.zero_searches || 0, 10);
    entry.result_clicks += parseInt(s.result_clicks || 0, 10);
  }

  const results = [];
  for (const [norm, data] of queryMap.entries()) {
    // Find matching coverage in existing articles
    const matchingArticles = existingArticles.filter(a => {
      const titleNorm = normalizeSearchQuery(a.title || '');
      const slugNorm = normalizeSearchQuery(a.slug || '');
      return titleNorm.includes(norm) || norm.includes(titleNorm) || slugNorm.includes(norm);
    });

    const existingCoverage = matchingArticles.length;
    const trendPercent = calculateTrendPercent(data.searches, data.previous_searches);
    const opportunityScore = calculateOpportunityScore({
      searches: data.searches,
      previous_searches: data.previous_searches,
      zero_searches: data.zero_searches,
      existing_coverage: existingCoverage,
      trend_percent: trendPercent
    });

    const recommendedAction = determineRecommendedAction({
      existing_coverage: existingCoverage,
      searches: data.searches,
      zero_searches: data.zero_searches
    });

    // Derive related tags from query keywords
    const keywords = extractKeywords(norm);

    results.push({
      query: norm,
      searches: data.searches,
      previous_searches: data.previous_searches,
      zero_searches: data.zero_searches,
      trend_percent: trendPercent,
      opportunity_score: opportunityScore,
      existing_coverage: existingCoverage,
      recommended_action: recommendedAction,
      related_tags: keywords
    });
  }

  results.sort((a, b) => b.opportunity_score - a.opportunity_score);
  return results;
}

/**
 * Calculate search conversion metrics and CTR intelligence
 */
function calculateSearchConversion(searchStats = []) {
  let totalSearches = 0;
  let totalClicks = 0;
  let totalZeros = 0;

  const queries = searchStats.map(s => {
    const query = s.search_query || s.query || '';
    const searches = parseInt(s.search_count || s.searches || s.count || 0, 10);
    const clicks = parseInt(s.result_clicks || s.clicks || 0, 10);
    const zeros = parseInt(s.zero_count || s.zero_searches || 0, 10);

    totalSearches += searches;
    totalClicks += clicks;
    totalZeros += zeros;

    const ctr = searches > 0 ? Math.round((clicks / searches) * 1000) / 10 : 0;
    const needsMatch = (searches >= 3 && ctr < 15) || zeros > 0;

    return {
      query,
      searches,
      result_clicks: clicks,
      zero_searches: zeros,
      click_through_rate: ctr,
      needs_better_content_match: needsMatch
    };
  });

  const overallCtr = totalSearches > 0 ? Math.round((totalClicks / totalSearches) * 1000) / 10 : 0;

  return {
    total_searches: totalSearches,
    total_clicks: totalClicks,
    total_zero_searches: totalZeros,
    search_ctr: overallCtr,
    queries
  };
}

/**
 * Detect trending content with balanced growth scoring
 */
function detectTrendingContent(articles = []) {
  const trending = [];

  for (const art of articles) {
    const cur = parseInt(art.current_views || art.views || 0, 10);
    const prev = parseInt(art.previous_views || 0, 10);
    const absGrowth = cur - prev;

    if (absGrowth > 0) {
      const pctGrowth = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
      
      // Balanced growth score avoiding tiny baseline skew (0.7 * abs + 0.3 * capped_pct)
      const trendScore = Math.round(absGrowth * 0.7 + Math.min(pctGrowth, 500) * 0.3);

      trending.push({
        article: {
          id: art.id,
          title: art.title,
          slug: art.slug
        },
        current_views: cur,
        previous_views: prev,
        absolute_growth: absGrowth,
        percentage_growth: pctGrowth,
        trend_score: trendScore
      });
    }
  }

  trending.sort((a, b) => b.trend_score - a.trend_score);
  return trending;
}

/**
 * Detect decayed content requiring editorial improvement
 */
function detectContentDecay(articles = []) {
  const decayed = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 86400000;

  for (const art of articles) {
    const cur = parseInt(art.current_views || art.views || 0, 10);
    const prev = parseInt(art.previous_views || 0, 10);
    const publishedAt = art.published_at ? new Date(art.published_at).getTime() : 0;

    // Must be established (published >= 30 days ago) and have baseline traffic >= 3
    const isEstablished = publishedAt > 0 ? (now - publishedAt >= thirtyDaysMs) : true;
    
    if (isEstablished && prev >= 3 && cur < prev) {
      const dropPct = Math.round(((prev - cur) / prev) * 100);
      if (dropPct >= 25) {
        decayed.push({
          article: {
            id: art.id,
            title: art.title,
            slug: art.slug
          },
          current_views: cur,
          previous_views: prev,
          decline_percent: dropPct,
          last_updated: art.updated_at || art.published_at || null
        });
      }
    }
  }

  decayed.sort((a, b) => b.decline_percent - a.decline_percent);
  return decayed;
}

module.exports = {
  calculateTrendPercent,
  calculateOpportunityScore,
  determineRecommendedAction,
  normalizeSearchQuery,
  countWords,
  countInternalLinks,
  auditArticleSeo,
  extractKeywords,
  generateSuggestedAnchors,
  generateInternalLinkSuggestions,
  suggestInternalLinks: generateInternalLinkSuggestions,
  calculateContentOpportunities,
  calculateSearchConversion,
  detectTrendingContent,
  detectContentDecay
};
