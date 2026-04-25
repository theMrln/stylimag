/**
 * OJS to Stylo Metadata Mapper
 *
 * Stores metadata in OJS-native shape (localized title, authors, abstract)
 * for export YAML and form editing. No conversion to a separate "Stylo" format.
 */

/**
 * Ensure a value is a localized object { en_US: "...", fr_CA: "..." }
 * @param {object|string} value - OJS value (already object or string)
 * @param {string} [locale] - Preferred locale if converting from string
 * @returns {object}
 */
function toLocalizedObject(value, locale = 'en_US') {
  if (value == null) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return { [locale]: String(value) }
}

/**
 * Map OJS locale to short locale for YAML (e.g. en_US -> en)
 * @param {string} ojsLocale
 * @returns {string}
 */
function mapLocale(ojsLocale) {
  if (!ojsLocale) return 'en'
  return ojsLocale.split('_')[0].toLowerCase()
}

/**
 * Build OJS-native author: { givenName: { en_US: "..." }, familyName: { en_US: "..." } }
 * @param {object} ojsAuthor - OJS author from API
 * @returns {object|null}
 */
function mapAuthorToOjsShape(ojsAuthor) {
  if (!ojsAuthor) return null
  const givenName = ojsAuthor.givenName ?? ojsAuthor.firstName
  const familyName = ojsAuthor.familyName ?? ojsAuthor.lastName
  if (!givenName && !familyName) return null
  return {
    givenName: toLocalizedObject(givenName),
    familyName: toLocalizedObject(familyName),
  }
}

/**
 * Map OJS authors array to OJS-native shape (localized givenName/familyName)
 * @param {object[]} ojsAuthors
 * @returns {object[]}
 */
function mapAuthorsToOjsShape(ojsAuthors) {
  if (!ojsAuthors || !Array.isArray(ojsAuthors)) return []
  return ojsAuthors
    .map(mapAuthorToOjsShape)
    .filter(Boolean)
}

/**
 * Build issue string from issue metadata (e.g. "15-1, 2024")
 * @param {object} issueMetadata - OJS issue object
 * @returns {string}
 */
function formatIssueString(issueMetadata) {
  if (!issueMetadata) return ''
  const vol = issueMetadata.volume != null ? String(issueMetadata.volume) : ''
  const num = issueMetadata.number != null ? String(issueMetadata.number) : ''
  const year = issueMetadata.year != null ? String(issueMetadata.year) : ''
  const volNum = [vol, num].filter(Boolean).join('-')
  return volNum && year ? `${volNum}, ${year}` : volNum || year || ''
}

/**
 * Derive short_author from first author (e.g. "hambuch" from "Hambuch")
 * @param {object[]} authors - OJS-shaped authors
 * @returns {string}
 */
function deriveShortAuthor(authors) {
  if (!authors?.length) return ''
  const first = authors[0]
  const familyName = first.familyName
  if (!familyName || typeof familyName !== 'object') return ''
  const value = familyName.en_US ?? familyName.en ?? familyName.fr_CA ?? familyName.fr ?? Object.values(familyName)[0]
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '') : ''
}

/**
 * Map OJS submission/publication to OJS-native metadata (no Stylo flattening).
 * Used when creating articles from OJS import. Export YAML matches this shape.
 *
 * @param {object} submission - OJS submission object (may include publications[0])
 * @param {object} issueMetadata - OJS issue metadata (optional)
 * @param {string} [instance] - OJS instance name (staging/production); stored in metadata.ojs._instance for push-back
 * @returns {object} Metadata in OJS shape: locale, title (localized), authors (localized), abstract (localized), issue, start_page, short_title, short_author
 */
function mapOjsToOjsMetadata(submission, issueMetadata = null, instance = null) {
  const publication = submission?.publications?.[0]
  const locale = publication?.locale || submission?.locale || 'en_US'
  const localeShort = mapLocale(locale)

  const title = publication?.fullTitle ?? publication?.title ?? submission?.fullTitle ?? submission?.title ?? submission?.name
  const titleObj = toLocalizedObject(title, locale)

  const authors = mapAuthorsToOjsShape(publication?.authors ?? submission?.authors)

  const abstract = publication?.abstract ?? submission?.abstract
  const abstractObj = toLocalizedObject(abstract, locale)

  let startPage = 1
  const pages = publication?.pages ?? submission?.pages
  if (typeof pages === 'string' && pages.includes('-')) {
    const start = parseInt(pages.split('-')[0], 10)
    if (!Number.isNaN(start)) startPage = start
  } else if (typeof pages === 'number') {
    startPage = pages
  }

  const issueStr = issueMetadata ? formatIssueString(issueMetadata) : ''
  const firstTitle = typeof titleObj === 'object' ? (titleObj.en_US ?? titleObj.fr_CA ?? Object.values(titleObj)[0]) : titleObj
  const shortTitle = typeof firstTitle === 'string' ? firstTitle : ''
  const shortAuthor = deriveShortAuthor(authors)

  const metadata = {
    locale: localeShort,
    title: Object.keys(titleObj).length ? titleObj : { [locale]: 'Untitled' },
    authors,
    abstract: Object.keys(abstractObj).length ? abstractObj : undefined,
    issue: issueStr || undefined,
    start_page: startPage,
    short_title: shortTitle || undefined,
    short_author: shortAuthor || undefined,
  }

  // Keep original OJS submission for re-import / push-back. Record the
  // instance so we know which OJS API to talk to when pushing edits back.
  metadata.ojs = instance
    ? { ...submission, _instance: instance }
    : submission

  return metadata
}

/**
 * Extract a single string title for Article.title (first available locale)
 * @param {object} submission - OJS submission object
 * @returns {string}
 */
function extractArticleTitle(submission) {
  const publication = submission?.publications?.[0]
  const title = publication?.fullTitle ?? publication?.title ?? submission?.fullTitle ?? submission?.title ?? submission?.name
  if (typeof title === 'string') return title.trim() || 'Untitled'
  if (title && typeof title === 'object') {
    const v = title.en_US ?? title.en ?? title.fr_CA ?? title.fr ?? Object.values(title)[0]
    return (v && String(v).trim()) || 'Untitled'
  }
  return 'Untitled'
}

/**
 * Extract localized text from OJS localized object (for backward compat / display)
 * @param {object|string} obj
 * @param {string} fallback
 * @returns {string}
 */
function extractLocalizedText(obj, fallback = '') {
  if (!obj) return fallback
  if (typeof obj === 'string') return obj
  return obj.en_US ?? obj.en ?? obj.fr_CA ?? obj.fr ?? Object.values(obj).find((v) => typeof v === 'string' && v.trim()) ?? fallback
}

/**
 * Map OJS issue metadata to corpus (journal) metadata shape.
 * Fills type, @version, name, issue (title, identifier, number) for the journal schema.
 * Keeps ojs reference for re-import. No legacy Stylo structures.
 *
 * @param {object} issueMetadata - OJS issue from GET /issues/:id
 * @param {string} [instance] - OJS instance name (staging/production); stored in metadata.ojs._instance for push-back
 * @returns {object} Metadata for corpus type "journal"
 */
function mapOjsIssueToCorpusMetadata(issueMetadata, instance = null) {
  if (!issueMetadata || typeof issueMetadata !== 'object') {
    return {
      type: 'journal',
      '@version': '1.0',
      name: '',
      issue: {},
    }
  }
  const issueTitle = extractLocalizedText(issueMetadata.title) || extractLocalizedText(issueMetadata.name)
  const issueNumber = formatIssueString(issueMetadata)
  const identifier = issueMetadata.id != null ? String(issueMetadata.id) : (issueMetadata.doi || issueMetadata.url || '')
  return {
    type: 'journal',
    '@version': '1.0',
    name: issueTitle || 'Untitled issue',
    issue: {
      ...(issueTitle && { title: issueTitle }),
      ...(identifier && { identifier }),
      ...(issueNumber && { number: issueNumber }),
    },
    ojs: instance ? { ...issueMetadata, _instance: instance } : issueMetadata,
  }
}

/**
 * Build a partial OJS publication update body from side-panel-shaped metadata.
 * Only fields that map cleanly to a publication PUT are included; fields like
 * `issue`, `short_title`, `short_author` have no direct OJS counterpart and
 * are ignored here.
 *
 * @param {object} metadata - OJS-shaped metadata as edited in the side panel
 * @returns {object} body for PUT /submissions/:s/publications/:p
 */
function mapMetadataToPublicationUpdate(metadata) {
  if (!metadata || typeof metadata !== 'object') return {}
  const body = {}
  if (metadata.title && typeof metadata.title === 'object') {
    body.title = metadata.title
  }
  if (metadata.abstract && typeof metadata.abstract === 'object') {
    body.abstract = metadata.abstract
  }
  if (metadata.start_page != null) {
    body.pages = String(metadata.start_page)
  }
  return body
}

module.exports = {
  extractLocalizedText,
  mapLocale,
  mapOjsToOjsMetadata,
  mapOjsToStyloMetadata: mapOjsToOjsMetadata,
  mapOjsIssueToCorpusMetadata,
  mapMetadataToPublicationUpdate,
  extractArticleTitle,
  toLocalizedObject,
  mapAuthorsToOjsShape,
  deriveShortAuthor,
  formatIssueString,
}
