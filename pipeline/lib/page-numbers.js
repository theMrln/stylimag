const { PDFDocument } = require('pdf-lib')
const { getObjectBuffer } = require('./storage')

/**
 * Count pages in a PDF stored in object storage. Replaces
 * imaginations-issue-template's pdfium_bundle native dep with the pure-JS
 * pdf-lib (no native libraries to ship in the container image).
 */
async function countPagesByStorageKey(storageKey) {
  const buf = await getObjectBuffer(storageKey)
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
  return pdf.getPageCount()
}

/**
 * Run the page-numbers job: for each article in `params.articles`, fetch
 * its `article-pdf` artefact, count pages, and accumulate start_page across
 * the issue (article 1 starts at startPage, article 2 at start+pages1, …).
 *
 * Job params: {
 *   corpusId, startPage = 1,
 *   articles: [{ articleId, storageKey }],
 * }
 *
 * Result is written to job.params.results so the graphql resolver can read
 * it back over /jobs/:id and apply it to each article's YAML.
 */
async function runPageNumbersJob({ job, jobs }) {
  const { articles, startPage = 1 } = job.params || {}
  if (!Array.isArray(articles) || articles.length === 0) {
    jobs.fail(job.id, new Error('params.articles[] is empty'))
    return
  }
  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  log(`Probing ${articles.length} article PDF(s) for page counts`)

  const results = []
  let cursor = startPage
  for (let i = 0; i < articles.length; i++) {
    jobs.throwIfCancelled(job.id)
    const item = articles[i]
    if (!item.storageKey) {
      log(`[${item.articleId}] no PDF storageKey — skipping`)
      results.push({
        articleId: item.articleId,
        startPage: null,
        pageCount: null,
        error: 'missing-pdf',
      })
      continue
    }
    try {
      const pageCount = await countPagesByStorageKey(item.storageKey)
      const start = cursor
      cursor += pageCount
      log(
        `[${item.articleId}] ${pageCount} page(s) — start_page=${start}, next=${cursor}`
      )
      results.push({
        articleId: item.articleId,
        startPage: start,
        pageCount,
      })
    } catch (err) {
      log(`[${item.articleId}] FAILED: ${err.message}`)
      results.push({
        articleId: item.articleId,
        startPage: null,
        pageCount: null,
        error: err.message,
      })
    }
    jobs.setProgress(job.id, (i + 1) / articles.length)
  }

  jobs.setStatus(job.id, 'succeeded', {
    params: { ...job.params, results },
  })
  log(`Done. Issue spans pages ${startPage}-${cursor - 1}.`)
}

module.exports = {
  countPagesByStorageKey,
  runPageNumbersJob,
}
