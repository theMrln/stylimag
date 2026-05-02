/**
 * Build HTML for preview header: title, author, abstract in two languages from OJS-shaped metadata.
 * Used by the article preview to show metadata above the rendered body.
 */

import {
  getLocalizedValue,
  formatAuthorsForLocaleAsLines,
} from './ojsMapper.js'

const LOCALE_PRIMARY = 'en_US'
const LOCALE_SECONDARY = 'fr_CA'

function escapeHtml(text) {
  if (text == null || text === '') return ''
  const s = String(text)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Extract just the `<article>...</article>` body from a full pandoc HTML
 * response. The pandoc-export microservice returns a complete document
 * (`<!DOCTYPE html>…<head>…</head><body>…</body></html>`) including a
 * Schema.org / FOAF indexation `<header>` that surfaces a stray
 * `<span property="name">untitled</span>` (because the upstream resolver
 * defaults `title_f` to `"untitled"` when no flat title is set).
 *
 * For the in-app preview we only want the actual article markup, so we
 * pull out the `<article>` content and drop everything else. Lite-engine
 * HTML (no `<article>` wrapper) is returned unchanged.
 *
 * @param {string} html
 * @returns {string}
 */
function extractArticleBody(html) {
  if (!html || typeof html !== 'string') return html ?? ''
  const match = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  return match ? match[1] : html
}

/** Remove placeholder content from export body: "untitled", "Image Notes", etc. */
function stripPreviewPlaceholders(html) {
  if (!html || typeof html !== 'string') return html
  let out = extractArticleBody(html)
  /* untitled: paragraphs, headings, strong, and divs containing only untitled */
  out = out
    .replace(/<p>\s*(\*\*untitled\*\*|untitled)\s*<\/p>/gi, '')
    .replace(/<p>\s*<strong>\s*untitled\s*<\/strong>\s*<\/p>/gi, '')
    .replace(/<h[1-6][^>]*>\s*(\*\*untitled\*\*|untitled)\s*<\/h[1-6]>/gi, '')
    .replace(/<div[^>]*>\s*(\*\*untitled\*\*|untitled)\s*<\/div>/gi, '')
    .replace(/<p[^>]*>\s*<strong[^>]*>\s*untitled\s*<\/strong>\s*<\/p>/gi, '')
  /* Image Notes: standalone list item, paragraph, or heading (often appears as first bullet) */
  out = out
    .replace(/<li[^>]*>\s*Image Notes\s*<\/li>/gi, '')
    .replace(/<p[^>]*>\s*Image Notes\s*<\/p>/gi, '')
    .replace(/<h[1-6][^>]*>\s*Image Notes\s*<\/h[1-6]>/gi, '')
  return out
}


/**
 * Build preview HTML with optional metadata header (title, author, abstract in two languages).
 * Wraps result in <article> when we have header or body. Uses classes compatible with
 * Imaginations-style preview CSS: h1, .author, .abstract
 *
 * @param {object} metadata - OJS-shaped metadata (title, authors, abstract as localized)
 * @param {string} bodyHtml - Existing preview body HTML from export
 * @returns {{ headerHtml: string, hasMetadata: boolean, fullArticleHtml: string }}
 */
export function buildPreviewWithMetadataHeader(metadata, bodyHtml) {
  const headerHtml = buildPreviewMetadataHeader(metadata)
  const hasMetadata = !!(metadata && typeof metadata === 'object')
  const bodyClean = stripPreviewPlaceholders(bodyHtml || '')
  const articleInner =
    hasMetadata && headerHtml
      ? headerHtml + '\n' + bodyClean
      : bodyClean
  const fullArticleHtml = articleInner
    ? `<article>${articleInner}</article>`
    : bodyClean || ''
  return {
    headerHtml,
    hasMetadata,
    fullArticleHtml,
  }
}

/**
 * Build only the metadata header HTML (title, author, abstract in two languages).
 *
 * @param {object} metadata - OJS-shaped metadata
 * @returns {string} HTML fragment (no wrapper)
 */
export function buildPreviewMetadataHeader(metadata) {
  if (!metadata || typeof metadata !== 'object') return ''

  const titleEn = getLocalizedValue(metadata.title, LOCALE_PRIMARY)
  const titleFr = getLocalizedValue(metadata.title, LOCALE_SECONDARY)
  const authorsEnLines = formatAuthorsForLocaleAsLines(metadata.authors, LOCALE_PRIMARY)
  const authorsFrLines = formatAuthorsForLocaleAsLines(metadata.authors, LOCALE_SECONDARY)
  const abstractEn = getLocalizedValue(metadata.abstract, LOCALE_PRIMARY)
  const abstractFr = getLocalizedValue(metadata.abstract, LOCALE_SECONDARY)

  const parts = []

  if (titleEn) {
    parts.push(`<h1 class="preview-title preview-lang-en">${escapeHtml(titleEn)}</h1>`)
  }
  if (titleFr && titleFr !== titleEn) {
    parts.push(`<h1 class="preview-title preview-lang-fr">${escapeHtml(titleFr)}</h1>`)
  } else if (titleFr) {
    parts.push(`<h1 class="preview-title preview-lang-fr">${escapeHtml(titleFr)}</h1>`)
  }

  if (authorsEnLines.length > 0) {
    const authorPs = authorsEnLines
      .map((a) => `<p>${escapeHtml(a)}</p>`)
      .join('')
    parts.push(`<div class="author preview-lang-en">${authorPs}</div>`)
  }
  if (authorsFrLines.length > 0) {
    const authorPs = authorsFrLines
      .map((a) => `<p>${escapeHtml(a)}</p>`)
      .join('')
    parts.push(`<div class="author preview-lang-fr">${authorPs}</div>`)
  }

  /* Wrap both abstracts in a flex container so the EN and FR columns sit
     side by side. The wrapper is always emitted when at least one abstract
     exists; CSS handles the single-column case gracefully.

     Column widths are made proportional to the character count of each
     abstract via inline `flex-grow`. For a column of width W holding
     N characters, rendered height ≈ N / W (in lines), so setting
     flex-grow ∝ N keeps the rendered heights of the two columns
     approximately equal — i.e. the columns line up at top *and* bottom. */
  const abstractParts = []
  if (abstractEn) {
    const grow = Math.max(1, abstractEn.length)
    abstractParts.push(
      `<div class="abstract preview-lang-en" style="flex: ${grow} 1 0"><p>${escapeHtml(abstractEn)}</p></div>`
    )
  }
  if (abstractFr) {
    const grow = Math.max(1, abstractFr.length)
    abstractParts.push(
      `<div class="abstract preview-lang-fr" style="flex: ${grow} 1 0"><p>${escapeHtml(abstractFr)}</p></div>`
    )
  }
  if (abstractParts.length > 0) {
    parts.push(`<div class="abstracts">${abstractParts.join('')}</div>`)
  }

  if (parts.length === 0) return ''
  return '<header class="preview-metadata-header">\n' + parts.join('\n') + '\n</header>'
}
