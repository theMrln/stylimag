/**
 * OJS to Stylo Metadata Mapper
 * 
 * Maps metadata from OJS API responses to Stylo's expected metadata schema.
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
 * OJS uses "en_US", "fr_CA" format, Stylo uses "en", "fr"
 * @param {string} ojsLocale 
 * @returns {string}
 */
function mapLocale(ojsLocale) {
  if (!ojsLocale) return 'en'
  
  // Extract the language part before the underscore
  const langCode = ojsLocale.split('_')[0].toLowerCase()
  
  // Map to supported Stylo languages
  const supportedLangs = ['fr', 'en', 'it', 'es', 'pt', 'de', 'uk', 'ar']
  return supportedLangs.includes(langCode) ? langCode : 'en'
}

/**
 * Extract keywords from OJS localized keywords object
 * @param {object} keywords - OJS keywords object (localized)
 * @returns {string[]}
 */
function extractKeywords(keywords) {
  if (!keywords) return []
  
  // Keywords can be an array or a localized object containing arrays
  if (Array.isArray(keywords)) {
    return keywords.filter(k => typeof k === 'string' && k.trim())
  }
  
  // Try to get keywords from localized object
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
 * @returns {object}
 */
function mapAuthor(ojsAuthor) {
  if (!ojsAuthor) return null
  
  const author = {}
  
  // Map name fields
  const givenName = extractLocalizedText(ojsAuthor.givenName) || 
                    extractLocalizedText(ojsAuthor.firstName) ||
                    ojsAuthor.givenName
  const familyName = extractLocalizedText(ojsAuthor.familyName) || 
                     extractLocalizedText(ojsAuthor.lastName) ||
                     ojsAuthor.familyName
  
  if (givenName) author.forename = givenName
  if (familyName) author.surname = familyName
  
  // Map affiliation
  const affiliation = extractLocalizedText(ojsAuthor.affiliation)
  if (affiliation) author.affiliations = affiliation
  
  // Map email
  if (ojsAuthor.email) author.email = ojsAuthor.email
  
  // Map ORCID (OJS stores it with or without URL prefix)
  if (ojsAuthor.orcid) {
    // Normalize ORCID to just the ID part
    let orcid = ojsAuthor.orcid
    if (orcid.includes('orcid.org/')) {
      orcid = orcid.split('orcid.org/').pop()
    }
    author.orcid = orcid
  }
  
  // Map biography
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
 * Map OJS submission/publication to Stylo metadata format
 * @param {object} submission - OJS submission object
 * @param {object} issueMetadata - OJS issue metadata (optional)
 * @returns {object} Stylo-formatted metadata
 */
function mapOjsToStyloMetadata(submission, issueMetadata = null) {
  const publication = submission?.publications?.[0]
  
  const metadata = {
    // Required schema fields
    type: 'article',
    '@version': '1.0',
  }
  
  // Title
  const title = extractLocalizedText(publication?.fullTitle) ||
                extractLocalizedText(publication?.title) ||
                extractLocalizedText(submission?.fullTitle) ||
                extractLocalizedText(submission?.title)
  if (title) metadata.title = title
  
  // Subtitle
  const subtitle = extractLocalizedText(publication?.subtitle) ||
                   extractLocalizedText(submission?.subtitle)
  if (subtitle) metadata.subtitle = subtitle
  
  // Abstract
  const abstract = extractLocalizedText(publication?.abstract) ||
                   extractLocalizedText(submission?.abstract)
  if (abstract) metadata.abstract = abstract
  
  // Language
  const locale = publication?.locale || submission?.locale
  if (locale) metadata.lang = mapLocale(locale)
  
  // Publication date
  const datePublished = publication?.datePublished || submission?.datePublished
  if (datePublished) metadata.publicationDate = datePublished
  
  // Keywords
  const keywords = extractKeywords(publication?.keywords) ||
                   extractKeywords(submission?.keywords)
  if (keywords.length > 0) metadata.keywords = keywords
  
  // Authors
  const authors = mapAuthors(publication?.authors) ||
                  mapAuthors(submission?.authors)
  if (authors.length > 0) metadata.authors = authors
  
  // URL
  const url = publication?.urlPublished || submission?.urlPublished
  if (url) metadata.url = url
  
  // Issue metadata
  if (issueMetadata) {
    metadata.issue = {}
    
    const issueTitle = extractLocalizedText(issueMetadata.title)
    if (issueTitle) metadata.issue.title = issueTitle
    
    if (issueMetadata.number) metadata.issue.number = String(issueMetadata.number)
    if (issueMetadata.volume) metadata.issue.identifier = `Vol. ${issueMetadata.volume}`
    if (issueMetadata.id) metadata.issue.identifier = metadata.issue.identifier || String(issueMetadata.id)
  }
  
  // Pages
  const pages = publication?.pages || submission?.pages
  if (pages) {
    // Could be stored in a custom field or in issue context
    metadata.pages = pages
  }
  
  // Store original OJS data for reference and re-import
  metadata.ojs = submission
  
  return metadata
}

/**
 * Extract just the title from OJS submission (for Article.title field)
 * @param {object} submission - OJS submission object
 * @returns {string}
 */
function extractArticleTitle(submission) {
  const publication = submission?.publications?.[0]
  
  return extractLocalizedText(publication?.fullTitle) ||
         extractLocalizedText(publication?.title) ||
         extractLocalizedText(submission?.fullTitle) ||
         extractLocalizedText(submission?.title) ||
         extractLocalizedText(submission?.name) ||
         'Untitled'
}

module.exports = {
  extractLocalizedText,
  mapLocale,
  extractKeywords,
  mapAuthor,
  mapAuthors,
  mapOjsToStyloMetadata,
  extractArticleTitle,
}
