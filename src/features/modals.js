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
    const path = (typeof window !== 'undefined' ? window.location.pathname : '');
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
    
    if (isBlogContext()) {
      document.documentElement.setAttribute('data-blog-theme', normalized);
      document.documentElement.setAttribute('data-theme', normalized === 'day' ? 'light' : 'dark');
      document.documentElement.classList.toggle('blog-day-theme', normalized === 'day');
      document.documentElement.classList.toggle('blog-night-theme', normalized === 'night');
    } else {
      document.documentElement.removeAttribute('data-blog-theme');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.remove('blog-day-theme');
      document.documentElement.classList.remove('blog-night-theme');
    }

    if (persist && isBlogContext()) {
      try {
        localStorage.setItem(STORAGE_KEY, normalized);
      } catch (_) {}
    }

    updateToggleButtons(normalized);
  }

  function updateToggleButtons(theme) {
    const toggleBtns = document.querySelectorAll('#btn-theme-toggle, .blog-theme-toggle-btn, .btn-theme-toggle');
    toggleBtns.forEach((btn) => {
      const sunIcon = btn.querySelector('.theme-icon-sun');
      const moonIcon = btn.querySelector('.theme-icon-moon');
      if (theme === 'day') {
        sunIcon?.classList.add('hidden');
        moonIcon?.classList.remove('hidden');
        btn.setAttribute('aria-label', 'Switch to Night mode');
        btn.setAttribute('title', 'Switch to Night mode');
      } else {
        sunIcon?.classList.remove('hidden');
        moonIcon?.classList.add('hidden');
        btn.setAttribute('aria-label', 'Switch to Day mode');
        btn.setAttribute('title', 'Switch to Day mode');
      }
    });
  }

  function toggle() {
    if (!isBlogContext()) return;
    const current = document.documentElement.getAttribute('data-blog-theme') || getPreferredBlogTheme();
    const newTheme = (current === 'day' || current === 'light') ? 'night' : 'day';
    applyTheme(newTheme, true);
  }

  function init() {
    if (isBlogContext()) {
      const activeTheme = getPreferredBlogTheme();
      applyTheme(activeTheme, false);
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

  if (typeof window !== 'undefined') {
    window.ThemeEngine = engine;
  }

  return engine;
})();

export const LegalPagesEngine = (function () {
  function init() {
    // Delegated click handling for legal links
    if (!window.__gullygang_legal_delegation_attached) {
      window.__gullygang_legal_delegation_attached = true;
      document.addEventListener('click', (e) => {
        const legalBtn = e.target.closest('[data-legal-modal]');
        if (legalBtn) {
          e.preventDefault();
          const targetModal = legalBtn.getAttribute('data-legal-modal');
          openModal(targetModal);
        }

        const closeBtn = e.target.closest('.legal-modal-close, [data-close-modal]');
        if (closeBtn) {
          e.preventDefault();
          closeAllModals();
        }
      });
    }
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('hidden');
    }
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
        const supportBtn = e.target.closest('#btn-support, .btn-support-trigger');
        if (supportBtn) {
          e.preventDefault();
          const modal = document.getElementById('support-modal');
          if (modal) modal.classList.remove('hidden');
        }

        const closeSupport = e.target.closest('#btn-close-support, .support-modal-backdrop');
        if (closeSupport) {
          e.preventDefault();
          const modal = document.getElementById('support-modal');
          if (modal) modal.classList.add('hidden');
        }
      });
    }
  }

  return { init };
})();

export function initFaqAccordion() {
  const items = document.querySelectorAll('.faq-item');
  items.forEach(item => {
    const trigger = item.querySelector('.faq-question-btn');
    if (!trigger || trigger.dataset.bound) return;
    trigger.dataset.bound = 'true';
    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      items.forEach(i => i.classList.remove('is-open'));
      if (!isOpen) item.classList.add('is-open');
    });
  });
}

export function initEditorialExperienceAccordion() {
  const expItems = document.querySelectorAll('.editorial-experience-item');
  expItems.forEach(item => {
    const trigger = item.querySelector('.editorial-experience-btn');
    if (!trigger || trigger.dataset.bound) return;
    trigger.dataset.bound = 'true';
    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      expItems.forEach(i => i.classList.remove('is-open'));
      if (!isOpen) item.classList.add('is-open');
    });
  });
}
