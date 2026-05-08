const { PDFDocument } = require('pdf-lib')

const { putObject, getObjectBuffer, getPresignedGetUrl } = require('./storage')

/* -------------------------- pdf merge -------------------------- */

/**
 * Merge a list of PDFs (passed in as MinIO storage keys) into a single
 * PDF using pdf-lib — pure JS, no external `qpdf` / `prince` dependency.
 *
 * Returns a Buffer containing the merged PDF.
 */
async function mergePdfs({ keys, log }) {
  const out = await PDFDocument.create()
  let pageTotal = 0
  for (const key of keys) {
    const buf = await getObjectBuffer(key)
    const src = await PDFDocument.load(buf, { ignoreEncryption: true })
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
    pageTotal += pages.length
    log?.(`merged ${pages.length} page(s) ← ${key}`)
  }
  log?.(`combined PDF: ${pageTotal} page(s) total`)
  return Buffer.from(await out.save())
}

/* -------------------------- runner -------------------------- */

function completeIssueKey({ corpusId, jobId }) {
  return `pipeline-artifacts/${corpusId}/${jobId}/complete-issue.pdf`
}

/**
 * Assemble the complete-issue PDF from the per-corpus artefacts graphql
 * already produced. The runner does no rendering of its own — it merges
 * existing PDFs.
 *
 * Job params shape:
 *   {
 *     corpusId,
 *     parts: [
 *       { kind: 'front-page',    storageKey, label? },
 *       { kind: 'toc',           storageKey, label? },
 *       { kind: 'article-cover', storageKey, articleId? },
 *       { kind: 'article-pdf',   storageKey, articleId? },
 *       …
 *     ]
 *   }
 *
 * Order in `parts[]` is the order in the merged PDF — graphql is the one
 * that decides (cover, then TOC, then for each article: cover + body).
 */
async function runCompleteIssueJob({ job, jobs }) {
  const { corpusId, parts } = job.params || {}
  if (!corpusId) {
    jobs.fail(job.id, new Error('params.corpusId is required'))
    return
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    jobs.fail(job.id, new Error('params.parts[] is empty'))
    return
  }

  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  log(`complete-issue: merging ${parts.length} part(s)`)

  const keys = []
  for (let i = 0; i < parts.length; i++) {
    jobs.throwIfCancelled(job.id)
    const part = parts[i]
    if (!part?.storageKey) {
      log(
        `[part ${i}] skipped (${part?.kind || 'unknown'} missing storageKey${
          part?.articleId ? ` for ${part.articleId}` : ''
        })`
      )
      continue
    }
    keys.push(part.storageKey)
    jobs.setProgress(job.id, ((i + 1) / parts.length) * 0.5)
  }
  if (keys.length === 0) {
    jobs.fail(job.id, new Error('No usable parts (every storageKey was missing)'))
    return
  }

  const buf = await mergePdfs({ keys, log })
  jobs.throwIfCancelled(job.id)
  jobs.setProgress(job.id, 0.95)

  const key = completeIssueKey({ corpusId, jobId: job.id })
  await putObject({ key, body: buf, contentType: 'application/pdf' })
  let url = null
  try {
    url = await getPresignedGetUrl(key, 24 * 3600)
  } catch {
    /* presign best-effort */
  }
  jobs.addArtefact(job.id, {
    kind: 'complete-issue',
    storageKey: key,
    contentType: 'application/pdf',
    size: buf.length,
    presignedUrl: url,
    expiresIn: 24 * 3600,
  })

  jobs.setProgress(job.id, 1)
  jobs.setStatus(job.id, 'succeeded')
  log('complete-issue PDF uploaded')
}

module.exports = { runCompleteIssueJob, mergePdfs }
