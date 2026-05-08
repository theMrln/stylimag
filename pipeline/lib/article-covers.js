const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { htmlToPdf } = require('./pdf-render')
const { putObject, getPresignedGetUrl } = require('./storage')

const execFileP = promisify(execFile)
const APP_DIR = path.resolve(__dirname, '..')
const COVER_TEMPLATE = path.join(
  APP_DIR,
  'templates',
  'article_cover_template.html5'
)

/* -------------------------- value helpers -------------------------- */

function pickLocaleString(field, keys) {
  if (field == null) return ''
  if (typeof field === 'string') return field
  if (typeof field !== 'object') return ''
  for (const k of keys) {
    const v = field[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return ''
}

function asString(v) {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

function articleTitle(articleData) {
  const primary = pickLocaleString(articleData?.title, ['en', 'en_US'])
  if (primary) return primary
  const full = pickLocaleString(articleData?.fullTitle, ['en', 'en_US'])
  if (full) return full
  if (articleData?.title && typeof articleData.title === 'object') {
    for (const v of Object.values(articleData.title)) {
      if (typeof v === 'string' && v.length > 0) return v
    }
  }
  return articleData?.articleId || 'Untitled'
}

/**
 * Format the citation byline. Mirrors the bash-era jq pipeline:
 *   1 author  → "Family, Given."
 *   2 authors → "Family1, Given1, and Given2 Family2."
 *   3+        → "Family1, Given1, Given2 Family2, …, and Given_N Family_N."
 */
function formatAuthorsForCitation(articleData) {
  const arr = Array.isArray(articleData?.authors) ? articleData.authors : []
  const names = arr
    .map((a) => ({
      given: pickLocaleString(a?.givenName, ['en', 'en_US', 'fr_CA', 'fr']).trim(),
      family: pickLocaleString(a?.familyName, [
        'en',
        'en_US',
        'fr_CA',
        'fr',
      ]).trim(),
    }))
    .filter((n) => n.given || n.family)
  if (names.length === 0) {
    const fallback =
      typeof articleData?.authorsString === 'string'
        ? articleData.authorsString
        : ''
    return fallback || 'Unknown author'
  }
  if (names.length === 1) return `${names[0].family}, ${names[0].given}.`
  if (names.length === 2)
    return `${names[0].family}, ${names[0].given}, and ${names[1].given} ${names[1].family}.`
  const head = `${names[0].family}, ${names[0].given}`
  const middle = names
    .slice(1, -1)
    .map((n) => `, ${n.given} ${n.family}`)
    .join('')
  const last = names[names.length - 1]
  return `${head}${middle}, and ${last.given} ${last.family}.`
}

function buildCitation({ title, volume, number, year, pages, journalTitle }) {
  let out = ''
  if (title) out += `"${title}." `
  out += journalTitle || 'Imaginations: Journal of Cross-Cultural Image Studies'
  if (volume) out += `, Vol. ${volume}`
  if (number) out += `, No. ${number}`
  if (year) out += `, ${year}`
  if (pages) out += `, pp. ${pages}`
  out += '.'
  return out
}

function buildIssueContext(issue) {
  if (!issue || typeof issue !== 'object') {
    return {
      title: 'Untitled issue',
      volume: '',
      number: '',
      year: '',
      editorsLine: '',
      imageCredit: 'Image credit pending',
      publicationDisplay: '',
      journalTitle: '',
    }
  }
  const titleRaw = pickLocaleString(issue.title, ['en', 'en_US'])
  const volume = asString(issue.volume)
  const number = asString(issue.number)
  const year = asString(issue.year)
  const title = titleRaw || (volume ? `Vol. ${volume}` : 'Untitled issue')

  const editorsLine = Array.isArray(issue.editors)
    ? issue.editors
        .map((e) => {
          // accept both legacy snake_case and stylimag camelCase
          const given = (e?.givenName ?? e?.given_name ?? '').trim()
          const family = (e?.familyName ?? e?.family_name ?? '').trim()
          return [given, family].filter(Boolean).join(' ').trim()
        })
        .filter(Boolean)
        .join(', ')
    : ''

  let imageCredit = ''
  const ic = issue.imageCredit ?? issue.image_credit
  if (ic && typeof ic === 'object' && !Array.isArray(ic)) {
    imageCredit = pickLocaleString(ic, ['en', 'en_US', 'fr_CA', 'fr'])
  } else if (typeof ic === 'string') {
    imageCredit = ic
  }
  if (!imageCredit) imageCredit = 'Image credit pending'

  return {
    title,
    volume,
    number,
    year,
    editorsLine,
    imageCredit,
    publicationDisplay: year ? `Publication year: ${year}` : '',
    journalTitle: issue.journalTitle || '',
  }
}

/* -------------------------- pandoc render -------------------------- */

async function renderCoverHtml({
  workDir,
  metadata,
  outputHtmlPath,
  log,
}) {
  const stubPath = path.join(workDir, '.cover-stub.md')
  const metaPath = path.join(workDir, '.cover-meta.json')
  await fs.writeFile(stubPath, '', 'utf-8')
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')
  try {
    const args = [
      stubPath,
      '--standalone',
      `--template=${COVER_TEMPLATE}`,
      `--metadata-file=${metaPath}`,
      '-o',
      outputHtmlPath,
    ]
    const { stderr } = await execFileP('pandoc', args, {
      cwd: workDir,
      timeout: 60_000,
    })
    if (stderr?.trim()) log?.(`pandoc warning: ${stderr.trim()}`)
  } finally {
    await fs.rm(stubPath, { force: true })
    await fs.rm(metaPath, { force: true })
  }
}

/* -------------------------- runner -------------------------- */

function articleCoverKey({ corpusId, jobId, articleId, ext }) {
  return `pipeline-artifacts/${corpusId}/${jobId}/article-${articleId}_cover.${ext}`
}

async function uploadAndRecord({
  job,
  corpusId,
  articleId,
  diskPath,
  contentType,
  ext,
  jobs,
}) {
  const buf = await fs.readFile(diskPath)
  const key = articleCoverKey({ corpusId, jobId: job.id, articleId, ext })
  await putObject({ key, body: buf, contentType })
  let url = null
  try {
    url = await getPresignedGetUrl(key, 24 * 3600)
  } catch {
    /* presign best-effort */
  }
  jobs.addArtefact(job.id, {
    kind: 'article-cover',
    storageKey: key,
    contentType,
    size: buf.length,
    presignedUrl: url,
    expiresIn: 24 * 3600,
  })
  return key
}

/**
 * Build per-article cover pages for an entire corpus.
 *
 * Job params shape (graphql resolver assembles this):
 *   {
 *     corpusId,
 *     engine: 'paged' | 'prince',
 *     issue: {
 *       title, volume, number, year, editors[], imageCredit, journalTitle?,
 *     },
 *     articles: [{
 *       articleId,
 *       articleData: { title, authors, doi, datePublished, pages, ... }
 *     }],
 *   }
 *
 * Each article produces an `article-cover` PDF artefact in MinIO. The
 * complete-issue runner merges them with their corresponding article PDFs
 * later (no qpdf dep).
 */
async function runArticleCoverJob({ job, jobs }) {
  const { corpusId, articles, issue } = job.params || {}
  const engine = job.params?.engine === 'prince' ? 'prince' : 'paged'
  if (!corpusId || !Array.isArray(articles) || articles.length === 0) {
    jobs.fail(job.id, new Error('params.articles[] is empty'))
    return
  }

  const log = (msg) => jobs.appendLog(job.id, msg)
  const issueCtx = buildIssueContext(issue)
  jobs.setStatus(job.id, 'running')
  log(
    `Issue: ${issueCtx.title} (Vol. ${issueCtx.volume || '—'}, No. ${
      issueCtx.number || '—'
    }, ${issueCtx.year || '—'}) — ${articles.length} article(s)`
  )

  for (let i = 0; i < articles.length; i++) {
    jobs.throwIfCancelled(job.id)
    const item = articles[i]
    const articleId = item.articleId
    const articleData = item.articleData || {}

    const work = await fs.mkdtemp(path.join(os.tmpdir(), `cover-${articleId}-`))
    try {
      const title = articleTitle({ ...articleData, articleId })
      const pages =
        typeof articleData.pages === 'string' ? articleData.pages : ''
      const doi =
        (typeof articleData['pub-id::doi'] === 'string' &&
          articleData['pub-id::doi']) ||
        (typeof articleData.doi === 'string' && articleData.doi) ||
        'pending'
      const datePublished =
        typeof articleData.datePublished === 'string' &&
        articleData.datePublished !== 'null'
          ? articleData.datePublished
          : ''

      const metadata = {
        title: { en_US: title },
        the_issue_title: issueCtx.title,
        the_editors: issueCtx.editorsLine,
        the_publication_date: datePublished
          ? `Published: ${datePublished}`
          : issueCtx.publicationDisplay,
        the_image_credit: issueCtx.imageCredit,
        the_authors: formatAuthorsForCitation(articleData),
        the_citation: buildCitation({
          title,
          volume: issueCtx.volume,
          number: issueCtx.number,
          year: issueCtx.year,
          pages,
          journalTitle: issueCtx.journalTitle,
        }),
        the_doi: doi,
      }

      const htmlPath = path.join(work, `cover-${articleId}.html`)
      const pdfPath = path.join(work, `cover-${articleId}.pdf`)

      log(`── (${i + 1}/${articles.length}) ${articleId} — ${title}`)
      await renderCoverHtml({
        workDir: work,
        metadata,
        outputHtmlPath: htmlPath,
        log,
      })

      jobs.throwIfCancelled(job.id)
      await htmlToPdf({ engine, htmlPaths: [htmlPath], pdfPath, log })

      jobs.throwIfCancelled(job.id)
      await uploadAndRecord({
        job,
        corpusId,
        articleId,
        diskPath: pdfPath,
        contentType: 'application/pdf',
        ext: 'pdf',
        jobs,
      })
      log(`[${articleId}] cover uploaded`)
    } catch (err) {
      if (err?.cancelled) throw err
      log(`[${articleId}] FAILED: ${err.message}`)
    } finally {
      await fs.rm(work, { recursive: true, force: true })
    }
    jobs.setProgress(job.id, (i + 1) / articles.length)
  }

  jobs.setStatus(job.id, 'succeeded')
  log(`Article covers finished — ${articles.length} processed`)
}

module.exports = {
  runArticleCoverJob,
  buildIssueContext,
  formatAuthorsForCitation,
  buildCitation,
  articleTitle,
}
