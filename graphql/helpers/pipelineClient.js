const config = require('../config.js')
const { logger } = require('../logger.js')

function authHeader() {
  const token = config.get('pipeline.authToken')
  return token ? { authorization: `Bearer ${token}` } : {}
}

function baseUrl() {
  const url = config.get('pipeline.serviceUrl')
  if (!url) {
    throw new Error(
      'PIPELINE_SERVICE_URL is not configured; pipeline jobs cannot be dispatched'
    )
  }
  return url.replace(/\/+$/, '')
}

async function fetchJson(path, opts = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    config.get('pipeline.requestTimeoutMs')
  )
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...opts,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeader(),
        ...(opts.headers || {}),
      },
    })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    if (!res.ok) {
      const err = new Error(
        body?.error || `Pipeline ${path} failed with status ${res.status}`
      )
      err.status = res.status
      err.details = body?.details
      throw err
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function isConfigured() {
  return Boolean(config.get('pipeline.serviceUrl'))
}

async function getHealth() {
  if (!(await isConfigured())) {
    return { ok: false, error: 'pipeline-service-not-configured' }
  }
  try {
    const res = await fetch(`${baseUrl()}/health`, { headers: authHeader() })
    const body = await res.json().catch(() => ({}))
    return { httpStatus: res.status, ...body }
  } catch (err) {
    logger.warn({ err }, 'pipeline /health probe failed')
    return { ok: false, error: err.message }
  }
}

async function startJob({ type, params }) {
  return fetchJson('/jobs', {
    method: 'POST',
    body: JSON.stringify({ type, params }),
  })
}

async function getJob(remoteJobId) {
  return fetchJson(`/jobs/${encodeURIComponent(remoteJobId)}`, {
    method: 'GET',
  })
}

async function cancelJob(remoteJobId) {
  return fetchJson(`/jobs/${encodeURIComponent(remoteJobId)}/cancel`, {
    method: 'POST',
  })
}

module.exports = {
  isConfigured,
  getHealth,
  startJob,
  getJob,
  cancelJob,
}
