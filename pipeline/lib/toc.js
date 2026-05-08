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
const FRONT_MATTER_TEMPLATE = path.join(
  APP_DIR,
  'templates',
  'front_matter_template.html5'
)
const INDEX_TEMPLATE = path.join(APP_DIR, 'templates', 'index_template.html5')

/* -------------------------- helpers -------------------------- */

/**
 * The desktop renderer expects sections.articles entries with snake_case
 * keys (`section_title`, `start_page`, etc.). The graphql side ships them
 * as camelCase; project here so both shapes are accepted.
 */
function normalisePandocSections(sections) {
  if (!Array.isArray(sections)) return []
  return sections.map((s) => ({
    section_title: s.section_title || s.sectionTitle || 'Articles',
    articles: (s.articles || []).map((a) => ({
      id: a.id || '',
      title: a.title || 'Untitled',
      author: a.author || 'Unknown',
      pages: a.pages || 'N/A',
      start_page: a.start_page || a.startPage || '',
      url: a.url || (a.id ? `html/${a.id}.html` : ''),
    })),
  }))
}

/* -------------------------- runner -------------------------- */

function tocKey({ corpusId, jobId, name, ext }) {
  return `pipeline-artifacts/${corpusId}/${jobId}/${name}.${ext}`
}

async function uploadAndRecord({
  job,
  corpusId,
  diskPath,
  contentType,
  ext,
  name,
  jobs,
}) {
  const buf = await fs.readFile(diskPath)
  const key = tocKey({ corpusId, jobId: job.id, name, ext })
  await putObject({ key, body: buf, contentType })
  let url = null
  try {
    url = await getPresignedGetUrl(key, 24 * 3600)
  } catch {
    /* presign best-effort */
  }
  jobs.addArtefact(job.id, {
    kind: 'toc',
    storageKey: key,
    contentType,
    size: buf.length,
    presignedUrl: url,
    expiresIn: 24 * 3600,
  })
  return key
}

/**
 * Build a print-ready front-matter PDF (the Pandoc "front_matter_template")
 * driven by the issue + TOC sections graphql assembled. Also produces the
 * web-style `index_template` HTML for static-site export, kept alongside.
 *
 * Job params shape:
 *   {
 *     corpusId, engine,
 *     issue: { ... same shape as article-cover ... },
 *     contributors: [{ givenName, familyName }],
 *     sections: [{
 *       section_title,
 *       articles: [{ id, title, author, pages, start_page, url }]
 *     }],
 *   }
 */
async function runTocJob({ job, jobs }) {
  const { corpusId, issue, contributors = [], sections = [] } = job.params || {}
  if (!corpusId) {
    jobs.fail(job.id, new Error('params.corpusId is required'))
    return
  }
  for (const tpl of [FRONT_MATTER_TEMPLATE, INDEX_TEMPLATE]) {
    if (!fsSync.existsSync(tpl)) {
      jobs.fail(job.id, new Error(`template missing in image: ${tpl}`))
      return
    }
  }

  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  const issueCtx = buildIssueContext(issue)
  const normSections = normalisePandocSections(sections)
  const articleCount = normSections.reduce(
    (n, s) => n + (Array.isArray(s.articles) ? s.articles.length : 0),
    0
  )
  log(
    `TOC: ${issueCtx.title} (Vol. ${issueCtx.volume || '—'}) — ${
      normSections.length
    } section(s), ${articleCount} article(s), ${contributors.length} contributor(s)`
  )

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `toc-${corpusId}-`))
  try {
    const merged = {
      ...(issue || {}),
      toc_sections: normSections,
      authors: contributors,
      imageCredit: issueCtx.imageCredit,
      // legacy snake_case the older templates also accept:
      image_credit: issueCtx.imageCredit,
    }
    const stubPath = path.join(work, 'stub.md')
    const metaPath = path.join(work, 'toc_metadata.json')
    const frontHtml = path.join(work, 'front_matter.html')
    const indexHtml = path.join(work, 'index.html')
    const frontPdf = path.join(work, 'front_matter.pdf')

    await fs.writeFile(stubPath, '', 'utf-8')
    await fs.writeFile(metaPath, JSON.stringify(merged, null, 2), 'utf-8')

    log('pandoc → front_matter.html')
    {
      const { stderr } = await execFileP(
        'pandoc',
        [
          stubPath,
          `--template=${FRONT_MATTER_TEMPLATE}`,
          `--metadata-file=${metaPath}`,
          '-o',
          frontHtml,
        ],
        { cwd: work, timeout: 60_000 }
      )
      if (stderr?.trim()) log(`pandoc warning: ${stderr.trim()}`)
    }

    jobs.throwIfCancelled(job.id)
    log('pandoc → index.html (web TOC)')
    {
      const { stderr } = await execFileP(
        'pandoc',
        [
          stubPath,
          `--template=${INDEX_TEMPLATE}`,
          `--metadata-file=${metaPath}`,
          '-o',
          indexHtml,
        ],
        { cwd: work, timeout: 60_000 }
      )
      if (stderr?.trim()) log(`pandoc warning: ${stderr.trim()}`)
    }

    jobs.throwIfCancelled(job.id)
    await htmlToPdf({ htmlPaths: [frontHtml], pdfPath: frontPdf, log })

    jobs.throwIfCancelled(job.id)
    await uploadAndRecord({
      job,
      corpusId,
      diskPath: frontPdf,
      contentType: 'application/pdf',
      ext: 'pdf',
      name: 'toc',
      jobs,
    })
    await uploadAndRecord({
      job,
      corpusId,
      diskPath: indexHtml,
      contentType: 'text/html; charset=utf-8',
      ext: 'html',
      name: 'index',
      jobs,
    })
    log('TOC PDF + index HTML uploaded')
    jobs.setProgress(job.id, 1)
    jobs.setStatus(job.id, 'succeeded', {
      params: { ...job.params, sections: normSections },
    })
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

module.exports = { runTocJob, normalisePandocSections }
