import { applicationConfig } from '../config.js'

/**
 * Ask the backend to fetch an export URL produced by the pandoc-export service
 * and persist it as an `ExportArtifact` in object storage. This is a
 * fire-and-forget side-effect: the user keeps getting the direct download, and
 * we additionally archive it.
 *
 * @param {object} params
 * @param {string} params.url - Full export URL generated client-side
 * @param {string} params.articleId
 * @param {string} [params.versionId]
 * @param {string} params.format - 'html' | 'pdf' | 'docx' | 'tex' | 'epub' | 'other'
 * @param {string} [params.optionsHash] - opaque string capturing export options
 * @returns {Promise<{id: string, url: string, format: string}|null>}
 */
export async function persistExportFromUrl({
  url,
  articleId,
  versionId,
  format,
  optionsHash,
}) {
  if (!applicationConfig.backendEndpoint || !articleId || !url || !format) {
    return null
  }
  try {
    const response = await fetch(
      `${applicationConfig.backendEndpoint}/assets/exports/from-url`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          articleId,
          versionId: versionId || undefined,
          format,
          optionsHash: optionsHash || undefined,
        }),
      }
    )
    if (!response.ok) {
      let body = ''
      try {
        body = JSON.stringify(await response.json())
      } catch {
        // ignore
      }
      console.warn(
        `Export persistence failed (${response.status}): ${body}`
      )
      return null
    }
    return await response.json()
  } catch (error) {
    console.warn('Export persistence request failed', error)
    return null
  }
}

/**
 * Infer a crude export format key from the pandoc-export `formats` query value.
 *
 * @param {string} formats - e.g. "html", "pdf", "originals,html"
 * @returns {string}
 */
export function inferExportFormat(formats) {
  if (!formats) {
    return 'other'
  }
  const first = String(formats).split(',').map((s) => s.trim()).find(Boolean)
  switch (first) {
    case 'html':
    case 'pdf':
    case 'docx':
    case 'tex':
    case 'epub':
      return first
    default:
      return 'other'
  }
}
