// ============================================================
// GULLYGANG — EDITORIAL BLOG FEED ENGINE
// Hydrates /blog feed & featured hero with in-place realtime updates
// ============================================================

import { escapeHtml } from '../core/state.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';

export const BlogEngine = (function () {
  let isListening = false;

  async function init() {
    const feed = document.getElementById('blog-stories-feed');
    const featuredContainer = document.getElementById('blog-featured-container');
    if (!feed && !featuredContainer) return;

    // Attach native realtime subscription
    if (!isListening) {
      isListening = true;
      RealtimeManager.on('blog.*', () => {
        const curFeed = document.getElementById('blog-stories-feed');
        if (curFeed) init();
      });
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tagParam = urlParams.get('tag');
      const fetchUrl = tagParam 
        ? `/api/public?type=blog&tag=${encodeURIComponent(tagParam)}`
        : '/api/public?type=blog';

      const res = await fetch(fetchUrl);
      if (res.ok) {
        const posts = await res.json();
        if (Array.isArray(posts) && posts.length > 0) {
          renderFeatured(posts, featuredContainer);
          renderRecentStories(posts, feed);
          return;
        }
      }
      if (feed) {
        feed.innerHTML = '<div class="py-12 text-center text-[var(--blog-text-muted)] text-sm">No published stories at this time.</div>';
      }
    } catch (err) {
      console.warn('[BlogEngine] Failed to load stories:', err);
    }
  }

  function renderFeatured(posts, container) {
    if (!container) return;

    // Prioritize article with is_featured = true, otherwise promote newest post
    const featuredPost = posts.find(p => p.is_featured === true) || posts[0];
    if (!featuredPost) {
      container.innerHTML = '';
      return;
    }

    const url = `/blog/${featuredPost.slug}`;
    const dateStr = featuredPost.published_at ? new Date(featuredPost.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
    const tagsHtml = (Array.isArray(featuredPost.tags) && featuredPost.tags.length > 0)
      ? featuredPost.tags.map(t => `<span class="blog-tag-pill">${escapeHtml(t)}</span>`).join('')
      : '<span class="blog-tag-pill">FEATURED STORY</span>';

    container.innerHTML = `
      <a href="${url}" class="blog-featured-card group">
        <div class="blog-featured-thumb-wrap">
          <img src="${featuredPost.featured_image || 'https://gullygang.in/brand-cover.png'}" 
               alt="${escapeHtml(featuredPost.title)}" 
               class="blog-featured-thumb" 
               loading="eager" 
               decoding="async" 
               onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <div class="blog-featured-body">
          <div class="blog-tags-row">${tagsHtml}</div>
          <h2 class="blog-featured-title">${escapeHtml(featuredPost.title)}</h2>
          <p class="blog-featured-excerpt">${escapeHtml(featuredPost.excerpt || '')}</p>
          <div class="blog-featured-meta">
            <span>${escapeHtml(featuredPost.author || 'GULLYGANG Editorial')}</span>
            <span class="article-meta-dot">&bull;</span>
            <span>${dateStr}</span>
            <span class="article-meta-dot">&bull;</span>
            <span>${escapeHtml(featuredPost.reading_time || '5 min read')}</span>
          </div>
        </div>
      </a>
    `;
  }

  function renderRecentStories(posts, feed) {
    if (!feed) return;

    const featuredPost = posts.find(p => p.is_featured === true) || posts[0];
    const recentStories = posts.filter(p => p.id !== featuredPost?.id);

    if (recentStories.length === 0) {
      feed.innerHTML = '<div class="py-8 text-center text-[var(--blog-text-muted)] text-xs uppercase tracking-wider">No additional recent stories</div>';
      return;
    }

    feed.innerHTML = recentStories.map((post, idx) => {
      const url = `/blog/${post.slug}`;
      const dateStr = post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
      
      const tagsHtml = (Array.isArray(post.tags) && post.tags.length > 0)
        ? `<div class="flex items-center gap-1.5 mb-2">${post.tags.slice(0, 2).map(t => `<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--blog-accent)] uppercase tracking-wider">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

      const adHtml = (idx === 0) ? `
        <div class="blog-direct-ad-section editorial-ad-placement-wrap" id="blog-ad-section-1" data-ad-placement="1" aria-label="Sponsored Advertisement">
          <div class="editorial-ad-slot-box editorial-ad-native-box" id="adsterra-blog-container-1"></div>
        </div>
      ` : '';

      return `
        <article class="blog-story-row">
          <a href="${url}" class="blog-story-link group">
            <div class="blog-story-thumb-wrap">
              <img src="${post.featured_image || 'https://gullygang.in/brand-cover.png'}" 
                   alt="${escapeHtml(post.title)}" 
                   class="blog-story-thumb" 
                   loading="lazy" 
                   decoding="async" 
                   onerror="this.src='https://gullygang.in/brand-cover.png'" />
            </div>
            <div class="blog-story-body">
              ${tagsHtml}
              <div class="blog-story-meta">
                <span>${dateStr}</span>
                <span class="blog-meta-dot">&bull;</span>
                <span>${escapeHtml(post.reading_time || '4 min read')}</span>
              </div>
              <h2 class="blog-story-title">${escapeHtml(post.title)}</h2>
              <p class="blog-story-excerpt">${escapeHtml(post.excerpt || '')}</p>
            </div>
          </a>
        </article>
        <div class="blog-hairline-sep" aria-hidden="true"></div>
        ${adHtml}
      `;
    }).join('');

    if (window.AdsterraEngine && typeof window.AdsterraEngine.init === 'function') {
      window.AdsterraEngine.init();
    }
  }

  return { init };
})();
