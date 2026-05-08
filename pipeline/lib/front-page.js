const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { htmlToPdf } = require('./paged-js')
const { putObject, getPresignedGetUrl } = require('./storage')
const { buildIssueContext } = require('./article-covers')

const execFileP = promisify(execFile)
const APP_DIR = path.resolve(__dirname, '..')
const TEMPLATE = path.join(APP_DIR, 'templates', 'front_page_template.html5')
const POPPLER_DPI = 150

/* -------------------------- helpers -------------------------- */

function pickLocaleString(field, keys) {
  if (field == null) return ''
  if (typeof field === 'string') return field
  if (typeof field !== 'object') return ''
  for (const k of keys) {
    const v = field[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * Resolve the front-page cover image URL: prefer https URLs from the issue
 * payload, fall back to the bundled placeholder. The desktop port also
 * checked for a local file inside the data dir; in stylimag we don't have
 * a per-issue local data dir, so https is the only workable remote source.
 */
function resolveCoverImageUrl(issue) {
  const url = pickLocaleString(issue?.coverImageUrl, ['en', 'en_US', 'fr_CA'])
  if (/^https?:\/\//i.test(url)) return url
  return 'img/issue_cover_img.png'
}

/* -------------------------- runner -------------------------- */

function artefactKey({ corpusId, jobId, name, ext }) {
  return `pipeline-artifacts/${corpusId}/${jobId}/${name}.${ext}`
}

async function uploadAndRecord({
  job,
  corpusId,
  diskPath,
  contentType,
  ext,
  name,
  kind,
  jobs,
}) {
  const buf = await fs.readFile(diskPath)
  const key = artefactKey({ corpusId, jobId: job.id, name, ext })
  await putObject({ key, body: buf, contentType })
  let url = null
  try {
    url = await getPresignedGetUrl(key, 24 * 3600)
  } catch {
    /* presign best-effort */
  }
  jobs.addArtefact(job.id, {
    kind,
    storageKey: key,
    contentType,
    size: buf.length,
    presignedUrl: url,
    expiresIn: 24 * 3600,
  })
  return key
}

/**
 * Best-effort PDF → PNG rasterisation of page 1 via Poppler's `pdftoppm`.
 * Bundled into the pipeline image (poppler-utils). Returns the disk path
 * on success or `null` on failure — failures are logged but never fatal,
 * so a missing/broken Poppler doesn't take down the whole front-page job.
 */
async function rasterisePdfPage1({ pdfPath, workDir, log }) {
  const prefix = path.join(workDir, 'cover-thumbnail')
  const pngPath = `${prefix}.png`
  try {
    const { stderr } = await execFileP(
      'pdftoppm',
      ['-png', '-singlefile', '-r', String(POPPLER_DPI), pdfPath, prefix],
      { timeout: 60_000 }
    )
    if (stderr?.trim()) log?.(`pdftoppm: ${stderr.trim()}`)
    await fs.access(pngPath)
    return pngPath
  } catch (err) {
    log?.(
      `pdftoppm not available or failed (${err.message}). Skipping cover-thumbnail.`
    )
    await fs.rm(pngPath, { force: true })
    return null
  }
}

/**
 * Render the issue front page (cover + masthead).
 *
 * Job params shape:
 *   { corpusId, engine, issue: {...}, contributors: [{ givenName, familyName }] }
 *
 * The issue payload contains the same fields as for article-cover plus
 * an optional `coverImageUrl` (locale-keyed). Contributors are aggregated
 * graphql-side from each article's workingVersion.metadata.authors and
 * spliced into the pandoc metadata under the `authors` key the template
 * already consumes.
 */
async function runFrontPageJob({ job, jobs }) {
  const { corpusId, issue, contributors = [] } = job.params || {}
  if (!corpusId) {
    jobs.fail(job.id, new Error('params.corpusId is required'))
    return
  }
  if (!fsSync.existsSync(TEMPLATE)) {
    jobs.fail(
      job.id,
      new Error(`front-page template missing in image: ${TEMPLATE}`)
    )
    return
  }

  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  const issueCtx = buildIssueContext(issue)
  log(
    `Front page: ${issueCtx.title} (Vol. ${issueCtx.volume || '—'}, No. ${
      issueCtx.number || '—'
    }, ${issueCtx.year || '—'}) — ${contributors.length} contributor(s)`
  )

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `front-${corpusId}-`))
  try {
    // Pandoc's front_page_template.html5 reads the same shape as the
    // legacy `issue_<id>.json`. Pass the raw issue + contributors + the
    // resolved cover image as `front_page_cover_image`.
    const metadata = {
      ...(issue || {}),
      authors: contributors,
      front_page_cover_image: resolveCoverImageUrl(issue),
    }
    const stubPath = path.join(work, 'stub.md')
    const metaPath = path.join(work, 'meta.json')
    const htmlPath = path.join(work, 'front_page.html')
    const pdfPath = path.join(work, 'front_page.pdf')

    await fs.writeFile(stubPath, '', 'utf-8')
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')

    log(`pandoc → ${path.basename(htmlPath)} (template: front_page_template.html5)`)
    const { stderr } = await execFileP(
      'pandoc',
      [
        stubPath,
        `--template=${TEMPLATE}`,
        `--metadata-file=${metaPath}`,
        '-o',
        htmlPath,
      ],
      { cwd: work, timeout: 60_000 }
    )
    if (stderr?.trim()) log(`pandoc warning: ${stderr.trim()}`)

    jobs.throwIfCancelled(job.id)
    await htmlToPdf({ htmlPaths: [htmlPath], pdfPath, log })

    jobs.throwIfCancelled(job.id)
    await uploadAndRecord({
      job,
      corpusId,
      diskPath: pdfPath,
      contentType: 'application/pdf',
      ext: 'pdf',
      name: 'front-page',
      kind: 'front-page',
      jobs,
    })
    log('front-page PDF uploaded')

    jobs.throwIfCancelled(job.id)
    jobs.setProgress(job.id, 0.85)
    const pngPath = await rasterisePdfPage1({ pdfPath, workDir: work, log })
    if (pngPath) {
      await uploadAndRecord({
        job,
        corpusId,
        diskPath: pngPath,
        contentType: 'image/png',
        ext: 'png',
        name: 'cover-thumbnail',
        kind: 'cover-thumbnail',
        jobs,
      })
      log('cover-thumbnail PNG uploaded')
    }

    jobs.setProgress(job.id, 1)
    jobs.setStatus(job.id, 'succeeded')
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

module.exports = { runFrontPageJob }
