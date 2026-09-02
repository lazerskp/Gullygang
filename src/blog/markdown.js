// ============================================================
// GULLYGANG — SAFE MARKDOWN PARSER & SANITIZER
// ============================================================

export function renderSafeMarkdown(md) {
  if (!md || typeof md !== 'string') return '';

  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((?:javascript|vbscript|data):[^)]*\)/gi, '$1')
    .replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)]+)\)/g, '<img src="$2" alt="$1" class="article-body-img" loading="lazy" decoding="async" onerror="this.style.display=\'none\'" />')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^\s*[-*]\s+(.*$)/gim, '<ul><li>$1</li></ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^\s*\d+\.\s+(.*$)/gim, '<ol><li>$1</li></ol>')
    .replace(/<\/ol>\s*<ol>/g, '');

  return html.split(/\n\s*\n/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^<(h1|h2|h3|pre|blockquote|ul|ol|img)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');
}
