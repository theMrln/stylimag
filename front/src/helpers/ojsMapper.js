/**
 * OJS Metadata (Frontend)
 *
 * Builds OJS-shaped metadata from stored OJS submission for re-import and display.
 * Metadata shape: locale, title (localized), authors (givenName/familyName localized), abstract (localized), issue, start_page, short_title, short_author.
 */

/**
 * Extract first string from a localized object
 * @param {object|string} obj
 * @param {string} fallback
 * @returns {string}
 */
function extractLocalizedText(obj, fallback = '') {
  if (!obj) return fallback
  if (typeof obj === 'string') return obj
  return (
    obj.fr_CA ||
    obj.en_US ||
    obj.fr ||
    obj.en ||
    obj['fr-CA'] ||
    obj['en-US'] ||
    Object.values(obj).find((v) => typeof v === 'string' && v.trim()) ||
    fallback
  )
}

/**
 * Map OJS locale to short locale (en_US -> en)
 * @param {string} ojsLocale
 * @returns {string}
 */
function mapLocale(ojsLocale) {
  if (!ojsLocale) return 'en'
  return ojsLocale.split('_')[0].toLowerCase()
}

/**
 * Ensure value is a localized object { en_US: "...", fr_CA: "..." }
 * @param {object|string} value
 * @param {string} locale
 * @returns {object}
 */
function toLocalizedObject(value, locale = 'en_US') {
  if (value == null) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return { [locale]: String(value) }
}

/**
 * Map one OJS author to OJS-shaped author { givenName: {}, familyName: {} }
 * @param {object} ojsAuthor
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

function mapAuthorsToOjsShape(ojsAuthors) {
  if (!ojsAuthors || !Array.isArray(ojsAuthors)) return []
  return ojsAuthors.map(mapAuthorToOjsShape).filter(Boolean)
}

/**
 * Build issue string from issue metadata (e.g. "15-1, 2024")
 * @param {object} issueMetadata
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
 * Derive short_author from first author familyName
 * @param {object[]} authors
 * @returns {string}
 */
function deriveShortAuthor(authors) {
  if (!authors?.length) return ''
  const first = authors[0]
  const familyName = first.familyName
  if (!familyName || typeof familyName !== 'object') return ''
  const v =
    familyName.en_US ??
    familyName.en ??
    familyName.fr_CA ??
    familyName.fr ??
    Object.values(familyName)[0]
  return typeof v === 'string' ? v.toLowerCase().replace(/\s+/g, '') : ''
}

/**
 * Build OJS-shaped metadata from stored OJS submission (re-import).
 * @param {object} ojsSubmission - Stored in metadata.ojs
 * @param {object} existingMetadata - Current metadata (preserve type, @version)
 * @returns {object} OJS-shaped metadata
 */
export function mapOjsToOjsMetadata(ojsSubmission, existingMetadata = {}) {
  if (!ojsSubmission) return existingMetadata

  const publication = ojsSubmission?.publications?.[0]
  const locale = publication?.locale || ojsSubmission?.locale || 'en_US'
  const localeShort = mapLocale(locale)

  const title =
    publication?.fullTitle ??
    publication?.title ??
    ojsSubmission?.fullTitle ??
    ojsSubmission?.title ??
    ojsSubmission?.name
  const titleObj = toLocalizedObject(title, locale)

  const authors = mapAuthorsToOjsShape(publication?.authors ?? ojsSubmission?.authors)

  const abstract = publication?.abstract ?? ojsSubmission?.abstract
  const abstractObj = toLocalizedObject(abstract, locale)

  let startPage = 1
  const pages = publication?.pages ?? ojsSubmission?.pages
  if (typeof pages === 'string' && pages.includes('-')) {
    const start = parseInt(pages.split('-')[0], 10)
    if (!Number.isNaN(start)) startPage = start
  } else if (typeof pages === 'number') {
    startPage = pages
  }

  const issueMetadata = existingMetadata?.ojsIssue ?? null
  const issueStr = issueMetadata ? formatIssueString(issueMetadata) : ''
  const firstTitle =
    typeof titleObj === 'object'
      ? titleObj.en_US ?? titleObj.fr_CA ?? Object.values(titleObj)[0]
      : titleObj
  const shortTitle = typeof firstTitle === 'string' ? firstTitle : ''
  const shortAuthor = deriveShortAuthor(authors)

  return {
    type: existingMetadata?.type ?? 'article',
    '@version': existingMetadata?.['@version'] ?? '1.0',
    locale: localeShort,
    title: Object.keys(titleObj).length ? titleObj : { [locale]: 'Untitled' },
    authors,
    abstract: Object.keys(abstractObj).length ? abstractObj : undefined,
    issue: issueStr || undefined,
    start_page: startPage,
    short_title: shortTitle || undefined,
    short_author: shortAuthor || undefined,
    ojs: ojsSubmission,
  }
}

/** @deprecated Use mapOjsToOjsMetadata */
export function mapOjsToStyloMetadata(ojsSubmission, existingMetadata = {}) {
  return mapOjsToOjsMetadata(ojsSubmission, existingMetadata)
}

/**
 * Check if metadata contains OJS data that can be re-imported
 * @param {object} metadata
 * @returns {boolean}
 */
export function hasOjsData(metadata) {
  return !!(metadata?.ojs && typeof metadata.ojs === 'object')
}

/**
 * Map OJS issue metadata to corpus (journal) metadata shape for the form.
 * Same shape as backend mapOjsIssueToCorpusMetadata: type, @version, name, issue (title, identifier, number), ojs.
 *
 * @param {object} issueMetadata - OJS issue object (e.g. from metadata.ojs)
 * @returns {object} Metadata for corpus type "journal"
 */
export function mapOjsIssueToCorpusMetadata(issueMetadata) {
  if (!issueMetadata || typeof issueMetadata !== 'object') {
    return { type: 'journal', '@version': '1.0', name: '', issue: {} }
  }
  const issueTitle =
    extractLocalizedText(issueMetadata.title) || extractLocalizedText(issueMetadata.name)
  const issueNumber = formatIssueString(issueMetadata)
  const identifier =
    issueMetadata.id != null
      ? String(issueMetadata.id)
      : (issueMetadata.doi || issueMetadata.url || '')
  return {
    type: 'journal',
    '@version': '1.0',
    name: issueTitle || 'Untitled issue',
    issue: {
      ...(issueTitle && { title: issueTitle }),
      ...(identifier && { identifier }),
      ...(issueNumber && { number: issueNumber }),
    },
    ojs: issueMetadata,
  }
}

/**
 * Normalize corpus metadata for the metadata form. When type is journal and metadata
 * only has ojs (legacy OJS import), fill from ojs so the form shows issue title/number/etc.
 *
 * @param {object} metadata - corpus.metadata
 * @param {string} corpusType - corpus.type
 * @returns {object} Metadata in schema shape for the form
 */
export function normalizeCorpusMetadataForForm(metadata, corpusType) {
  if (!metadata || typeof metadata !== 'object') return metadata ?? {}
  if (corpusType !== 'journal') return metadata
  const hasIssueFields = metadata.issue && (metadata.issue.title || metadata.issue.number)
  if (hasIssueFields && metadata.type === 'journal') return metadata
  if (metadata.ojs && typeof metadata.ojs === 'object') {
    return mapOjsIssueToCorpusMetadata(metadata.ojs)
  }
  return metadata
}

/**
 * Normalize legacy (Stylo) metadata to OJS shape for the form.
 * If metadata already has OJS shape (title is object with locale keys), return as-is.
 * Otherwise convert title string -> { en_US: title }, authors forename/surname -> givenName/familyName.
 * @param {object} metadata
 * @returns {object} OJS-shaped metadata
 */
export function normalizeMetadataToOjsShape(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { type: 'article', '@version': '1.0', locale: 'en', title: {}, authors: [], start_page: 1 }
  }
  const title = metadata.title
  const authors = metadata.authors
  const hasOjsTitle =
    title !== null &&
    typeof title === 'object' &&
    !Array.isArray(title) &&
    Object.keys(title).some((k) => ['en_US', 'fr_CA', 'en', 'fr'].includes(k))
  const hasOjsAuthors =
    Array.isArray(authors) &&
    authors.length > 0 &&
    authors[0] &&
    ('givenName' in authors[0] || 'familyName' in authors[0])
  if (hasOjsTitle && hasOjsAuthors) {
    return { ...metadata, type: metadata.type ?? 'article', '@version': metadata['@version'] ?? '1.0' }
  }
  const out = {
    type: metadata.type ?? 'article',
    '@version': metadata['@version'] ?? '1.0',
    locale: mapLocale(metadata.lang ?? metadata.locale) || 'en',
    title: hasOjsTitle ? title : typeof title === 'string' ? { en_US: title } : {},
    authors: hasOjsAuthors ? authors : (authors || []).map((a) => ({
      givenName: a.forename ? { en_US: a.forename } : {},
      familyName: a.surname ? { en_US: a.surname } : {},
    })),
    abstract:
      metadata.abstract && typeof metadata.abstract === 'object' && !Array.isArray(metadata.abstract)
        ? metadata.abstract
        : typeof metadata.abstract === 'string'
          ? { en_US: metadata.abstract }
          : undefined,
    issue:
      typeof metadata.issue === 'string'
        ? metadata.issue
        : undefined,
    start_page: metadata.start_page ?? 1,
    short_title: metadata.short_title,
    short_author: metadata.short_author,
    ojs: metadata.ojs,
  }
  return out
}

export default {
  mapOjsToOjsMetadata,
  mapOjsToStyloMetadata,
  hasOjsData,
  normalizeMetadataToOjsShape,
  mapOjsIssueToCorpusMetadata,
  normalizeCorpusMetadataForForm,
  extractLocalizedText,
  mapLocale,
}
