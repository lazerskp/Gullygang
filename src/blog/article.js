// ============================================================
// GULLYGANG — ARTICLE READER ENGINE
// ============================================================

import { escapeHtml, normalizeTagSlug } from '../core/state.js';
import { renderSafeMarkdown } from './markdown.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';
import { Analytics } from '../analytics/analytics.js';

export const ArticleEngine = (function () {
  let currentArticleSlug = null;
  let isListening = false;

  function getSlugFromPath() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/blog/')) return path.slice('/blog/'.length).trim();
    if (path === '/top-10-rappers-in-india') return 'top-10-rappers-in-india';
    return null;
  }

  async function init() {
    const articleRoot = document.getElementById('article-reader-root');
    if (!articleRoot) return;

    const slug = getSlugFromPath();
    if (!slug) { show404(); return; }

    currentArticleSlug = slug;

    if (!isListening) {
      isListening = true;
      RealtimeManager.on('blog.*', (payload) => {
        if (payload?.record?.slug === currentArticleSlug || payload?.old_record?.slug === currentArticleSlug) init();
      });
    }

    showSkeleton();

    try {
      const res = await fetch(`/api/public?type=article&slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const article = await res.json();
        if (article?.id) {
          renderArticle(article);
          fetchRelatedStories(slug);
          return;
        }
      }
      show404();
    } catch (_) {
      show404();
    }
  }

  function showSkeleton() {
    document.getElementById('article-loading-skeleton')?.classList.remove('hidden');
    document.getElementById('article-dynamic-content')?.classList.add('hidden');
    document.getElementById('article-404-state')?.classList.add('hidden');
  }

  function show404() {
    document.getElementById('article-loading-skeleton')?.classList.add('hidden');
    document.getElementById('article-dynamic-content')?.classList.add('hidden');
    document.getElementById('article-404-state')?.classList.remove('hidden');
    document.title = 'Story Not Found | GULLYGANG Journal';
  }

  function renderArticle(article) {
    document.getElementById('article-loading-skeleton')?.classList.add('hidden');
    document.getElementById('article-404-state')?.classList.add('hidden');
    document.getElementById('article-dynamic-content')?.classList.remove('hidden');

    const tagsWrap = document.getElementById('article-tags-wrap');
    if (tagsWrap) {
      tagsWrap.innerHTML = Array.isArray(article.tags) && article.tags.length > 0
        ? article.tags.map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="article-tag-pill" title="View ${escapeHtml(t)}">${escapeHtml(t)}</a>`).join('')
        : '<span class="article-tag-pill">EDITORIAL</span>';
    }

    const hl = document.getElementById('article-headline');
    if (hl) hl.textContent = article.title || 'Untitled';

    const exc = document.getElementById('article-excerpt');
    if (exc) {
      exc.textContent = article.excerpt || '';
      exc.classList.toggle('hidden', !article.excerpt);
    }

    const auth = document.getElementById('article-author');
    if (auth) auth.textContent = article.author || 'GULLYGANG Editorial';

    const dt = document.getElementById('article-date');
    if (dt) {
      const d = article.published_at ? new Date(article.published_at) : new Date(article.created_at);
      dt.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      dt.setAttribute('datetime', d.toISOString());
    }

    const rt = document.getElementById('article-reading-time');
    if (rt) rt.textContent = article.reading_time || '5 min read';

    const imgWrap = document.getElementById('article-featured-image-wrap');
    const img = document.getElementById('article-featured-image');
    if (imgWrap && img) {
      if (article.featured_image) {
        img.src = article.featured_image;
        img.alt = article.title || 'Article Cover';
        imgWrap.classList.remove('hidden');
      } else {
        imgWrap.classList.add('hidden');
      }
    }

    const body = document.getElementById('article-content-body');
    if (body) body.innerHTML = renderSafeMarkdown(article.content || '');

    updateDynamicSEO(article);
    Analytics.trackArticleView(article.id, window.location.pathname, article.title);
  }

  function updateDynamicSEO(article) {
    const pageTitle = (article.seo_title || article.title || 'GULLYGANG Journal') + ' | GULLYGANG';
    document.title = pageTitle;
    const desc = article.seo_description || article.excerpt || 'Stories about music, culture, and artists from GULLYGANG.';
    const canonicalUrl = `https://gullygang.in/blog/${article.slug}`;
    const imgUrl = article.featured_image || 'https://gullygang.in/brand-cover.png';

    const setMeta = (sel, attr, val) => document.querySelector(sel)?.setAttribute(attr, val);
    setMeta('meta[name="title"]', 'content', pageTitle);
    setMeta('meta[name="description"]', 'content', desc);
    setMeta('link[rel="canonical"]', 'href', canonicalUrl);
    setMeta('meta[property="og:title"]', 'content', pageTitle);
    setMeta('meta[property="og:description"]', 'content', desc);
    setMeta('meta[property="og:url"]', 'content', canonicalUrl);
    setMeta('meta[property="og:image"]', 'content', imgUrl);
    setMeta('meta[name="twitter:title"]', 'content', pageTitle);
    setMeta('meta[name="twitter:description"]', 'content', desc);
  }

  async function fetchRelatedStories(currentSlug) {
    const feed = document.getElementById('article-related-feed');
    if (!feed) return;

    try {
      const res = await fetch('/api/public?type=blog&limit=3');
      if (res.ok) {
        const posts = await res.json();
        const related = (Array.isArray(posts) ? posts : (posts.stories || [])).filter(p => p.slug !== currentSlug).slice(0, 2);
        if (related.length > 0) {
          feed.innerHTML = related.map((p, idx) => `
            <a href="/blog/${p.slug}" class="article-related-card group" data-article-id="${p.id}" data-position="${idx + 1}">
              <div class="article-related-thumb-wrap">
                <img src="${p.featured_image || 'https://gullygang.in/brand-cover.png'}" alt="${escapeHtml(p.title)}" class="article-related-thumb" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
              </div>
              <div class="article-related-body">
                <h4 class="article-related-title">${escapeHtml(p.title)}</h4>
                <p class="article-related-excerpt">${escapeHtml(p.excerpt || '')}</p>
              </div>
            </a>
          `).join('');

          feed.querySelectorAll('.article-related-card').forEach(card => {
            card.onclick = () => {
              Analytics.trackRelatedArticleClick(currentArticleSlug, card.getAttribute('data-article-id'), card.getAttribute('data-position'));
            };
          });
          document.getElementById('article-related-section')?.classList.remove('hidden');
          return;
        }
      }
      document.getElementById('article-related-section')?.classList.add('hidden');
    } catch (_) {}
  }

  return { init };
})();

if (typeof window !== 'undefined') window.ArticleEngine = ArticleEngine;
