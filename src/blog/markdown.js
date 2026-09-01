// ============================================================
// GULLYGANG — SAFE MARKDOWN PARSER & SANITIZER
// Strict XSS elimination, protocol validation, and prose formatting
// ============================================================

export function renderSafeMarkdown(md) {
  if (!md || typeof md !== 'string') return '';

  // 1. Strict HTML tag escaping to eliminate raw XSS injections
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Fenced Code Blocks (```code```)
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // 3. Inline Code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 4. Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 5. Blockquotes (> quote)
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // 6. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 7. Disarm dangerous protocol links (javascript:, data:, vbscript:)
  html = html.replace(/\[([^\]]+)\]\((?:javascript|vbscript|data):[^)]*\)/gi, '$1');

  // 8. Images: ![alt](url) - strictly validate URL protocol (http, https, relative)
  html = html.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)]+)\)/g, '<img src="$2" alt="$1" class="article-body-img" loading="lazy" decoding="async" onerror="this.style.display=\'none\'" />');

  // 9. Links: [text](url) - strictly validate URL protocol and add rel="noopener noreferrer"
  html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 9. Unordered Lists (- item or * item)
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<ul><li>$1</li></ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // 10. Ordered Lists (1. item)
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<ol><li>$1</li></ol>');
  html = html.replace(/<\/ol>\s*<ol>/g, '');

  // 11. Paragraphs
  const paragraphs = html.split(/\n\s*\n/);
  return paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (/^<(h1|h2|h3|pre|blockquote|ul|ol|img)/.test(trimmed)) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');
}
