// ============================================================
// GULLYGANG — CLIENT-SIDE APP ROUTER (PERSISTENT AUDIO SHELL)
// ============================================================

export const GullyRouter = (function () {
  const pageCache = new Map();
  let isNavigating = false;
  let onPageReinitCallback = null;

  function getNormalizedPath(urlOrPath) {
    try {
      let path = new URL(urlOrPath, window.location.origin).pathname;
      if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
      return path || '/';
    } catch (_) {
      return urlOrPath || '/';
    }
  }

  async function fetchPage(urlPath) {
    const norm = getNormalizedPath(urlPath);
    if (pageCache.has(norm)) return pageCache.get(norm);

    let targetFile = urlPath;
    if (norm.startsWith('/blog/tag/')) targetFile = '/blog.html';
    else if ((norm.startsWith('/blog/') && norm !== '/blog') || norm === '/top-10-rappers-in-india') targetFile = '/article.html';
    else if (norm.startsWith('/music/artist/')) targetFile = '/artist.html';
    else if (norm.startsWith('/music/album/')) targetFile = '/album.html';
    else if (norm === '/' || norm === '/music') targetFile = '/index.html';
    else if (!urlPath.includes('.')) targetFile = `${urlPath}.html`;

    try {
      const res = await fetch(targetFile, { headers: { 'X-Requested-With': 'GullyRouter' } });
      if (res.ok) {
        const html = await res.text();
        pageCache.set(norm, html);
        return html;
      }
    } catch (_) {}

    const directRes = await fetch(urlPath, { headers: { 'X-Requested-With': 'GullyRouter' } });
    if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
    const html = await directRes.text();
    pageCache.set(norm, html);
    return html;
  }

  async function navigateTo(targetUrl, pushState = true) {
    if (isNavigating) return;

    const targetObj = new URL(targetUrl, window.location.origin);
    const targetNormPath = getNormalizedPath(targetObj.pathname);
    const currentNormPath = getNormalizedPath(window.location.pathname);
    const targetHash = targetObj.hash;

    if (targetNormPath === currentNormPath) {
      if (targetHash) {
        if (pushState) history.pushState({ path: targetNormPath, hash: targetHash }, '', targetObj.pathname + targetObj.search + targetHash);
        document.querySelector(targetHash)?.scrollIntoView({ behavior: 'smooth' });
        return;
      } else if (pushState) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    isNavigating = true;

    try {
      const html = await fetchPage(targetObj.pathname);
      const newDoc = new DOMParser().parseFromString(html, 'text/html');

      if (newDoc.title) document.title = newDoc.title;

      const newMetaDesc = newDoc.querySelector('meta[name="description"]')?.getAttribute('content');
      if (newMetaDesc) document.querySelector('meta[name="description"]')?.setAttribute('content', newMetaDesc);

      const newCanonical = newDoc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      if (newCanonical) document.querySelector('link[rel="canonical"]')?.setAttribute('href', newCanonical);

      const newView = newDoc.getElementById('app-router-view') || newDoc.querySelector('main') || newDoc.body;
      const curView = document.getElementById('app-router-view') || document.querySelector('main');

      if (curView && newView) {
        curView.innerHTML = newView.innerHTML;
        if (newView.hasAttribute('data-page')) curView.setAttribute('data-page', newView.getAttribute('data-page'));
        else curView.removeAttribute('data-page');
        if (newView.className) curView.className = newView.className;
      }

      if (pushState) history.pushState({ path: targetNormPath, hash: targetHash }, '', targetUrl);

      if (targetHash) {
        setTimeout(() => document.querySelector(targetHash)?.scrollIntoView({ behavior: 'smooth' }), 60);
      } else {
        window.scrollTo({ top: 0 });
      }

      if (typeof onPageReinitCallback === 'function') onPageReinitCallback();

      window.dispatchEvent(new CustomEvent('gullygang:navigated', { detail: { path: targetNormPath, hash: targetHash } }));
    } catch (err) {
      window.location.href = targetUrl;
    } finally {
      isNavigating = false;
    }
  }

  function init(reinitHandler) {
    if (reinitHandler) onPageReinitCallback = reinitHandler;

    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || /^(mailto:|tel:|javascript:|#\/)/i.test(rawHref)) return;

      let targetUrl;
      try { targetUrl = new URL(anchor.href, window.location.origin); } catch (_) { return; }
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

      if (targetUrl.pathname.startsWith('/admin')) return;

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
    setPageReinitHandler: (fn) => { onPageReinitCallback = fn; }
  };

  if (typeof window !== 'undefined') window.GullyRouter = routerInstance;
  return routerInstance;
})();
