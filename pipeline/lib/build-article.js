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
  const { articleId, corpusId, markdown, pipelineSettings } = job.params
  const engine = job.params.engine === 'prince' ? 'prince' : 'paged'
  const log = (msg) => jobs.appendLog(job.id, msg)

  jobs.setStatus(job.id, 'running')
  jobs.setProgress(job.id, 0.05)

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `article-${articleId}-`))
  try {
    jobs.throwIfCancelled(job.id)
    const mdPath = path.join(work, `article-${articleId}.md`)
    const htmlPath = path.join(work, `article-${articleId}.html`)
    const pdfPath = path.join(work, `article-${articleId}.pdf`)

    await fs.writeFile(mdPath, markdown, 'utf8')
    log(`Wrote markdown to scratch dir (${work})`)
    jobs.setProgress(job.id, 0.15)

    jobs.throwIfCancelled(job.id)
    await mdToHtml({
      mdPath,
      htmlPath,
      workDir: work,
      engine,
      pipelineSettings,
      log,
    })
    jobs.setProgress(job.id, 0.45)
    jobs.throwIfCancelled(job.id)

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

    jobs.throwIfCancelled(job.id)
    await htmlToPdf({ htmlPaths: [htmlPath], pdfPath, log })
    jobs.setProgress(job.id, 0.9)
    jobs.throwIfCancelled(job.id)

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
  } catch (err) {
    if (err instanceof jobs.CancelledError) {
      log('Job was cancelled before completion; cleaning up scratch dir.')
      // status was already set to 'cancelled' by /jobs/:id/cancel
      return
    }
    throw err
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

/**
 * Batch build runner: iterates over a list of articles, building each one
 * through the article-pdf pipeline. Progress is reported as fraction of
 * articles completed; per-article logs are prefixed with the article id.
 *
 * Each item in params.articles must be { articleId, markdown }. Failures of
 * individual articles do not abort the batch — the runner records them and
 * continues, then reports `succeeded` if any made it through. If every
 * article fails the job is marked `failed` so the UI surfaces the problem.
 */
async function runBatchBuildJob({ job, jobs }) {
  const items = Array.isArray(job.params.articles) ? job.params.articles : []
  if (items.length === 0) {
    jobs.fail(job.id, new Error('batch params.articles is empty'))
    return
  }
  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  log(`Batch start: ${items.length} article(s)`)

  const results = { succeeded: [], failed: [] }
  for (let i = 0; i < items.length; i++) {
    jobs.throwIfCancelled(job.id)
    const item = items[i]
    log(`── (${i + 1}/${items.length}) ${item.articleId} ──`)
    // Reuse the single-article runner via a synthetic sub-job context that
    // shares the parent job's id (so logs/artefacts/progress tee through).
    const subParams = {
      articleId: item.articleId,
      corpusId: job.params.corpusId,
      markdown: item.markdown,
      engine: job.params.engine || 'paged',
      pipelineSettings: job.params.pipelineSettings || {},
    }
    try {
      await runArticlePdfJob({
        job: { ...job, params: subParams },
        jobs,
      })
      results.succeeded.push(item.articleId)
    } catch (err) {
      if (err?.cancelled) throw err
      log(`[${item.articleId}] FAILED: ${err.message}`)
      results.failed.push({ articleId: item.articleId, error: err.message })
    }
    jobs.setProgress(job.id, (i + 1) / items.length)
  }

  log(
    `Batch finished — ${results.succeeded.length} succeeded, ${results.failed.length} failed`
  )
  // setStatus to 'succeeded' even if some articles failed — the dashboard
  // surfaces per-article failure via individual artefacts/logs. If every
  // article failed we mark the whole job as failed instead.
  if (results.succeeded.length === 0 && results.failed.length > 0) {
    jobs.fail(job.id, new Error('every article in the batch failed'))
  } else {
    jobs.setStatus(job.id, 'succeeded', {
      params: { ...job.params, results },
    })
  }
}

/**
 * Stub runner for artefact types that haven't been ported yet from
 * imaginations-issue-template (covers / TOC / front-page / complete-issue).
 * Marks the job as failed with a clear "not yet implemented" message so the
 * UI surfaces the gap honestly. The schema + resolver surface is in place
 * already, so the wiring ahead lands without rework.
 */
function makeNotImplementedRunner(typeLabel) {
  return async function notImplementedRunner({ job, jobs }) {
    jobs.setStatus(job.id, 'running')
    jobs.appendLog(
      job.id,
      `${typeLabel} runner not yet implemented in this build of the pipeline. The job has been recorded so the UI can show the request, but no artefact will be produced.`
    )
    jobs.fail(
      job.id,
      new Error(
        `${typeLabel} is not yet implemented in the pipeline service`
      )
    )
  }
}

module.exports = {
  runArticlePdfJob,
  runBatchBuildJob,
  makeNotImplementedRunner,
}
