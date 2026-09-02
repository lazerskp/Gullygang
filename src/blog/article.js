import { escapeHtml, normalizeTagSlug } from '../core/state.js';
import { renderSafeMarkdown } from './markdown.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';
import { Analytics } from '../analytics/analytics.js';

export const ArticleEngine = (function () {
  let currentArticleSlug = null;
  let currentArticleData = null;
  let isListening = false;

  function getSlugFromPath() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/blog/')) {
      return path.slice('/blog/'.length).trim();
    }
    if (path === '/top-10-rappers-in-india') {
      return 'top-10-rappers-in-india';
    }
    return null;
  }

  async function init() {
    const articleRoot = document.getElementById('article-reader-root');
    if (!articleRoot) return;

    const slug = getSlugFromPath();
    if (!slug) {
      show404();
      return;
    }

    currentArticleSlug = slug;

    // Attach native realtime subscription
    if (!isListening) {
      isListening = true;
      RealtimeManager.on('blog.*', (payload) => {
        handleRealtimeUpdate(payload);
      });
    }

    showSkeleton();

    try {
      const res = await fetch(`/api/public?type=article&slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const article = await res.json();
        if (article && article.id) {
          currentArticleData = article;
          renderArticle(article);
          fetchRelatedStories(slug);
          return;
        }
      }
      show404();
    } catch (err) {
      console.warn('[ArticleEngine] Failed to load article:', err);
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

    // 1. Tags
    const tagsWrap = document.getElementById('article-tags-wrap');
    if (tagsWrap) {
      if (Array.isArray(article.tags) && article.tags.length > 0) {
        tagsWrap.innerHTML = article.tags.map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="article-tag-pill" title="View all ${escapeHtml(t)} stories">${escapeHtml(t)}</a>`).join('');
        tagsWrap.classList.remove('hidden');
      } else {
        tagsWrap.innerHTML = '<span class="article-tag-pill">EDITORIAL</span>';
      }
    }

    // 2. Headline & Excerpt
    const headlineEl = document.getElementById('article-headline');
    if (headlineEl) headlineEl.textContent = article.title || 'Untitled Article';

    const excerptEl = document.getElementById('article-excerpt');
    if (excerptEl) {
      if (article.excerpt) {
        excerptEl.textContent = article.excerpt;
        excerptEl.classList.remove('hidden');
      } else {
        excerptEl.classList.add('hidden');
      }
    }

    // 3. Meta (Author + Date + Reading Time)
    const authorEl = document.getElementById('article-author');
    if (authorEl) authorEl.textContent = article.author || 'GULLYGANG Editorial';

    const dateEl = document.getElementById('article-date');
    if (dateEl) {
      const d = article.published_at ? new Date(article.published_at) : new Date(article.created_at);
      dateEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      dateEl.setAttribute('datetime', d.toISOString());
    }

    const rtEl = document.getElementById('article-reading-time');
    if (rtEl) rtEl.textContent = article.reading_time || '5 min read';

    // 4. Featured Image
    const imgWrap = document.getElementById('article-featured-image-wrap');
    const imgEl = document.getElementById('article-featured-image');
    if (imgWrap && imgEl) {
      if (article.featured_image) {
        imgEl.src = article.featured_image;
        imgEl.alt = article.title || 'Article Cover';
        imgWrap.classList.remove('hidden');
      } else {
        imgWrap.classList.add('hidden');
      }
    }

    // 5. Article Content Body
    const bodyEl = document.getElementById('article-content-body');
    if (bodyEl) {
      bodyEl.innerHTML = renderSafeMarkdown(article.content || '');
    }

    // 6. Dynamic SEO Tags
    updateDynamicSEO(article);

    // Track Article View
    Analytics.trackArticleView(article.id, window.location.pathname, article.title);
  }

  function updateDynamicSEO(article) {
    const pageTitle = (article.seo_title || article.title || 'GULLYGANG Journal') + ' | GULLYGANG';
    document.title = pageTitle;

    const desc = article.seo_description || article.excerpt || 'Stories about music, culture, artists and the world around them from GULLYGANG.';
    const canonicalUrl = `https://gullygang.in/blog/${article.slug}`;
    const imgUrl = article.featured_image || 'https://gullygang.in/brand-cover.png';

    const setMeta = (idOrSelector, attr, val) => {
      const el = document.querySelector(idOrSelector);
      if (el) el.setAttribute(attr, val);
    };

    setMeta('meta[name="title"]', 'content', pageTitle);
    setMeta('meta[name="description"]', 'content', desc);
    setMeta('link[rel="canonical"]', 'href', canonicalUrl);

    setMeta('meta[property="og:title"]', 'content', pageTitle);
    setMeta('meta[property="og:description"]', 'content', desc);
    setMeta('meta[property="og:url"]', 'content', canonicalUrl);
    setMeta('meta[property="og:image"]', 'content', imgUrl);

    setMeta('meta[name="twitter:title"]', 'content', pageTitle);
    setMeta('meta[name="twitter:description"]', 'content', desc);
    setMeta('meta[name="twitter:url"]', 'content', canonicalUrl);
    setMeta('meta[name="twitter:image"]', 'content', imgUrl);
  }

  async function fetchRelatedStories(currentSlug) {
    const feed = document.getElementById('article-related-feed');
    if (!feed) return;

    try {
      const res = await fetch(`/api/public?type=related_articles&slug=${encodeURIComponent(currentSlug)}&limit=3`);
      if (res.ok) {
        const stories = await res.json();
        if (Array.isArray(stories) && stories.length > 0) {
          feed.innerHTML = stories.map((s, idx) => {
            const url = `/blog/${s.slug}`;
            const dateStr = s.published_at ? new Date(s.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
            return `
              <a href="${url}" class="article-related-card group" data-related-id="${s.id}" data-related-pos="${idx + 1}">
                <div class="article-related-thumb-wrap">
                  <img src="${s.featured_image || 'https://gullygang.in/brand-cover.png'}" alt="${escapeHtml(s.title)}" class="article-related-thumb" loading="lazy" decoding="async" onerror="this.src='https://gullygang.in/brand-cover.png'" />
                </div>
                <h3 class="article-related-card-title">${escapeHtml(s.title)}</h3>
                <div class="article-related-card-meta">
                  <span>${dateStr}</span> &bull; <span>${escapeHtml(s.reading_time || '4 min read')}</span>
                </div>
              </a>
            `;
          }).join('');

          // Track clicks on related articles
          feed.querySelectorAll('.article-related-card').forEach(card => {
            card.onclick = () => {
              const targetId = card.getAttribute('data-related-id');
              const pos = card.getAttribute('data-related-pos');
              Analytics.trackRelatedArticleClick(currentArticleData?.id, targetId, pos);
            };
          });

          document.getElementById('article-related-section')?.classList.remove('hidden');
          return;
        }
      }
      document.getElementById('article-related-section')?.classList.add('hidden');
    } catch (e) {
      document.getElementById('article-related-section')?.classList.add('hidden');
    }
  }

  function handleRealtimeUpdate(eventData) {
    const currentSlug = getSlugFromPath();
    if (!currentSlug) return;

    if (eventData && eventData.entityId) {
      if (currentArticleData && currentArticleData.id === eventData.entityId) {
        if (eventData.type === 'blog.deleted' || eventData.status === 'draft') {
          show404();
        } else {
          init();
        }
        return;
      }
    }

    fetchRelatedStories(currentSlug);
  }

  return {
    init,
    handleRealtimeUpdate
  };
})();
