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
  let currentMode = 'feed'; // 'feed' | 'search' | 'tag'
  let currentQuery = '';
  let currentTag = '';

  async function init() {
    const feed = document.getElementById('blog-stories-feed');
    const featuredContainer = document.getElementById('blog-featured-container');
    if (!feed && !featuredContainer) return;

    // Reset pagination state on fresh init
    currentPage = 1;
    hasMore = false;
    isLoadingMore = false;

    // Attach search input listeners
    setupSearchUI();

    // Attach load more listener
    setupLoadMoreUI();

    // Attach native realtime subscription
    if (!isListening) {
      isListening = true;
      RealtimeManager.on('blog.*', () => {
        const curFeed = document.getElementById('blog-stories-feed');
        if (curFeed) {
          // Re-evaluate feed or search if on the journal page
          loadContentByRoute();
        }
      });
    }

    await loadContentByRoute();
  }

  function setupSearchUI() {
    const searchInput = document.getElementById('blog-search-input');
    const clearBtn = document.getElementById('blog-search-clear');
    if (!searchInput) return;

    // Sync input with URL param if present
    const urlParams = new URLSearchParams(window.location.search);
    const qParam = urlParams.get('q') || '';
    if (qParam && searchInput.value !== qParam) {
      searchInput.value = qParam;
    }
    if (clearBtn) {
      if (searchInput.value.trim().length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    // Debounced input handler (300ms)
    searchInput.oninput = () => {
      const q = searchInput.value.trim();
      if (clearBtn) {
        if (q.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }

      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        if (q.length >= 2) {
          performSearch(q, true);
        } else if (q.length === 0) {
          resetSearch();
        }
      }, 300);
    };

    // Escape key clears search
    searchInput.onkeydown = (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        if (clearBtn) clearBtn.classList.add('hidden');
        resetSearch();
      }
    };

    if (clearBtn) {
      clearBtn.onclick = () => {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        searchInput.focus();
        resetSearch();
      };
    }
  }

  function setupLoadMoreUI() {
    const btnLoadMore = document.getElementById('btn-load-more');
    if (!btnLoadMore) return;

    btnLoadMore.onclick = async () => {
      if (isLoadingMore || !hasMore) return;
      await loadMoreStories();
    };
  }

  async function loadContentByRoute() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    const urlParams = new URLSearchParams(window.location.search);
    const qParam = urlParams.get('q');
    const tagParam = urlParams.get('tag');

    // 1. Tag Archive Path (/blog/tag/:tag)
    if (pathname.startsWith('/blog/tag/')) {
      const rawTag = pathname.slice('/blog/tag/'.length).trim();
      currentMode = 'tag';
      currentTag = rawTag;
      currentQuery = '';
      await loadTagArchive(rawTag);
      return;
    }

    // 2. Query Tag Param (/blog?tag=...)
    if (tagParam) {
      currentMode = 'tag';
      currentTag = tagParam;
      currentQuery = '';
      await loadTagArchive(tagParam);
      return;
    }

    // 3. Search Query Param (/blog?q=...)
    if (qParam && qParam.trim().length >= 2) {
      currentMode = 'search';
      currentQuery = qParam.trim();
      currentTag = '';
      await performSearch(currentQuery, false);
      return;
    }

    // 4. Standard Editorial Feed
    currentMode = 'feed';
    currentQuery = '';
    currentTag = '';
    await loadStandardFeed();
  }

  async function loadStandardFeed() {
    const feed = document.getElementById('blog-stories-feed');
    const featuredContainer = document.getElementById('blog-featured-container');
    const tagHeader = document.getElementById('blog-tag-header');
    const searchStatus = document.getElementById('blog-search-status');
    const sectionTitle = document.getElementById('blog-section-title');
    const loadMoreContainer = document.getElementById('blog-load-more-container');

    if (tagHeader) tagHeader.classList.add('hidden');
    if (searchStatus) searchStatus.textContent = '';
    if (sectionTitle) sectionTitle.textContent = 'RECENT STORIES';
    if (featuredContainer) featuredContainer.classList.remove('hidden');

    // Reset SEO Robots tag to index, follow
    updateRobotsMeta('index, follow');

    try {
      currentPage = 1;
      const res = await fetch(`/api/public?type=blog&page=1&limit=10&format=paginated`);
      if (res.ok) {
        const data = await res.json();
        const posts = data.stories || data;
        hasMore = data.pagination?.has_more || false;

        if (Array.isArray(posts) && posts.length > 0) {
          renderFeatured(posts, featuredContainer);
          renderRecentStories(posts, feed, false);
          updateLoadMoreButton();
          return;
        }
      }
      if (feed) {
        feed.innerHTML = '<div class="py-12 text-center text-[var(--blog-text-muted)] text-sm">No published stories at this time.</div>';
      }
      if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    } catch (err) {
      console.warn('[BlogEngine] Load feed error:', err);
    }
  }

  async function performSearch(query, updateUrl = true) {
    const feed = document.getElementById('blog-stories-feed');
    const featuredContainer = document.getElementById('blog-featured-container');
    const tagHeader = document.getElementById('blog-tag-header');
    const searchStatus = document.getElementById('blog-search-status');
    const sectionTitle = document.getElementById('blog-section-title');
    const loadMoreContainer = document.getElementById('blog-load-more-container');

    if (tagHeader) tagHeader.classList.add('hidden');
    if (featuredContainer) featuredContainer.classList.add('hidden');
    if (sectionTitle) sectionTitle.textContent = 'SEARCH RESULTS';

    // Search query pages use noindex, follow to avoid duplicate content indexing
    updateRobotsMeta('noindex, follow');

    if (searchStatus) {
      searchStatus.textContent = `Searching for "${query}"...`;
    }

    if (updateUrl && window.history) {
      const newUrl = `/blog?q=${encodeURIComponent(query)}`;
      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState({ page: 'blog', query }, '', newUrl);
      }
    }

    if (activeAbortController) {
      activeAbortController.abort();
    }
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

        if (searchStatus) {
          if (total > 0) {
            searchStatus.textContent = `${total} ${total === 1 ? 'story' : 'stories'} found for "${query}"`;
          } else {
            searchStatus.textContent = `No stories found for "${query}". Try another artist, topic, or tag.`;
          }
        }

        // Track search analytics with result count
        Analytics.trackSearch(query, total);

        if (results.length > 0) {
          renderRecentStories(results, feed, false);
          updateLoadMoreButton();
        } else if (feed) {
          feed.innerHTML = `
            <div class="py-16 text-center">
              <p class="text-sm font-semibold text-[var(--blog-text-secondary)] mb-2">No matching stories found</p>
              <p class="text-xs text-[var(--blog-text-muted)]">Check your spelling or explore our recent editorial stories.</p>
            </div>
          `;
          if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[BlogEngine] Search failed:', err);
        if (searchStatus) searchStatus.textContent = 'Unable to complete search at this time.';
      }
    }
  }

  async function loadTagArchive(tagSlug) {
    const feed = document.getElementById('blog-stories-feed');
    const featuredContainer = document.getElementById('blog-featured-container');
    const tagHeader = document.getElementById('blog-tag-header');
    const tagTitle = document.getElementById('blog-tag-title');
    const searchStatus = document.getElementById('blog-search-status');
    const sectionTitle = document.getElementById('blog-section-title');
    const loadMoreContainer = document.getElementById('blog-load-more-container');

    if (featuredContainer) featuredContainer.classList.add('hidden');
    if (searchStatus) searchStatus.textContent = '';
    if (sectionTitle) sectionTitle.textContent = 'TAG STORIES';

    // Format human readable tag headline
    const humanTag = tagSlug.replace(/-/g, ' ').toUpperCase();
    if (tagTitle) tagTitle.textContent = humanTag;
    if (tagHeader) tagHeader.classList.remove('hidden');

    // Track tag view
    Analytics.trackTagView(tagSlug, `/blog/tag/${tagSlug}`);

    // Update document title and metadata for SEO
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
      if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    } catch (err) {
      console.warn('[BlogEngine] Load tag error:', err);
    }
  }

  async function loadMoreStories() {
    const btnLoadMore = document.getElementById('btn-load-more');
    const feed = document.getElementById('blog-stories-feed');
    if (!feed || !btnLoadMore || isLoadingMore) return;

    isLoadingMore = true;
    btnLoadMore.disabled = true;
    const btnText = btnLoadMore.querySelector('.btn-text');
    const btnSpinner = btnLoadMore.querySelector('.btn-spinner');
    if (btnText) btnText.classList.add('hidden');
    if (btnSpinner) btnSpinner.classList.remove('hidden');

    try {
      const nextPage = currentPage + 1;
      let url = '';

      if (currentMode === 'search') {
        url = `/api/public?type=search&q=${encodeURIComponent(currentQuery)}&page=${nextPage}&limit=10`;
      } else if (currentMode === 'tag') {
        url = `/api/public?type=blog&tag=${encodeURIComponent(currentTag)}&page=${nextPage}&limit=10&format=paginated`;
      } else {
        url = `/api/public?type=blog&page=${nextPage}&limit=10&format=paginated`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const newPosts = data.results || data.stories || (Array.isArray(data) ? data : []);
        hasMore = data.pagination?.has_more || false;
        currentPage = nextPage;

        Analytics.trackLoadMore(nextPage, currentQuery, currentTag);

        if (newPosts.length > 0) {
          renderRecentStories(newPosts, feed, true);
        }
      }
    } catch (err) {
      console.warn('[BlogEngine] Failed to load more stories:', err);
    } finally {
      isLoadingMore = false;
      btnLoadMore.disabled = false;
      if (btnText) btnText.classList.remove('hidden');
      if (btnSpinner) btnSpinner.classList.add('hidden');
      updateLoadMoreButton();
    }
  }

  function updateLoadMoreButton() {
    const container = document.getElementById('blog-load-more-container');
    if (!container) return;
    if (hasMore) {
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
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
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.name = 'robots';
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.content = content;
  }

  function renderFeatured(posts, container) {
    if (!container) return;
    const featuredPost = posts.find(p => p.is_featured === true) || posts[0];
    if (!featuredPost) {
      container.innerHTML = '';
      return;
    }

    const url = `/blog/${featuredPost.slug}`;
    const dateStr = featuredPost.published_at ? new Date(featuredPost.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
    
    const tagsHtml = (Array.isArray(featuredPost.tags) && featuredPost.tags.length > 0)
      ? featuredPost.tags.map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="blog-tag-pill" title="View all ${escapeHtml(t)} stories">${escapeHtml(t)}</a>`).join('')
      : '<span class="blog-tag-pill">FEATURED STORY</span>';

    container.innerHTML = `
      <a href="${url}" class="blog-featured-card group">
        <div class="blog-featured-thumb-wrap">
          <img src="${featuredPost.featured_image || 'https://gullygang.in/brand-cover.png'}" 
               alt="${escapeHtml(featuredPost.title)}" 
               class="blog-featured-thumb" 
               loading="eager" 
               fetchpriority="high"
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

  function renderRecentStories(posts, feed, append = false) {
    if (!feed) return;

    let targetPosts = posts;
    if (currentMode === 'feed' && !append && posts.length > 0) {
      const featuredPost = posts.find(p => p.is_featured === true) || posts[0];
      targetPosts = posts.filter(p => p.id !== featuredPost?.id);
    }

    if (targetPosts.length === 0 && !append) {
      feed.innerHTML = '<div class="py-8 text-center text-[var(--blog-text-muted)] text-xs uppercase tracking-wider">No additional recent stories</div>';
      return;
    }

    const html = targetPosts.map((post, idx) => {
      const url = `/blog/${post.slug}`;
      const dateStr = post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Editorial';
      
      const tagsHtml = (Array.isArray(post.tags) && post.tags.length > 0)
        ? `<div class="flex items-center gap-1.5 mb-2">${post.tags.slice(0, 2).map(t => `<a href="/blog/tag/${normalizeTagSlug(t)}" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--blog-accent)] uppercase tracking-wider hover:bg-white/10 transition-colors">${escapeHtml(t)}</a>`).join('')}</div>`
        : '';

      const adHtml = (idx === 0 && !append && currentMode === 'feed') ? `
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

    if (append) {
      feed.insertAdjacentHTML('beforeend', html);
    } else {
      feed.innerHTML = html;
    }
  }

  return {
    init
  };
})();
