const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { mdToHtml } = require('./pandoc')
const { htmlToPdf } = require('./paged-js')
const { putObject, getPresignedGetUrl } = require('./storage')

function articleArtefactKey({ corpusId, jobId, articleId, ext }) {
  return `pipeline-artifacts/${corpusId}/${jobId}/article-${articleId}.${ext}`
}

async function uploadAndRecord({
  job,
  corpusId,
  articleId,
  diskPath,
  contentType,
  ext,
  kind,
  jobs,
}) {
  const buf = await fs.readFile(diskPath)
  const key = articleArtefactKey({
    corpusId,
    jobId: job.id,
    articleId,
    ext,
  })
  await putObject({ key, body: buf, contentType })
  const url = await getPresignedGetUrl(key, 24 * 3600)
  jobs.addArtefact(job.id, {
    kind,
    storageKey: key,
    contentType,
    size: buf.length,
    presignedUrl: url,
    expiresIn: 24 * 3600,
  })
}

/**
 * Run the article-pdf job end-to-end.
 * Job params: { articleId, corpusId, markdown, engine }
 *
 * Embedded media is currently expected to be base64'd or referenced via http URLs
 * inside the markdown — no media downloading happens here yet (that lands when
 * we wire the asset map through in Phase 3).
 */
async function runArticlePdfJob({ job, jobs }) {
  const { articleId, corpusId, markdown } = job.params
  const engine = job.params.engine === 'prince' ? 'prince' : 'paged'
  const log = (msg) => jobs.appendLog(job.id, msg)

  jobs.setStatus(job.id, 'running')
  jobs.setProgress(job.id, 0.05)

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `article-${articleId}-`))
  try {
    const mdPath = path.join(work, `article-${articleId}.md`)
    const htmlPath = path.join(work, `article-${articleId}.html`)
    const pdfPath = path.join(work, `article-${articleId}.pdf`)

    await fs.writeFile(mdPath, markdown, 'utf8')
    log(`Wrote markdown to scratch dir (${work})`)
    jobs.setProgress(job.id, 0.15)

    await mdToHtml({
      mdPath,
      htmlPath,
      workDir: work,
      engine,
      log,
    })
    jobs.setProgress(job.id, 0.45)
    await uploadAndRecord({
      job,
      corpusId,
      articleId,
      diskPath: htmlPath,
      contentType: 'text/html; charset=utf-8',
      ext: 'html',
      kind: 'article-html',
      jobs,
    })
    log('HTML uploaded to object storage')

    await htmlToPdf({ htmlPaths: [htmlPath], pdfPath, log })
    jobs.setProgress(job.id, 0.9)
    await uploadAndRecord({
      job,
      corpusId,
      articleId,
      diskPath: pdfPath,
      contentType: 'application/pdf',
      ext: 'pdf',
      kind: 'article-pdf',
      jobs,
    })
    log('PDF uploaded to object storage')

    jobs.setProgress(job.id, 1)
    jobs.setStatus(job.id, 'succeeded')
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

module.exports = { runArticlePdfJob }
