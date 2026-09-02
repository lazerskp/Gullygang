// ============================================================
// GULLYGANG — MODALS, THEMES & EDITORIAL ACCORDIONS
// ============================================================

export const ThemeEngine = (function () {
  const STORAGE_KEY = 'gullygang_blog_theme';

  function isBlogContext() {
    if (typeof document === 'undefined') return false;
    const curView = document.getElementById('app-router-view');
    const pageType = curView?.getAttribute('data-page');
    if (pageType === 'blog' || pageType === 'article') return true;
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    return path.startsWith('/blog') || path.startsWith('/top-10-rappers');
  }

  function getPreferredBlogTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'day' || stored === 'night') return stored;
      if (stored === 'light') return 'day';
      if (stored === 'dark') return 'night';
    } catch (_) {}
    return 'night';
  }

  function applyTheme(theme, persist = true) {
    const normalized = (theme === 'day' || theme === 'light') ? 'day' : 'night';
    const isDay = normalized === 'day';

    if (isBlogContext()) {
      document.documentElement.setAttribute('data-blog-theme', normalized);
      document.documentElement.setAttribute('data-theme', isDay ? 'light' : 'dark');
      document.documentElement.classList.toggle('blog-day-theme', isDay);
      document.documentElement.classList.toggle('blog-night-theme', !isDay);
    } else {
      document.documentElement.removeAttribute('data-blog-theme');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.remove('blog-day-theme', 'blog-night-theme');
    }

    if (persist && isBlogContext()) {
      try { localStorage.setItem(STORAGE_KEY, normalized); } catch (_) {}
    }

    document.querySelectorAll('#btn-theme-toggle, .blog-theme-toggle-btn, .btn-theme-toggle').forEach(btn => {
      btn.querySelector('.theme-icon-sun')?.classList.toggle('hidden', isDay);
      btn.querySelector('.theme-icon-moon')?.classList.toggle('hidden', !isDay);
      const title = isDay ? 'Switch to Night mode' : 'Switch to Day mode';
      btn.setAttribute('aria-label', title);
      btn.setAttribute('title', title);
    });
  }

  function toggle() {
    if (!isBlogContext()) return;
    const current = document.documentElement.getAttribute('data-blog-theme') || getPreferredBlogTheme();
    applyTheme(current === 'day' || current === 'light' ? 'night' : 'day', true);
  }

  function init() {
    if (isBlogContext()) {
      applyTheme(getPreferredBlogTheme(), false);
    } else {
      document.documentElement.removeAttribute('data-blog-theme');
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    if (!window.__gullygang_theme_delegation_attached) {
      window.__gullygang_theme_delegation_attached = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('#btn-theme-toggle, .blog-theme-toggle-btn, .btn-theme-toggle');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      });
    }
  }

  const engine = {
    init,
    toggle,
    applyTheme,
    isBlogContext,
    getTheme: () => isBlogContext() ? (document.documentElement.getAttribute('data-blog-theme') || getPreferredBlogTheme()) : 'night'
  };

  if (typeof window !== 'undefined') window.ThemeEngine = engine;
  return engine;
})();

export const LegalPagesEngine = (function () {
  function init() {
    if (!window.__gullygang_legal_delegation_attached) {
      window.__gullygang_legal_delegation_attached = true;
      document.addEventListener('click', (e) => {
        const legalBtn = e.target.closest('[data-legal-modal]');
        if (legalBtn) {
          e.preventDefault();
          openModal(legalBtn.getAttribute('data-legal-modal'));
        }
        if (e.target.closest('.legal-modal-close, [data-close-modal]')) {
          e.preventDefault();
          closeAllModals();
        }
      });
    }
  }

  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  function closeAllModals() {
    document.querySelectorAll('.legal-modal').forEach(m => m.classList.add('hidden'));
  }

  return { init, openModal, closeAllModals };
})();

export const SupportEngine = (function () {
  function init() {
    if (!window.__gullygang_support_delegation_attached) {
      window.__gullygang_support_delegation_attached = true;
      document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-support, .btn-support-trigger')) {
          e.preventDefault();
          document.getElementById('support-modal')?.classList.remove('hidden');
        }
        if (e.target.closest('#btn-close-support, .support-modal-backdrop')) {
          e.preventDefault();
          document.getElementById('support-modal')?.classList.add('hidden');
        }
      });
    }
  }

  return { init };
})();

function setupAccordion(itemSelector, btnSelector) {
  document.querySelectorAll(itemSelector).forEach(item => {
    const trigger = item.querySelector(btnSelector);
    if (!trigger || trigger.dataset.bound) return;
    trigger.dataset.bound = 'true';
    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      document.querySelectorAll(itemSelector).forEach(i => i.classList.remove('is-open'));
      if (!isOpen) item.classList.add('is-open');
    });
  });
}

export const initFaqAccordion = () => setupAccordion('.faq-item', '.faq-question-btn');
export const initEditorialExperienceAccordion = () => setupAccordion('.editorial-experience-item', '.editorial-experience-btn');
