// ============================================================
// GULLYGANG — CLIENT-SIDE APP ROUTER (PERSISTENT AUDIO SHELL)
// Enables uninterrupted music streaming across internal page transitions
// ============================================================

export const GullyRouter = (function () {
  const pageCache = new Map();
  let isNavigating = false;
  let onPageReinitCallback = null;

  function getNormalizedPath(urlOrPath) {
    try {
      const u = new URL(urlOrPath, window.location.origin);
      let path = u.pathname;
      if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      return path || '/';
    } catch (e) {
      return urlOrPath || '/';
    }
  }

  async function fetchPage(urlPath) {
    const norm = getNormalizedPath(urlPath);
    if (pageCache.has(norm)) {
      return pageCache.get(norm);
    }
    
    // Dynamic article routes (/blog/:slug and /top-10-rappers-in-india)
    if ((norm.startsWith('/blog/') && norm !== '/blog') || norm === '/top-10-rappers-in-india') {
      try {
        const articleRes = await fetch('/article.html', {
          headers: { 'X-Requested-With': 'GullyRouter' }
        });
        if (articleRes && articleRes.ok) {
          const html = await articleRes.text();
          pageCache.set(norm, html);
          return html;
        }
      } catch (err) {}
    }

    let res;
    try {
      res = await fetch(urlPath, {
        headers: { 'X-Requested-With': 'GullyRouter' }
      });
    } catch (err) {}

    if ((!res || !res.ok) && !urlPath.includes('.') && urlPath !== '/') {
      try {
        const fallbackRes = await fetch(`${urlPath}.html`, {
          headers: { 'X-Requested-With': 'GullyRouter' }
        });
        if (fallbackRes && fallbackRes.ok) {
          res = fallbackRes;
        }
      } catch (err) {}
    } else if ((!res || !res.ok) && urlPath === '/') {
      try {
        const indexRes = await fetch('/index.html', {
          headers: { 'X-Requested-With': 'GullyRouter' }
        });
        if (indexRes && indexRes.ok) {
          res = indexRes;
        }
      } catch (err) {}
    }

    if (!res || !res.ok) {
      throw new Error(`Failed to load page: HTTP ${res ? res.status : 'NetworkError'}`);
    }
    const html = await res.text();
    pageCache.set(norm, html);
    return html;
  }

  async function navigateTo(targetUrl, pushState = true) {
    if (isNavigating) return;

    const targetObj = new URL(targetUrl, window.location.origin);
    const targetNormPath = getNormalizedPath(targetObj.pathname);
    const currentNormPath = getNormalizedPath(window.location.pathname);
    const targetHash = targetObj.hash;

    // Same page anchor navigation
    if (targetNormPath === currentNormPath) {
      if (targetHash) {
        if (pushState) {
          history.pushState({ path: targetNormPath, hash: targetHash }, '', targetObj.pathname + targetObj.search + targetHash);
        }
        const targetEl = document.querySelector(targetHash);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      } else if (pushState) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    isNavigating = true;

    try {
      const html = await fetchPage(targetObj.pathname);
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, 'text/html');

      // 1. Update Document Title
      if (newDoc.title) {
        document.title = newDoc.title;
      }

      // 2. Update Meta Description and Canonical
      const newMetaDesc = newDoc.querySelector('meta[name="description"]');
      const curMetaDesc = document.querySelector('meta[name="description"]');
      if (newMetaDesc && curMetaDesc) {
        curMetaDesc.setAttribute('content', newMetaDesc.getAttribute('content'));
      }
      const newCanonical = newDoc.querySelector('link[rel="canonical"]');
      const curCanonical = document.querySelector('link[rel="canonical"]');
      if (newCanonical && curCanonical) {
        curCanonical.setAttribute('href', newCanonical.getAttribute('href'));
      }

      // 3. Extract and swap #app-router-view without touching persistent audio shell
      const newView = newDoc.getElementById('app-router-view') || newDoc.querySelector('main') || newDoc.body;
      const curView = document.getElementById('app-router-view') || document.querySelector('main');

      if (curView && newView) {
        curView.innerHTML = newView.innerHTML;
        if (newView.hasAttribute('data-page')) {
          curView.setAttribute('data-page', newView.getAttribute('data-page'));
        } else {
          curView.removeAttribute('data-page');
        }
        if (newView.className) {
          curView.className = newView.className;
        }
      }

      // 4. Update History
      if (pushState) {
        history.pushState({ path: targetNormPath, hash: targetHash }, '', targetUrl);
      }

      // 5. Scroll to top or anchor
      if (targetHash) {
        setTimeout(() => {
          const targetEl = document.querySelector(targetHash);
          if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
          else window.scrollTo({ top: 0 });
        }, 60);
      } else {
        window.scrollTo({ top: 0 });
      }

      // 6. Reinitialize Page Interactions
      if (typeof onPageReinitCallback === 'function') {
        onPageReinitCallback();
      }

      // 7. Dispatch custom router event
      window.dispatchEvent(new CustomEvent('gullygang:navigated', {
        detail: { path: targetNormPath, hash: targetHash }
      }));

    } catch (err) {
      console.warn('[GullyRouter] Client navigation fallback to standard browser request:', err);
      window.location.href = targetUrl;
    } finally {
      isNavigating = false;
    }
  }

  function setPageReinitHandler(fn) {
    onPageReinitCallback = fn;
  }

  function init(reinitHandler) {
    if (reinitHandler) {
      setPageReinitHandler(reinitHandler);
    }

    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor) return;

      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref) return;

      if (/^(mailto:|tel:|javascript:|#\/)/i.test(rawHref)) return;

      let targetUrl;
      try {
        targetUrl = new URL(anchor.href, window.location.origin);
      } catch (err) {
        return;
      }

      if (targetUrl.origin !== window.location.origin) return;

      if (targetUrl.pathname === window.location.pathname && targetUrl.hash) {
        const targetEl = document.querySelector(targetUrl.hash);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
          history.pushState({ path: targetUrl.pathname, hash: targetUrl.hash }, '', targetUrl.pathname + targetUrl.search + targetUrl.hash);
          return;
        }
      }

      if (targetUrl.pathname === '/admin' || targetUrl.pathname.startsWith('/admin/')) return;

      e.preventDefault();
      navigateTo(targetUrl.pathname + targetUrl.search + targetUrl.hash, true);
    });

    window.addEventListener('popstate', () => {
      navigateTo(window.location.pathname + window.location.search + window.location.hash, false);
    });
  }

  const routerInstance = {
    init,
    navigateTo,
    navigate: navigateTo,
    setPageReinitHandler
  };

  if (typeof window !== 'undefined') {
    window.GullyRouter = routerInstance;
  }

  return routerInstance;
})();
