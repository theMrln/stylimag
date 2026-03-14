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

module.exports = {
  getOjsIssues,
  getOjsIssueMetadata,
  getOjsPublication,
  getOjsIssueSubmissions,
  getAvailableOjsInstances,
}
