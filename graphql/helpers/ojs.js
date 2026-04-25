const { logger } = require('../logger')
const {
  getOjsInstanceConfig,
  getAvailableOjsInstances,
} = require('./ojsConfig')

/**
 * Fetch from an OJS API instance (OJS 3.x / 3.5 compatible).
 * Endpoint is used as-is to support index.php-style URLs (e.g. .../index.php/journal/api/v1).
 * @param {'staging'|'production'} instance
 * @param {string} path - API path e.g. /issues or /issues/123
 * @param {RequestInit} [options]
 */
async function fetchOjs(instance, path, options = {}) {
  const config = getOjsInstanceConfig(instance)
  if (!config) {
    throw new Error(
      `OJS configuration missing for instance "${instance}". Check config/ojs.json.`
    )
  }

  const url = `${config.api_endpoint}${path.startsWith('/') ? path : `/${path}`}`
  const delimiter = url.includes('?') ? '&' : '?'
  const urlWithAuth = `${url}${delimiter}apiToken=${config.api_token}`

  logger.info(`Fetching OJS data [${instance}]: ${path}`)

  const response = await fetch(urlWithAuth, options)

  if (!response.ok) {
    throw new Error(
      `OJS API Error [${instance}]: ${response.status} ${response.statusText}`
    )
  }

  return response.json()
}

/**
 * Get all available issues from an OJS instance, newest first.
 * OJS 3.x / 3.5: GET /issues?orderBy=...&orderDirection=DESC
 * Uses count to request more than default page size so the dropdown shows all issues.
 * @param {'staging'|'production'} instance
 */
async function getOjsIssues(instance) {
  const data = await fetchOjs(
    instance,
    '/issues?orderBy=datePublished&orderDirection=DESC&count=500'
  )
  const items = data.items || []
  // Ensure latest first: sort by datePublished (or year, id) descending
  items.sort((a, b) => {
    const dateA = a.datePublished || (a.year != null ? `${a.year}` : '') || '0'
    const dateB = b.datePublished || (b.year != null ? `${b.year}` : '') || '0'
    if (dateB !== dateA) return dateB.localeCompare(dateA, undefined, { numeric: true })
    return (b.id ?? 0) - (a.id ?? 0)
  })
  return items
}

/**
 * Get metadata for a specific issue.
 * @param {'staging'|'production'} instance
 * @param {number} issueId
 */
async function getOjsIssueMetadata(instance, issueId) {
  return fetchOjs(instance, `/issues/${issueId}`)
}

/**
 * Get submissions for a specific issue (OJS 3.x: issue response may include articles).
 * @param {'staging'|'production'} instance
 * @param {number} issueId
 */
async function getOjsIssueSubmissions(instance, issueId) {
  const issueData = await getOjsIssueMetadata(instance, issueId)
  return issueData.articles || []
}

/**
 * Get a single submission (includes currentPublicationId and publications array).
 * OJS 3.x: GET /submissions/:submissionId
 * @param {'staging'|'production'} instance
 * @param {number|string} submissionId
 */
async function getOjsSubmission(instance, submissionId) {
  return fetchOjs(instance, `/submissions/${submissionId}`)
}

/**
 * Get full publication metadata.
 * OJS 3.x: GET /submissions/:submissionId/publications/:publicationId
 * @param {'staging'|'production'} instance
 */
async function getOjsPublication(instance, submissionId, publicationId) {
  return fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}`
  )
}

/**
 * Update an OJS publication with a partial body (PUT).
 * OJS 3.x: PUT /submissions/:submissionId/publications/:publicationId
 * @param {'staging'|'production'} instance
 * @param {number|string} submissionId
 * @param {number|string} publicationId
 * @param {object} body - Fields to update on the publication
 */
async function updateOjsPublication(instance, submissionId, publicationId, body) {
  return fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

/**
 * List authors attached to a publication.
 * OJS 3.x: GET /submissions/:submissionId/publications/:publicationId/authors
 * Returns authors sorted by `seq` ascending so order matches the OJS UI.
 * @param {'staging'|'production'} instance
 * @param {number|string} submissionId
 * @param {number|string} publicationId
 * @returns {Promise<object[]>}
 */
async function getOjsPublicationAuthors(instance, submissionId, publicationId) {
  // OJS uses paginated `items`; request a generous count to avoid pagination.
  const data = await fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}/authors?count=100`
  )
  const items = Array.isArray(data) ? data : data?.items || []
  return [...items].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

/**
 * Create an author on a publication.
 * OJS 3.x: POST /submissions/:submissionId/publications/:publicationId/authors
 */
async function createOjsAuthor(instance, submissionId, publicationId, body) {
  return fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}/authors`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

/**
 * Update an author on a publication.
 * OJS 3.x: PUT /submissions/:submissionId/publications/:publicationId/authors/:authorId
 */
async function updateOjsAuthor(
  instance,
  submissionId,
  publicationId,
  authorId,
  body
) {
  return fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}/authors/${authorId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

/**
 * Delete an author from a publication.
 * OJS 3.x: DELETE /submissions/:submissionId/publications/:publicationId/authors/:authorId
 */
async function deleteOjsAuthor(instance, submissionId, publicationId, authorId) {
  return fetchOjs(
    instance,
    `/submissions/${submissionId}/publications/${publicationId}/authors/${authorId}`,
    { method: 'DELETE' }
  )
}

/**
 * Get section metadata by id (for section title when publication only has sectionId).
 * OJS 3.x may expose GET /sections/:sectionId. Returns null on 404 or error.
 * @param {'staging'|'production'} instance
 * @param {number|string} sectionId
 * @returns {Promise<{ id: number, title?: object|string }|null>}
 */
async function getOjsSection(instance, sectionId) {
  if (sectionId == null) return null
  try {
    return await fetchOjs(instance, `/sections/${sectionId}`)
  } catch (err) {
    logger.debug(`Could not fetch OJS section ${sectionId}: ${err.message}`)
    return null
  }
}

/**
 * Enrich a submission from an issue's articles list with full publication data.
 * Issue articles often only have stub data; authors and full metadata live in
 * submissions.publications[0]. This fetches the full publication and returns
 * a submission-shaped object with publications: [fullPublication].
 *
 * @param {'staging'|'production'} instance
 * @param {object} submissionOrArticle - Item from issue.articles (has id; may have currentPublicationId or publications[0].id)
 * @returns {Promise<object>} Same shape as submission with publications: [fullPublication] for mapping
 */
async function getSubmissionWithFullPublication(instance, submissionOrArticle) {
  const submissionId = submissionOrArticle?.id
  if (submissionId == null) {
    return submissionOrArticle
  }

  let publicationId =
    submissionOrArticle.currentPublicationId ??
    submissionOrArticle.publications?.[0]?.id

  if (publicationId == null) {
    try {
      const fullSubmission = await getOjsSubmission(instance, submissionId)
      publicationId =
        fullSubmission.currentPublicationId ??
        fullSubmission.publications?.[0]?.id
    } catch (err) {
      logger.warn(
        `Could not fetch submission ${submissionId} for publication id: ${err.message}`
      )
      return submissionOrArticle
    }
  }

  if (publicationId == null) {
    return submissionOrArticle
  }

  try {
    const fullPublication = await getOjsPublication(
      instance,
      submissionId,
      publicationId
    )
    return {
      ...submissionOrArticle,
      id: submissionId,
      publications: [fullPublication],
    }
  } catch (err) {
    logger.warn(
      `Could not fetch publication ${publicationId} for submission ${submissionId}: ${err.message}`
    )
    return submissionOrArticle
  }
}

module.exports = {
  getOjsIssues,
  getOjsIssueMetadata,
  getOjsSubmission,
  getOjsPublication,
  getOjsSection,
  getOjsIssueSubmissions,
  getSubmissionWithFullPublication,
  updateOjsPublication,
  getOjsPublicationAuthors,
  createOjsAuthor,
  updateOjsAuthor,
  deleteOjsAuthor,
  getAvailableOjsInstances,
}
