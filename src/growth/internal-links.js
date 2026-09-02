// ============================================================
// GULLYGANG — INTERNAL LINK INTELLIGENCE & RELEVANCE ENGINE
// Contextual cross-article link recommendation and anchor generation
// ============================================================

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
export function extractKeywords(text) {
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
export function generateSuggestedAnchors(targetArticle, sharedTags = []) {
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
export function generateInternalLinkSuggestions(sourceArticle, candidateArticles = [], limit = 5) {
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
      shared_tags: sharedTags,
      relevance_score: Math.min(100, Math.max(1, totalRelevance)),
      suggested_anchor_keywords: suggestedAnchors
    });
  }

  // Sort descending by relevance score
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  return results.slice(0, limit);
}
