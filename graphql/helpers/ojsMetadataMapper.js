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
 * Merge OJS multilingual fields with side-panel edits so required locales stay
 * present. OJS often returns 400 if `title`/`abstract` omit a locale the
 * journal requires (e.g. only `en_US` in Stylimag after an edit, while OJS
 * still has `fr_CA`).
 *
 * @param {object|string|undefined|null} existing - Current publication field from GET
 * @param {object} patch - Localized object from workingVersion.metadata
 * @returns {object}
 */
function mergeMultilingualPatch(existing, patch) {
  const base = {}
  if (
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
  ) {
    Object.assign(base, existing)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return base
  }
  for (const [locale, val] of Object.entries(patch)) {
    if (val == null) continue
    if (typeof val === 'string') {
      if (val.trim() !== '') base[locale] = val
      continue
    }
    if (typeof val === 'object' && !Array.isArray(val)) {
      const flat =
        val[locale] ??
        val.en_US ??
        val.fr_CA ??
        val.en ??
        val.fr ??
        Object.values(val).find(
          (x) => typeof x === 'string' && String(x).trim() !== ''
        )
      if (flat != null && String(flat).trim() !== '') {
        base[locale] = String(flat).trim()
      }
    }
  }
  return base
}

/**
 * Derive the set of locales OJS will accept for this publication's
 * multilingual fields. We do not have the journal context client-side, so we
 * infer accepted locales from the publication itself:
 *
 *   1. Locale keys present on any known multilingual field (title, fullTitle,
 *      subtitle, prefix, abstract, copyrightHolder, etc.).
 *   2. The publication's primary `locale`.
 *
 * If the publication carries no useful hints we return an empty Set, in which
 * case `restrictToAcceptedLocales` is a no-op (preserves legacy behavior).
 *
 * @param {object|null} pub
 * @returns {Set<string>}
 */
function getAcceptedOjsLocales(pub) {
  const accepted = new Set()
  if (!pub || typeof pub !== 'object') return accepted
  const fields = [
    'title',
    'fullTitle',
    'subtitle',
    'prefix',
    'abstract',
    'copyrightHolder',
    'coverage',
    'rights',
    'source',
    'subject',
    'disciplines',
    'keywords',
  ]
  for (const f of fields) {
    const v = pub[f]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) accepted.add(k)
    }
  }
  if (typeof pub.locale === 'string' && pub.locale) accepted.add(pub.locale)
  return accepted
}

/**
 * Drop any locale keys not in `accepted`. No-op when `accepted` is empty.
 * @param {object} merged
 * @param {Set<string>} accepted
 * @returns {object}
 */
function restrictToAcceptedLocales(merged, accepted) {
  if (!merged || typeof merged !== 'object' || Array.isArray(merged)) {
    return merged
  }
  if (!accepted || accepted.size === 0) return merged
  const out = {}
  for (const [k, v] of Object.entries(merged)) {
    if (accepted.has(k)) out[k] = v
  }
  return out
}

/**
 * For each locale in `accepted`, ensure a non-empty value exists. Missing or
 * blank locales are filled from the first non-empty value already in `merged`.
 * If we have nothing to fill from we leave it alone (validation will tell us).
 *
 * @param {object} merged
 * @param {Set<string>} accepted
 * @returns {object}
 */
function backfillMissingOjsLocales(merged, accepted) {
  if (!merged || typeof merged !== 'object' || Array.isArray(merged)) {
    return merged
  }
  const out = { ...merged }
  const firstNonEmpty =
    ['en_US', 'fr_CA', 'en', 'fr']
      .map((k) => out[k])
      .find((v) => typeof v === 'string' && v.trim() !== '') ??
    Object.values(out).find(
      (v) => typeof v === 'string' && String(v).trim() !== ''
    )
  if (!firstNonEmpty) return out
  const targets =
    accepted && accepted.size > 0 ? [...accepted] : ['en_US', 'fr_CA']
  for (const key of targets) {
    const v = out[key]
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      out[key] = firstNonEmpty
    }
  }
  return out
}

/**
 * Build a partial OJS publication update body from side-panel-shaped metadata.
 * Only fields that map cleanly to a publication PUT are included; fields like
 * `issue`, `short_title`, `short_author` have no direct OJS counterpart and
 * are ignored here.
 *
 * When `existingPublication` is provided (from GET …/publications/:id), `title`
 * and `abstract` are:
 *   1. Merged onto the current OJS values so untouched locales are preserved.
 *   2. Restricted to the locales OJS already uses on this publication, so we
 *      do not push e.g. `en_US` to a journal that only accepts `fr_CA`.
 *   3. Backfilled with the first non-empty value for any required locale that
 *      ended up missing or blank.
 *
 * @param {object} metadata - OJS-shaped metadata as edited in the side panel
 * @param {object|null} [existingPublication] - Current publication from OJS API
 * @returns {object} body for PUT /submissions/:s/publications/:p
 */
function mapMetadataToPublicationUpdate(metadata, existingPublication = null) {
  if (!metadata || typeof metadata !== 'object') return {}
  const accepted = getAcceptedOjsLocales(existingPublication)
  const body = {}
  if (metadata.title && typeof metadata.title === 'object') {
    const merged = mergeMultilingualPatch(
      existingPublication?.title ?? existingPublication?.fullTitle,
      metadata.title
    )
    // Backfill BEFORE restrict so a value the user only typed in en_US can
    // still seed an accepted locale (e.g. fr_CA-only journal). After that we
    // drop unaccepted locales from the PUT body.
    const filled = backfillMissingOjsLocales(merged, accepted)
    const restricted = restrictToAcceptedLocales(filled, accepted)
    if (Object.keys(restricted).length > 0) body.title = restricted
  }
  if (metadata.abstract && typeof metadata.abstract === 'object') {
    const merged = mergeMultilingualPatch(
      existingPublication?.abstract,
      metadata.abstract
    )
    const filled = backfillMissingOjsLocales(merged, accepted)
    const restricted = restrictToAcceptedLocales(filled, accepted)
    if (Object.keys(restricted).length > 0) body.abstract = restricted
  }
  if (metadata.start_page != null) {
    const p = metadata.start_page
    if (typeof p === 'number' && !Number.isNaN(p)) {
      body.pages = String(Math.trunc(p))
    } else if (typeof p === 'string' && /^\s*\d+/.test(p)) {
      body.pages = String(parseInt(p.trim(), 10))
    }
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
  mergeMultilingualPatch,
  backfillMissingOjsLocales,
  getAcceptedOjsLocales,
  restrictToAcceptedLocales,
  extractArticleTitle,
  toLocalizedObject,
  mapAuthorsToOjsShape,
  deriveShortAuthor,
  formatIssueString,
}
