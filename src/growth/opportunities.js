// ============================================================
// GULLYGANG — GROWTH OPPORTUNITIES & SEARCH DEMAND INTELLIGENCE
// Pure first-party algorithm for unmet search ranking and scoring
// ============================================================

/**
 * Calculate growth percentage between two equivalent time windows
 */
export function calculateTrendPercent(current, previous) {
  const c = Math.max(0, parseInt(current, 10) || 0);
  const p = Math.max(0, parseInt(previous, 10) || 0);
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

/**
 * Calculate opportunity score (1 - 100) based on search demand, growth trend,
 * zero-result frequency, and existing coverage penalty.
 */
export function calculateOpportunityScore({
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
export function determineRecommendedAction({
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
export function normalizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}
