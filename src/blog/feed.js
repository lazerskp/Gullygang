// ============================================================
// GULLYGANG — BLOG ENGINE (FEED, SEARCH & TAG ARCHIVES)
// ============================================================

import { escapeHtml, normalizeTagSlug } from '../core/state.js';
import { RealtimeManager } from '../realtime/realtime-manager.js';
import { Analytics } from '../analytics/analytics.js';

export const BlogEngine = (function () {
  let isListening = false;
  let searchDebounceTimer = null;
  let activeAbortController = null;
  let currentPage = 1;
  let hasMore = false;
  let isLoadingMore = false;
  let currentMode = 'feed';
  let currentQuery = '';
  let currentTag = '';

  async function init() {
    const feed = document.getElementById('blog-stories-feed');
    const feat = document.getElementById('blog-featured-container');
    if (!feed && !feat) return;

    currentPage = 1;
    hasMore = false;
    isLoadingMore = false;

    setupSearchUI();
    setupLoadMoreUI();

    if (!isListening) {
      isListening = true;
      RealtimeManager.on('blog.*', () => {
        if (document.getElementById('blog-stories-feed')) loadContentByRoute();
      });
    }

    await loadContentByRoute();
  }

  function setupSearchUI() {
    const input = document.getElementById('blog-search-input');
    const clearBtn = document.getElementById('blog-search-clear');
    if (!input) return;

    const qParam = new URLSearchParams(window.location.search).get('q') || '';
    if (qParam && input.value !== qParam) input.value = qParam;
    clearBtn?.classList.toggle('hidden', !input.value.trim());

    input.oninput = () => {
      const q = input.value.trim();
      clearBtn?.classList.toggle('hidden', !q);
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        if (q.length >= 2) performSearch(q, true);
        else if (q.length === 0) resetSearch();
      }, 300);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        clearBtn?.classList.add('hidden');
        resetSearch();
      }
    };

    if (clearBtn) {
      clearBtn.onclick = () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        input.focus();
        resetSearch();
      };
    }
  }

  function setupLoadMoreUI() {
    const btn = document.getElementById('btn-load-more');
    if (btn) {
      btn.onclick = async () => {
        if (!isLoadingMore && hasMore) await loadMoreStories();
      };
    }
  }

  async function loadContentByRoute() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(window.location.search);
    const qParam = params.get('q');
    const tagParam = params.get('tag');

    if (pathname.startsWith('/blog/tag/')) {
      const tag = pathname.slice('/blog/tag/'.length).trim();
      currentMode = 'tag';
      currentTag = tag;
      currentQuery = '';
      await loadTagArchive(tag);
    } else if (tagParam) {
      currentMode = 'tag';
      currentTag = tagParam;
      currentQuery = '';
      await loadTagArchive(tagParam);
    } else if (qParam && qParam.trim().length >= 2) {
      currentMode = 'search';
      currentQuery = qParam.trim();
      currentTag = '';
      await performSearch(currentQuery, false);
    } else {
      currentMode = 'feed';
      currentQuery = '';
      currentTag = '';
      await loadStandardFeed();
    }
  }

  async function loadStandardFeed() {
    const feed = document.getElementById('blog-stories-feed');
    const feat = document.getElementById('blog-featured-container');
    document.getElementById('blog-tag-header')?.classList.add('hidden');
    const status = document.getElementById('blog-search-status');
    if (status) status.textContent = '';
    const title = document.getElementById('blog-section-title');
    if (title) title.textContent = 'RECENT STORIES';
    feat?.classList.remove('hidden');
    updateRobotsMeta('index, follow');

    try {
      currentPage = 1;
      const res = await fetch('/api/public?type=blog&page=1&limit=10&format=paginated');
      if (res.ok) {
        const data = await res.json();
        const posts = data.stories || data;
        hasMore = data.pagination?.has_more || false;
        if (Array.isArray(posts) && posts.length > 0) {
          renderFeatured(posts, feat);
          renderRecentStories(posts, feed, false);
          updateLoadMoreButton();
          return;
        }
      }
      if (feed) feed.innerHTML = '<div class="py-12 text-center text-[var(--blog-text-muted)] text-sm">No published stories at this time.</div>';
      document.getElementById('blog-load-more-container')?.classList.add('hidden');
    } catch (_) {}
  }

  async function performSearch(query, updateUrl = true) {
    const feed = document.getElementById('blog-stories-feed');
    document.getElementById('blog-tag-header')?.classList.add('hidden');
    document.getElementById('blog-featured-container')?.classList.add('hidden');
    const title = document.getElementById('blog-section-title');
    if (title) title.textContent = 'SEARCH RESULTS';
    updateRobotsMeta('noindex, follow');

    const status = document.getElementById('blog-search-status');
    if (status) status.textContent = `Searching for "${query}"...`;

    if (updateUrl && window.history) {
      const newUrl = `/blog?q=${encodeURIComponent(query)}`;
      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState({ page: 'blog', query }, '', newUrl);
      }
    }

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    try {
      currentPage = 1;
      currentMode = 'search';
      currentQuery = query;

      const res = await fetch(`/api/public?type=search&q=${encodeURIComponent(query)}&page=1&limit=10`, {
        signal: activeAbortController.signal
      });

      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        const total = data.pagination?.total || results.length;
        hasMore = data.pagination?.has_more || false;

        if (status) {
          status.textContent = total > 0 ? `${total} ${total === 1 ? 'story' : 'stories'} found for "${query}"` : `No stories found for "${query}". Try another artist, topic, or tag.`;
        }

        Analytics.trackSearch(query, total);

        if (results.length > 0) {
          renderRecentStories(results, feed, false);
          updateLoadMoreButton();
          return;
        }
      }
      if (feed) {
        feed.innerHTML = `
          <div class="py-16 text-center">
            <p class="text-sm font-semibold text-[var(--blog-text-secondary)] mb-2">No editorial stories matched your search.</p>
            <button type="button" class="btn-subtle text-xs px-3 py-1.5" onclick="document.getElementById('blog-search-input').value='';document.getElementById('blog-search-clear').classList.add('hidden');BlogEngine.resetSearch();">Clear Search</button>
          </div>
        `;
      }
      document.getElementById('blog-load-more-container')?.classList.add('hidden');
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('[BlogEngine] Search notice:', err);
    }
  }

  async function loadTagArchive(tagSlug) {
    const feed = document.getElementById('blog-stories-feed');
    document.getElementById('blog-featured-container')?.classList.add('hidden');
    const status = document.getElementById('blog-search-status');
    if (status) status.textContent = '';
    const sectionTitle = document.getElementById('blog-section-title');
    if (sectionTitle) sectionTitle.textContent = 'TAG STORIES';

    const humanTag = tagSlug.replace(/-/g, ' ').toUpperCase();
    const tagTitle = document.getElementById('blog-tag-title');
    if (tagTitle) tagTitle.textContent = humanTag;
    document.getElementById('blog-tag-header')?.classList.remove('hidden');

    Analytics.trackTagView(tagSlug, `/blog/tag/${tagSlug}`);
    document.title = `${humanTag} Articles | GULLYGANG Journal`;
    updateRobotsMeta('index, follow');

    try {
      currentPage = 1;
      const res = await fetch(`/api/public?type=blog&tag=${encodeURIComponent(tagSlug)}&page=1&limit=10&format=paginated`);
      if (res.ok) {
        const data = await res.json();
        const posts = data.stories || data;
        hasMore = data.pagination?.has_more || false;
        if (Array.isArray(posts) && posts.length > 0) {
          renderRecentStories(posts, feed, false);
          updateLoadMoreButton();
          return;
        }
      }
      if (feed) {
        feed.innerHTML = `
          <div class="py-16 text-center">
            <p class="text-sm font-semibold text-[var(--blog-text-secondary)] mb-2">No stories tagged with "${escapeHtml(humanTag)}"</p>
            <a href="/blog" class="text-xs text-[var(--blog-accent)] font-bold uppercase tracking-wider underline">← Return to All Stories</a>
          </div>
        `;
      }
      document.getElementById('blog-load-more-container')?.classList.add('hidden');
    } catch (_) {}
  }

  async function loadMoreStories() {
    const btn = document.getElementById('btn-load-more');
    const feed = document.getElementById('blog-stories-feed');
    if (!feed || !btn || isLoadingMore) return;

    isLoadingMore = true;
    btn.disabled = true;

    try {
      const nextPage = currentPage + 1;
      let url = currentMode === 'search'
        ? `/api/public?type=search&q=${encodeURIComponent(currentQuery)}&page=${nextPage}&limit=10`
        : (currentMode === 'tag' ? `/api/public?type=blog&tag=${encodeURIComponent(currentTag)}&page=${nextPage}&limit=10&format=paginated` : `/api/public?type=blog&page=${nextPage}&limit=10&format=paginated`);

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const newPosts = data.results || data.stories || (Array.isArray(data) ? data : []);
        hasMore = data.pagination?.has_more || false;
        currentPage = nextPage;
        Analytics.trackLoadMore(nextPage, currentQuery, currentTag);
        if (newPosts.length > 0) renderRecentStories(newPosts, feed, true);
      }
    } catch (_) {
    } finally {
      isLoadingMore = false;
      btn.disabled = false;
      updateLoadMoreButton();
    }
  }

  function updateLoadMoreButton() {
    document.getElementById('blog-load-more-container')?.classList.toggle('hidden', !hasMore);
  }

  function resetSearch() {
    currentMode = 'feed';
    currentQuery = '';
    currentTag = '';
    if (window.history && window.location.search) {
      window.history.replaceState({ page: 'blog' }, '', '/blog');
    }
    loadStandardFeed();
  }

  function updateRobotsMeta(content) {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  function renderFeatured(posts, container) {
    if (!container) return;
    const post = posts.find(p => p.is_featured === true) || posts[0];
    if (!post) { container.innerHTML = ''; return; }

    const dateStr = post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
    const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
      ? post.tags.map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="blog-tag-pill" title="View ${escapeHtml(t)}">${escapeHtml(t)}</a>`).join('')
      : '<span class="blog-tag-pill">FEATURED STORY</span>';

    container.innerHTML = `
      <a href="/blog/${post.slug}" class="blog-featured-card group">
        <div class="blog-featured-thumb-wrap">
          <img src="${post.featured_image || 'https://gullygang.in/brand-cover.png'}" alt="${escapeHtml(post.title)}" class="blog-featured-thumb" loading="eager" onerror="this.src='https://gullygang.in/brand-cover.png'" />
        </div>
        <div class="blog-featured-body">
          <div class="blog-tags-row">${tagsHtml}</div>
          <h2 class="blog-featured-title">${escapeHtml(post.title)}</h2>
          <p class="blog-featured-excerpt">${escapeHtml(post.excerpt || '')}</p>
          <div class="blog-featured-meta">
            <span>${escapeHtml(post.author || 'GULLYGANG Editorial')}</span>
            <span class="article-meta-dot">&bull;</span>
            <span>${dateStr}</span>
            <span class="article-meta-dot">&bull;</span>
            <span>${escapeHtml(post.reading_time || '5 min read')}</span>
          </div>
        </div>
      </a>
    `;
  }

  function renderRecentStories(posts, feed, append = false) {
    if (!feed) return;
    let targetPosts = posts;
    if (currentMode === 'feed' && !append && posts.length > 0) {
      const featPost = posts.find(p => p.is_featured === true) || posts[0];
      targetPosts = posts.filter(p => p.id !== featPost?.id);
    }

    if (targetPosts.length === 0 && !append) {
      feed.innerHTML = '<div class="py-8 text-center text-[var(--blog-text-muted)] text-xs uppercase tracking-wider">No additional recent stories</div>';
      return;
    }

    const html = targetPosts.map((post, idx) => {
      const dateStr = post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
      const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
        ? `<div class="flex items-center gap-1.5 mb-2">${post.tags.slice(0, 2).map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--blog-accent)] uppercase tracking-wider hover:bg-white/10 transition-colors">${escapeHtml(t)}</a>`).join('')}</div>`
        : '';
      const adHtml = (idx === 0 && !append && currentMode === 'feed') ? `
        <div class="blog-direct-ad-section editorial-ad-placement-wrap" id="blog-ad-section-1" data-ad-placement="1" aria-label="Sponsored Advertisement">
          <div class="editorial-ad-slot-box editorial-ad-native-box" id="adsterra-blog-container-1"></div>
        </div>
      ` : '';

      return `
        <article class="blog-story-row">
          <a href="/blog/${post.slug}" class="blog-story-link group">
            <div class="blog-story-thumb-wrap">
              <img src="${post.featured_image || 'https://gullygang.in/brand-cover.png'}" alt="${escapeHtml(post.title)}" class="blog-story-thumb" loading="lazy" onerror="this.src='https://gullygang.in/brand-cover.png'" />
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

    if (append) feed.insertAdjacentHTML('beforeend', html);
    else feed.innerHTML = html;
  }

  return { init, resetSearch };
})();

if (typeof window !== 'undefined') {
  window.BlogEngine = BlogEngine;
}
