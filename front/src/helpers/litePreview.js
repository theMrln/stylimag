/**
 * Client-only "lite" preview: Markdown -> sanitized HTML in the browser.
 *
 * This is an approximation path meant to run without the Stylo export
 * microservice. It deliberately does not attempt full Pandoc fidelity:
 *
 *   - No citeproc / BibTeX resolution: `[@key]` stays literal.
 *   - No YAML-driven Pandoc templates / filters.
 *   - Footnotes rendered via markdown-it-footnote (a GitHub-style subset).
 *   - GFM tables, fenced code, autolinks handled by markdown-it defaults.
 *
 * Call sites wrap the returned HTML in the same preview shell used for the
 * export-based path (`CollaborativeTextEditor.jsx` + `previewMetadata.js`),
 * so existing CSS keeps working unchanged.
 */

import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import markdownItFootnote from 'markdown-it-footnote'

/** Leading YAML front matter `---\n...\n---` that Stylo stores separately. */
const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

/** Singleton: markdown-it is cheap to reuse and has no per-doc state. */
let markdownRenderer = null
function getRenderer() {
  if (markdownRenderer) return markdownRenderer
  markdownRenderer = new MarkdownIt({
    html: false, // raw HTML is stripped anyway by DOMPurify; don't parse it
    linkify: true,
    typographer: false,
    breaks: false,
  }).use(markdownItFootnote)
  return markdownRenderer
}

/**
 * Best-effort strip of a YAML front matter block. Stylo keeps YAML in a
 * separate field, but user-pasted markdown sometimes carries one.
 *
 * @param {string} md
 * @returns {string}
 */
function stripFrontMatter(md) {
  if (typeof md !== 'string' || md.length === 0) return md ?? ''
  return md.replace(FRONT_MATTER_RE, '')
}

/**
 * Render Markdown to a sanitized HTML string suitable for
 * `dangerouslySetInnerHTML`.
 *
 * @param {{ md_content?: string }} input
 * @returns {string}
 */
export function renderLitePreviewHtml({ md_content } = {}) {
  if (typeof md_content !== 'string' || md_content.length === 0) return ''
  const source = stripFrontMatter(md_content)
  const rawHtml = getRenderer().render(source)
  // ADD_ATTR: preview CSS keys off class names; keep a permissive but safe set.
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

export const __testables__ = { stripFrontMatter }
