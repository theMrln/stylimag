
const { logger } = require('../logger')

const API_ENDPOINT = process.env.OJS_API_ENDPOINT
const API_TOKEN = process.env.OJS_API_TOKEN

async function fetchOjs(path, options = {}) {
  if (!API_ENDPOINT || !API_TOKEN) {
    throw new Error('OJS configuration missing (OJS_API_ENDPOINT or OJS_API_TOKEN)')
  }

  const url = `${API_ENDPOINT}${path}`
  const delimiter = url.includes('?') ? '&' : '?'
  const urlWithAuth = `${url}${delimiter}apiToken=${API_TOKEN}`

  logger.info(`Fetching OJS data from: ${path}`)

  const response = await fetch(urlWithAuth, options)

  if (!response.ok) {
    throw new Error(`OJS API Error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get all available issues from OJS
 */
async function getOjsIssues() {
  // Based on imaginations-issue-template: issues?orderBy=id&isPublished=1&orderDirection=DESC
  // We might want to make filters optional later, but for now reproducing the template's logic
  // The template fetches ALL issues (published or not depending on user input), here we default to all.
  const data = await fetchOjs('/issues?orderBy=id&orderDirection=DESC')
  return data.items || []
}

/**
 * Get metadata for a specific issue
 */
async function getOjsIssueMetadata(issueId) {
  return fetchOjs(`/issues/${issueId}`)
}

/**
 * Get submissions for a specific issue
 * The issue metadata contains "articles" which are actually submissions/publications
 */
async function getOjsIssueSubmissions(issueId) {
    const issueData = await getOjsIssueMetadata(issueId)
    // In OJS 3.x API, the issue endpoint usually returns detailed data including articles/submissions if usually configured
    // Let's verify what the template does.
    // The template script `a_get_issue_metadata.sh` calls `/issues/$issue_id` and saves it.
    // It assumes the response contains the articles.
    return issueData.articles || []
}

/**
 * Get full publication metadata
 * Corresponds to /submissions/$submission_id/publications/$publication_id
 */
async function getOjsPublication(submissionId, publicationId) {
    return fetchOjs(`/submissions/${submissionId}/publications/${publicationId}`)
}

module.exports = {
  getOjsIssues,
  getOjsIssueMetadata,
  getOjsPublication,
    getOjsIssueSubmissions
}
