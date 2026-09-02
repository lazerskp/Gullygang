// ============================================================
// GULLYGANG — ON-SITE SEO HEALTH ENGINE & AUDIT RULES
// Client and server-side editorial quality and meta auditor
// ============================================================

/**
 * Count clean words in a markdown or HTML string
 */
export function countWords(content) {
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
export function countInternalLinks(content) {
  if (!content || typeof content !== 'string') return 0;
  // Matches markdown [text](/blog/slug) or [text](https://gullygang.in/blog/slug) or <a href="/blog/...">
  const mdPattern = /\[([^\]]+)\]\((?:\/blog\/|https?:\/\/(?:www\.)?gullygang\.in\/blog\/|\/top-10-rappers-in-india)([^)\s]*)\)/gi;
  const htmlPattern = /<a\s+[^>]*href=["'](?:\/blog\/|https?:\/\/(?:www\.)?gullygang\.in\/blog\/|\/top-10-rappers-in-india)([^"'>\s]*)["'][^>]*>/gi;
  
  const mdMatches = content.match(mdPattern) || [];
  const htmlMatches = content.match(htmlPattern) || [];
  return mdMatches.length + htmlMatches.length;
}

/**
 * Run a full on-page SEO health audit on an article object
 */
export function auditArticleSeo(article = {}, allPosts = []) {
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

  return {
    score: finalScore,
    checks
  };
}
