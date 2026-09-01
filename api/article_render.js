// ============================================================
// GULLYGANG — SERVER-SIDE ARTICLE PRERENDERER & SEO ENGINE
// Dynamically serves complete HTML with Open Graph, Twitter Cards, & JSON-LD
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryInsForge, escapeSql, isValidSlug } = require('./_db.js');
const { renderSafeMarkdown } = require('../src/blog/markdown.js');

let cachedTemplate = null;
function getTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(path.join(__dirname, '../article.html'), 'utf8');
  }
  return cachedTemplate;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let slug = url.searchParams.get('slug');

  // Handle path slug fallback
  if (!slug) {
    const p = url.pathname.replace(/\/+$/, '');
    if (p.startsWith('/blog/')) {
      slug = p.slice('/blog/'.length).trim();
    } else if (p === '/top-10-rappers-in-india') {
      slug = 'top-10-rappers-in-india';
    }
  }

  const template = getTemplate();

  if (!slug || !isValidSlug(slug)) {
    return render404(res, template);
  }

  try {
    const rows = await queryInsForge(`
      SELECT id, slug, title, excerpt, content, featured_image, reading_time, author,
             seo_title, seo_description, tags, is_featured, published_at, updated_at
      FROM blog_posts
      WHERE slug = '${escapeSql(slug.trim())}'
        AND (status = 'published' OR (status = 'scheduled' AND scheduled_at <= NOW()))
      LIMIT 1;
    `);

    if (!rows || rows.length === 0) {
      return render404(res, template);
    }

    const post = rows[0];
    const pageTitle = (post.seo_title || post.title || 'GULLYGANG Journal') + ' | GULLYGANG';
    const pageDesc = post.seo_description || post.excerpt || 'Stories about music, culture, artists and the world around them from GULLYGANG.';
    const canonicalUrl = `https://gullygang.in/blog/${post.slug}`;
    const imgUrl = post.featured_image || 'https://gullygang.in/brand-cover.png';
    const pubDate = post.published_at ? new Date(post.published_at).toISOString() : new Date().toISOString();
    const modDate = post.updated_at ? new Date(post.updated_at).toISOString() : pubDate;
    const authorName = post.author || 'GULLYGANG Editorial';

    // 1. JSON-LD Structured Data (Schema.org BlogPosting)
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": canonicalUrl
      },
      "headline": post.title,
      "description": pageDesc,
      "image": [imgUrl],
      "datePublished": pubDate,
      "dateModified": modDate,
      "author": {
        "@type": "Person",
        "name": authorName
      },
      "publisher": {
        "@type": "Organization",
        "name": "GULLYGANG",
        "logo": {
          "@type": "ImageObject",
          "url": "https://gullygang.in/brand-cover.png"
        }
      }
    };

    const jsonLdScript = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n  </script>`;

    // 2. Metadata Replacements
    let html = template;
    html = html.replace(/<title id="meta-doc-title">[^<]*<\/title>/, `<title id="meta-doc-title">${escapeHtml(pageTitle)}</title>`);
    html = html.replace(/<meta name="title" id="meta-name-title" content="[^"]*" \/>/, `<meta name="title" id="meta-name-title" content="${escapeHtml(pageTitle)}" />`);
    html = html.replace(/<meta name="description" id="meta-name-description" content="[^"]*" \/>/, `<meta name="description" id="meta-name-description" content="${escapeHtml(pageDesc)}" />`);
    html = html.replace(/<link rel="canonical" id="meta-canonical-link" href="[^"]*" \/>/, `<link rel="canonical" id="meta-canonical-link" href="${canonicalUrl}" />`);
    
    html = html.replace(/<meta property="og:title" id="meta-og-title" content="[^"]*" \/>/, `<meta property="og:title" id="meta-og-title" content="${escapeHtml(pageTitle)}" />`);
    html = html.replace(/<meta property="og:description" id="meta-og-description" content="[^"]*" \/>/, `<meta property="og:description" id="meta-og-description" content="${escapeHtml(pageDesc)}" />`);
    html = html.replace(/<meta property="og:url" id="meta-og-url" content="[^"]*" \/>/, `<meta property="og:url" id="meta-og-url" content="${canonicalUrl}" />`);
    html = html.replace(/<meta property="og:image" id="meta-og-image" content="[^"]*" \/>/, `<meta property="og:image" id="meta-og-image" content="${imgUrl}" />`);

    html = html.replace(/<meta name="twitter:title" id="meta-tw-title" content="[^"]*" \/>/, `<meta name="twitter:title" id="meta-tw-title" content="${escapeHtml(pageTitle)}" />`);
    html = html.replace(/<meta name="twitter:description" id="meta-tw-description" content="[^"]*" \/>/, `<meta name="twitter:description" id="meta-tw-description" content="${escapeHtml(pageDesc)}" />`);
    html = html.replace(/<meta name="twitter:url" id="meta-tw-url" content="[^"]*" \/>/, `<meta name="twitter:url" id="meta-tw-url" content="${canonicalUrl}" />`);
    html = html.replace(/<meta name="twitter:image" id="meta-tw-image" content="[^"]*" \/>/, `<meta name="twitter:image" id="meta-tw-image" content="${imgUrl}" />`);

    // Inject JSON-LD before </head>
    html = html.replace('</head>', `  ${jsonLdScript}\n</head>`);

    // 3. Pre-render Initial Dynamic Content into HTML
    const tagsHtml = (Array.isArray(post.tags) && post.tags.length > 0)
      ? post.tags.map(t => `<span class="article-tag-pill">${escapeHtml(t)}</span>`).join('')
      : '<span class="article-tag-pill">EDITORIAL</span>';

    const proseHtml = renderSafeMarkdown(post.content || '');
    const dateFormatted = new Date(pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    html = html.replace('id="article-loading-skeleton"', 'id="article-loading-skeleton" class="hidden"');
    html = html.replace('id="article-dynamic-content" class="hidden"', 'id="article-dynamic-content"');
    html = html.replace('<div id="article-tags-wrap" class="hidden flex items-center gap-2 mb-4"></div>', `<div id="article-tags-wrap" class="flex items-center gap-2 mb-4">${tagsHtml}</div>`);
    html = html.replace('<h1 id="article-headline" class="article-headline"></h1>', `<h1 id="article-headline" class="article-headline">${escapeHtml(post.title)}</h1>`);
    html = html.replace('<p id="article-excerpt" class="article-excerpt hidden"></p>', `<p id="article-excerpt" class="article-excerpt">${escapeHtml(post.excerpt || '')}</p>`);
    html = html.replace('<span id="article-author" class="font-medium text-[var(--blog-text-primary)]"></span>', `<span id="article-author" class="font-medium text-[var(--blog-text-primary)]">${escapeHtml(authorName)}</span>`);
    html = html.replace('<time id="article-date"></time>', `<time id="article-date" datetime="${pubDate}">${dateFormatted}</time>`);
    html = html.replace('<span id="article-reading-time"></span>', `<span id="article-reading-time">${escapeHtml(post.reading_time || '5 min read')}</span>`);
    html = html.replace('<div id="article-content-body" class="article-prose-body"></div>', `<div id="article-content-body" class="article-prose-body">${proseHtml}</div>`);

    // ETag & Cache
    const etag = `"${crypto.createHash('md5').update(html).digest('hex')}"`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.status(200).send(html);
  } catch (err) {
    console.error('[ArticlePrerender] Error:', err);
    return render404(res, template);
  }
};

function render404(res, template) {
  let html = template;
  html = html.replace(/<title id="meta-doc-title">[^<]*<\/title>/, '<title id="meta-doc-title">Story Not Found | GULLYGANG Journal</title>');
  html = html.replace('id="article-loading-skeleton"', 'id="article-loading-skeleton" class="hidden"');
  html = html.replace('id="article-dynamic-content" class="hidden"', 'id="article-dynamic-content" class="hidden"');
  html = html.replace('id="article-404-state" class="hidden text-center py-20"', 'id="article-404-state" class="text-center py-20"');
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.status(404).send(html);
}
