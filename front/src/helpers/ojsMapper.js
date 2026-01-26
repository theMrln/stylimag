/**
 * OJS to Stylo Metadata Mapper (Frontend)
 * 
 * Maps metadata from OJS data stored in article metadata to Stylo's expected format.
 * Used for re-importing OJS data from stored metadata.
 */

/**
 * Extract localized text from an OJS localized object
 * @param {object|string} obj - OJS localized object or string
 * @param {string} fallback - Fallback value
 * @returns {string}
 */
function extractLocalizedText(obj, fallback = '') {
  if (!obj) return fallback
  if (typeof obj === 'string') return obj
  
  // Try common locale keys
  return obj.fr_CA || obj.en_US || obj.fr || obj.en || 
         obj['fr-CA'] || obj['en-US'] ||
         // Get first available value
         Object.values(obj).find(v => typeof v === 'string' && v.trim()) ||
         fallback
}

/**
 * Map OJS locale code to Stylo language code
 * @param {string} ojsLocale 
 * @returns {string}
 */
function mapLocale(ojsLocale) {
  if (!ojsLocale) return 'en'
  
  const langCode = ojsLocale.split('_')[0].toLowerCase()
  const supportedLangs = ['fr', 'en', 'it', 'es', 'pt', 'de', 'uk', 'ar']
  return supportedLangs.includes(langCode) ? langCode : 'en'
}

/**
 * Extract keywords from OJS localized keywords object
 * @param {object} keywords - OJS keywords object
 * @returns {string[]}
 */
function extractKeywords(keywords) {
  if (!keywords) return []
  
  if (Array.isArray(keywords)) {
    return keywords.filter(k => typeof k === 'string' && k.trim())
  }
  
  const localizedKeywords = keywords.fr_CA || keywords.en_US || keywords.fr || keywords.en ||
                           Object.values(keywords).find(v => Array.isArray(v))
  
  if (Array.isArray(localizedKeywords)) {
    return localizedKeywords.filter(k => typeof k === 'string' && k.trim())
  }
  
  return []
}

/**
 * Map a single OJS author to Stylo author format
 * @param {object} ojsAuthor - OJS author object
 * @returns {object|null}
 */
function mapAuthor(ojsAuthor) {
  if (!ojsAuthor) return null
  
  const author = {}
  
  const givenName = extractLocalizedText(ojsAuthor.givenName) || 
                    extractLocalizedText(ojsAuthor.firstName) ||
                    ojsAuthor.givenName
  const familyName = extractLocalizedText(ojsAuthor.familyName) || 
                     extractLocalizedText(ojsAuthor.lastName) ||
                     ojsAuthor.familyName
  
  if (givenName) author.forename = givenName
  if (familyName) author.surname = familyName
  
  const affiliation = extractLocalizedText(ojsAuthor.affiliation)
  if (affiliation) author.affiliations = affiliation
  
  if (ojsAuthor.email) author.email = ojsAuthor.email
  
  if (ojsAuthor.orcid) {
    let orcid = ojsAuthor.orcid
    if (orcid.includes('orcid.org/')) {
      orcid = orcid.split('orcid.org/').pop()
    }
    author.orcid = orcid
  }
  
  const biography = extractLocalizedText(ojsAuthor.biography)
  if (biography) author.biography = biography
  
  return author
}

/**
 * Map OJS authors array to Stylo authors format
 * @param {object[]} ojsAuthors - Array of OJS author objects
 * @returns {object[]}
 */
function mapAuthors(ojsAuthors) {
  if (!ojsAuthors || !Array.isArray(ojsAuthors)) return []
  
  return ojsAuthors
    .map(mapAuthor)
    .filter(author => author && (author.forename || author.surname))
}

/**
 * Map OJS submission data to Stylo metadata format
 * This is used for re-importing from stored OJS data
 * @param {object} ojsSubmission - OJS submission object (stored in metadata.ojs)
 * @param {object} existingMetadata - Current metadata to merge with
 * @returns {object} Updated Stylo-formatted metadata
 */
export function mapOjsToStyloMetadata(ojsSubmission, existingMetadata = {}) {
  if (!ojsSubmission) return existingMetadata
  
  const publication = ojsSubmission?.publications?.[0]
  
  const metadata = {
    ...existingMetadata,
    // Required schema fields
    type: 'article',
    '@version': '1.0',
  }
  
  // Title
  const title = extractLocalizedText(publication?.fullTitle) ||
                extractLocalizedText(publication?.title) ||
                extractLocalizedText(ojsSubmission?.fullTitle) ||
                extractLocalizedText(ojsSubmission?.title)
  if (title) metadata.title = title
  
  // Subtitle
  const subtitle = extractLocalizedText(publication?.subtitle) ||
                   extractLocalizedText(ojsSubmission?.subtitle)
  if (subtitle) metadata.subtitle = subtitle
  
  // Abstract
  const abstract = extractLocalizedText(publication?.abstract) ||
                   extractLocalizedText(ojsSubmission?.abstract)
  if (abstract) metadata.abstract = abstract
  
  // Language
  const locale = publication?.locale || ojsSubmission?.locale
  if (locale) metadata.lang = mapLocale(locale)
  
  // Publication date
  const datePublished = publication?.datePublished || ojsSubmission?.datePublished
  if (datePublished) metadata.publicationDate = datePublished
  
  // Keywords
  const keywords = extractKeywords(publication?.keywords) ||
                   extractKeywords(ojsSubmission?.keywords)
  if (keywords.length > 0) metadata.keywords = keywords
  
  // Authors
  const authors = mapAuthors(publication?.authors) ||
                  mapAuthors(ojsSubmission?.authors)
  if (authors.length > 0) metadata.authors = authors
  
  // URL
  const url = publication?.urlPublished || ojsSubmission?.urlPublished
  if (url) metadata.url = url
  
  // Pages
  const pages = publication?.pages || ojsSubmission?.pages
  if (pages) metadata.pages = pages
  
  // Keep the original OJS data
  metadata.ojs = ojsSubmission
  
  return metadata
}

/**
 * Check if metadata contains OJS data that can be re-imported
 * @param {object} metadata - Article metadata
 * @returns {boolean}
 */
export function hasOjsData(metadata) {
  return !!(metadata?.ojs && typeof metadata.ojs === 'object')
}

export default {
  mapOjsToStyloMetadata,
  hasOjsData,
  extractLocalizedText,
  mapLocale,
  extractKeywords,
  mapAuthors,
}
