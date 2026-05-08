const { logger } = require('../logger')
const { getOjsInstanceConfig } = require('./ojsConfig')

/**
 * OJS push helpers for the publishing pipeline.
 *
 * Defaults to dry-run: returns the would-be {endpoint, payload} so the
 * front-end can show editors what's about to be sent before any network
 * traffic. Pass `apply: true` to actually issue the PUT request.
 *
 * Designed to be safe in production-coupled environments — every helper
 * returns a structured result that includes the failed/succeeded item ids,
 * never throws on partial failure, and logs full URL + status for audit.
 */

const PUBLICATION_PATH_PREFIX = '/submissions'

function publicationUrl(instance, submissionId, publicationId, apiToken) {
  const config = getOjsInstanceConfig(instance)
  if (!config) {
    throw new Error(`OJS configuration missing for instance "${instance}"`)
  }
  const base = `${config.api_endpoint}${PUBLICATION_PATH_PREFIX}/${submissionId}/publications/${publicationId}`
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}apiToken=${apiToken ?? config.api_token}`
}

async function putJson(url, payload) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { ok: res.ok, status: res.status, body: parsed }
}

/**
 * Push start_page values back to OJS as `pages` strings on each
 * publication. `entries` is the same shape the front-end produces from
 * the page-numbers job: [{ submissionId, publicationId, startPage,
 * pageCount }].
 */
async function pushPageNumbers({ instance, entries, apply = false }) {
  const summary = { applied: 0, dryRun: !apply, items: [] }
  if (!Array.isArray(entries) || entries.length === 0) return summary
  for (const entry of entries) {
    if (!entry?.submissionId || !entry?.publicationId) {
      summary.items.push({ ...entry, ok: false, reason: 'missing-ids' })
      continue
    }
    const start = entry.startPage
    const end = entry.pageCount ? entry.startPage + entry.pageCount - 1 : null
    const payload = { pages: end ? `${start}-${end}` : `${start}` }
    const url = publicationUrl(
      instance,
      entry.submissionId,
      entry.publicationId
    )
    if (!apply) {
      summary.items.push({ ...entry, ok: true, dryRun: true, payload, url })
      continue
    }
    try {
      const res = await putJson(url, payload)
      if (!res.ok) {
        logger.warn(
          { status: res.status, url, body: res.body },
          'OJS pushPageNumbers PUT failed'
        )
        summary.items.push({
          ...entry,
          ok: false,
          status: res.status,
          error: res.body?.errorMessage ?? res.body?.message ?? 'put-failed',
        })
        continue
      }
      summary.items.push({ ...entry, ok: true, status: res.status })
      summary.applied += 1
    } catch (err) {
      summary.items.push({
        ...entry,
        ok: false,
        error: err.message,
      })
    }
  }
  return summary
}

/**
 * Push DOIs back as a publication-level patch.
 * `entries`: [{ submissionId, publicationId, doi }]
 */
async function pushDois({ instance, entries, apply = false }) {
  const summary = { applied: 0, dryRun: !apply, items: [] }
  if (!Array.isArray(entries) || entries.length === 0) return summary
  for (const entry of entries) {
    if (!entry?.submissionId || !entry?.publicationId || !entry?.doi) {
      summary.items.push({ ...entry, ok: false, reason: 'missing-fields' })
      continue
    }
    const payload = { pub: { 'doi::pub': entry.doi } }
    const url = publicationUrl(
      instance,
      entry.submissionId,
      entry.publicationId
    )
    if (!apply) {
      summary.items.push({ ...entry, ok: true, dryRun: true, payload, url })
      continue
    }
    try {
      const res = await putJson(url, payload)
      if (!res.ok) {
        summary.items.push({
          ...entry,
          ok: false,
          status: res.status,
          error: res.body?.errorMessage ?? res.body?.message ?? 'put-failed',
        })
        continue
      }
      summary.items.push({ ...entry, ok: true, status: res.status })
      summary.applied += 1
    } catch (err) {
      summary.items.push({ ...entry, ok: false, error: err.message })
    }
  }
  return summary
}

/**
 * Push author bios. Each entry targets a specific author within a
 * publication: { submissionId, publicationId, authorId, biography }.
 */
async function pushAuthorBios({ instance, entries, apply = false }) {
  const summary = { applied: 0, dryRun: !apply, items: [] }
  if (!Array.isArray(entries) || entries.length === 0) return summary
  const config = getOjsInstanceConfig(instance)
  if (!config) {
    throw new Error(`OJS configuration missing for instance "${instance}"`)
  }
  for (const entry of entries) {
    if (
      !entry?.submissionId ||
      !entry?.publicationId ||
      !entry?.authorId
    ) {
      summary.items.push({ ...entry, ok: false, reason: 'missing-fields' })
      continue
    }
    const url = `${config.api_endpoint}/submissions/${entry.submissionId}/publications/${entry.publicationId}/authors/${entry.authorId}?apiToken=${config.api_token}`
    const payload = { biography: entry.biography ?? {} }
    if (!apply) {
      summary.items.push({ ...entry, ok: true, dryRun: true, payload, url })
      continue
    }
    try {
      const res = await putJson(url, payload)
      if (!res.ok) {
        summary.items.push({
          ...entry,
          ok: false,
          status: res.status,
          error: res.body?.errorMessage ?? res.body?.message ?? 'put-failed',
        })
        continue
      }
      summary.items.push({ ...entry, ok: true, status: res.status })
      summary.applied += 1
    } catch (err) {
      summary.items.push({ ...entry, ok: false, error: err.message })
    }
  }
  return summary
}

module.exports = {
  pushPageNumbers,
  pushDois,
  pushAuthorBios,
}
