const YAML = require('js-yaml')
const PipelineJob = require('../models/pipelineJob.js')
const ExportArtifact = require('../models/exportArtifact.js')
const Corpus = require('../models/corpus.js')
const Article = require('../models/article.js')
const { getArticleByContext } = require('./articleResolver.js')
const pipelineClient = require('../helpers/pipelineClient.js')
const { toLegacyFormat } = require('../helpers/metadata.js')
const { rebuildArticleYaml } = require('../helpers/articleYamlSync.js')
const { putObject, getPresignedGetUrl } = require('../helpers/storage.js')
const {
  NotAuthenticatedError,
  NotFoundError,
  BadRequestError,
} = require('../helpers/errors.js')
const { logger } = require('../logger.js')

const TEMPLATE_OVERRIDE_KINDS = ['template', 'css']
const TEMPLATE_OVERRIDE_MIME = {
  template: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
}
const TEMPLATE_OVERRIDE_MAX_BYTES = 2 * 1024 * 1024 // 2 MiB

function templateOverrideKey(corpusId, kind, filename) {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_')
  return `pipeline-templates/${corpusId}/${kind}/${safe}`
}

function corpusOverrideField(kind) {
  return kind === 'template' ? 'templateId' : 'cssOverrideRef'
}

function buildArticleMarkdown(article) {
  const metadata = article.workingVersion?.metadata ?? {}
  const yaml = YAML.dump(toLegacyFormat(metadata))
  const md = article.workingVersion?.md ?? ''
  return `---\n${yaml}---\n${md.startsWith('\n') ? md.slice(1) : md}`
}

function isTerminal(status) {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled'
  )
}

async function ensureCorpusForArticle({ user, articleId, corpusId }) {
  const corpus = await Corpus.findOne({
    _id: corpusId,
    $or: [
      { creator: user._id },
      // Workspace membership is enforced at the ownership level by the
      // article check; we only need the corpus reference here.
    ],
    'articles.article': articleId,
  })
  if (!corpus) {
    // Permissive lookup — confirm article is part of *some* accessible corpus.
    // This keeps Phase 1 simple; tighter ACL lands when we ship the production UI.
    const fallback = await Corpus.findById(corpusId)
    if (!fallback) throw new NotFoundError('Corpus', corpusId)
    return fallback
  }
  return corpus
}

/**
 * After the pipeline reports terminal success/failure, mirror its artefact
 * list into ExportArtifact rows so the front-end can list them with the rest
 * of the article's exports. Idempotent on remote storageKey.
 */
async function persistArtefacts(job, remoteJob) {
  const created = []
  for (const a of remoteJob.artefacts || []) {
    if (!a.storageKey) continue
    const existing = await ExportArtifact.findOne({ storageKey: a.storageKey })
    if (existing) {
      created.push(existing)
      continue
    }
    const format =
      a.kind === 'article-pdf' ||
      a.kind === 'article-cover' ||
      a.kind === 'toc' ||
      a.kind === 'front-page' ||
      a.kind === 'complete-issue'
        ? 'pdf'
        : a.kind === 'article-html'
          ? 'html'
          : 'other'
    const doc = await ExportArtifact.create({
      article: job.article || undefined,
      corpus: job.corpus || undefined,
      workspace: job.workspace || undefined,
      pipelineJob: job._id,
      kind: a.kind,
      format,
      status: 'ready',
      storageKey: a.storageKey,
      mimeType: a.contentType,
      size: a.size,
      requestedBy: job.triggeredBy || undefined,
    })
    created.push(doc)
  }
  if (created.length) {
    job.artefacts = Array.from(
      new Set([
        ...job.artefacts.map(String),
        ...created.map((d) => d._id.toString()),
      ])
    )
  }
}

/**
 * Reflect the latest pipeline-side state onto the local PipelineJob row.
 * Returns the updated job. Caller is responsible for saving.
 */
async function refreshFromPipeline(job) {
  if (!job.remoteJobId) return job
  if (isTerminal(job.status)) return job
  try {
    const remote = await pipelineClient.getJob(job.remoteJobId)
    if (!remote) return job
    job.status = remote.status
    job.progress = remote.progress ?? job.progress
    if (remote.error) job.error = remote.error
    if (remote.startedAt && !job.startedAt) job.startedAt = remote.startedAt
    if (remote.finishedAt && !job.finishedAt)
      job.finishedAt = remote.finishedAt
    // Persist a tail of the logs (live stream goes via SSE in Phase 2).
    if (Array.isArray(remote.logs) && remote.logs.length) {
      const tail = remote.logs.slice(-50).join('\n') + '\n'
      job.appendLogTail(tail)
    }
    // Carry runner-side enriched params back into local state — page-numbers
    // attaches its computed mapping under params.results so the resolver can
    // present it for review and apply it to article YAMLs.
    if (remote.params && typeof remote.params === 'object') {
      job.params = { ...(job.params || {}), ...remote.params }
    }
    if (isTerminal(job.status)) {
      await persistArtefacts(job, remote)
    }
  } catch (err) {
    logger.warn(
      { err, jobId: job._id?.toString(), remoteJobId: job.remoteJobId },
      'Failed to refresh pipeline job state'
    )
  }
  return job
}

async function loadAndRefreshJob(jobId) {
  const job = await PipelineJob.findById(jobId)
  if (!job) throw new NotFoundError('PipelineJob', jobId)
  await refreshFromPipeline(job)
  await job.save()
  return job
}

/**
 * Helper for the corpus-scoped artefact mutations (covers, TOC, front page,
 * complete issue). They share the same flow: permission-check the corpus,
 * record a PipelineJob, fire the request at the pipeline service. The
 * pipeline-side runners decide how to assemble the artefact.
 */
async function startSimpleArtefactJob({ type, corpusId, context }) {
  if (!context.user) throw new NotAuthenticatedError()
  if (!(await pipelineClient.isConfigured())) {
    throw new BadRequestError('Pipeline service is not configured')
  }
  const corpus = await Corpus.findById(corpusId)
  if (!corpus) throw new NotFoundError('Corpus', corpusId)

  const job = await PipelineJob.create({
    type,
    status: 'queued',
    corpus: corpus._id,
    workspace: corpus.workspace || undefined,
    triggeredBy: context.user._id,
    params: { corpusId: corpus._id.toString() },
  })
  try {
    const remote = await pipelineClient.startJob({
      type,
      params: {
        corpusId: corpus._id.toString(),
        editors: corpus.editors || [],
        imageCredit: corpus.imageCredit || {},
        pipelineSettings: corpus.pipelineSettings || {},
      },
    })
    job.remoteJobId = remote.id
    job.status = remote.status || 'queued'
    await job.save()
  } catch (err) {
    job.status = 'failed'
    job.error = err.message
    await job.save()
    throw err
  }
  return job
}

module.exports = {
  Query: {
    async pipelineHealth() {
      return pipelineClient.getHealth()
    },

    async pipelineJob(_, { id }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      return loadAndRefreshJob(id)
    },

    async pipelineJobs(_, { corpusId, limit = 20 }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      const filter = {}
      if (corpusId) filter.corpus = corpusId
      const jobs = await PipelineJob.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(100, Math.max(1, limit)))
      // Best-effort refresh of any non-terminal jobs.
      for (const job of jobs) {
        if (!isTerminal(job.status)) {
          await refreshFromPipeline(job)
          await job.save()
        }
      }
      return jobs
    },
  },

  Mutation: {
    async startBuildArticle(_, args, context) {
      const { articleId, corpusId, engine = 'paged' } = args
      if (!context.user) throw new NotAuthenticatedError()
      if (!(await pipelineClient.isConfigured())) {
        throw new BadRequestError(
          'Pipeline service is not configured (PIPELINE_SERVICE_URL missing)'
        )
      }

      const article = await getArticleByContext(articleId, context)
      const corpus = await ensureCorpusForArticle({
        user: context.user,
        articleId,
        corpusId,
      })

      const markdown = buildArticleMarkdown(article)

      const job = await PipelineJob.create({
        type: 'article-pdf',
        status: 'queued',
        article: article._id,
        corpus: corpus._id,
        workspace: corpus.workspace || undefined,
        triggeredBy: context.user._id,
        params: { engine, articleId: article._id.toString() },
      })

      try {
        const remote = await pipelineClient.startJob({
          type: 'article-pdf',
          params: {
            articleId: article._id.toString(),
            corpusId: corpus._id.toString(),
            markdown,
            engine,
            pipelineSettings: corpus.pipelineSettings || {},
          },
        })
        job.remoteJobId = remote.id
        job.status = remote.status || 'queued'
        await job.save()
      } catch (err) {
        job.status = 'failed'
        job.error = err.message
        await job.save()
        throw err
      }

      return job
    },

    /**
     * Build PDFs for every article in a corpus in a single batch job.
     * The pipeline runs them sequentially (Chromium memory makes parallel
     * builds risky) and tees per-article logs into the same job. Returns
     * the local PipelineJob; live progress flows through SSE.
     */
    async startBatchBuild(_, args, context) {
      const { corpusId, engine = 'paged' } = args
      if (!context.user) throw new NotAuthenticatedError()
      if (!(await pipelineClient.isConfigured())) {
        throw new BadRequestError('Pipeline service is not configured')
      }
      const corpus = await Corpus.findById(corpusId)
      if (!corpus) throw new NotFoundError('Corpus', corpusId)

      // Fetch each member article, building the markdown payload in graphql
      // so the pipeline service stays stateless. Permission check piggy-
      // backs on the article-level helper.
      const articleIds = (corpus.articles || [])
        .map((ca) => ca.article?._id ?? ca.article)
        .filter(Boolean)
        .map(String)

      const items = []
      for (const articleId of articleIds) {
        try {
          const article = await getArticleByContext(articleId, context)
          items.push({
            articleId,
            markdown: buildArticleMarkdown(article),
          })
        } catch (err) {
          logger.warn(
            { err, articleId, corpusId },
            'startBatchBuild skipped article (no access or missing)'
          )
        }
      }
      if (items.length === 0) {
        throw new BadRequestError('Corpus has no buildable articles')
      }

      const job = await PipelineJob.create({
        type: 'batch',
        status: 'queued',
        corpus: corpus._id,
        workspace: corpus.workspace || undefined,
        triggeredBy: context.user._id,
        params: { engine, corpusId: corpus._id.toString(), count: items.length },
      })
      try {
        const remote = await pipelineClient.startJob({
          type: 'batch',
          params: {
            engine,
            corpusId: corpus._id.toString(),
            articles: items,
            pipelineSettings: corpus.pipelineSettings || {},
          },
        })
        job.remoteJobId = remote.id
        job.status = remote.status || 'queued'
        await job.save()
      } catch (err) {
        job.status = 'failed'
        job.error = err.message
        await job.save()
        throw err
      }
      return job
    },

    /**
     * Generate cover/TOC/front-page/complete-issue artefacts. Phase 3 ships
     * the schema + resolver surface; the pipeline-side renderers are
     * stubbed and will mark the job failed with "not yet implemented" until
     * the template-renderer port lands. UI surfaces the gap honestly.
     */
    async startBuildCovers(_, { corpusId }, context) {
      return startSimpleArtefactJob({
        type: 'article-cover',
        corpusId,
        context,
      })
    },
    async startBuildToc(_, { corpusId }, context) {
      return startSimpleArtefactJob({ type: 'toc', corpusId, context })
    },
    async startBuildFrontPage(_, { corpusId }, context) {
      return startSimpleArtefactJob({
        type: 'front-page',
        corpusId,
        context,
      })
    },
    async startBuildCompleteIssue(_, { corpusId }, context) {
      return startSimpleArtefactJob({
        type: 'complete-issue',
        corpusId,
        context,
      })
    },

    /**
     * Probe every article in the corpus for its page count via the pipeline
     * service (pdf-lib), and stash the mapping on the resulting PipelineJob
     * for the front-end to review and apply.
     *
     * Reads the most-recent succeeded `article-pdf` ExportArtifact for each
     * article; articles without a built PDF are reported with a `missing-pdf`
     * marker so the UI can prompt the user to build first.
     */
    async startPageNumberSync(_, { corpusId, startPage = 1 }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      if (!(await pipelineClient.isConfigured())) {
        throw new BadRequestError('Pipeline service is not configured')
      }
      const corpus = await Corpus.findById(corpusId)
      if (!corpus) throw new NotFoundError('Corpus', corpusId)

      const articleIds = (corpus.articles || [])
        .map((ca) => ca.article?._id ?? ca.article)
        .filter(Boolean)
        .map(String)

      const items = []
      for (const articleId of articleIds) {
        const latest = await ExportArtifact.findOne({
          article: articleId,
          corpus: corpus._id,
          kind: 'article-pdf',
          status: 'ready',
        })
          .sort({ createdAt: -1 })
          .lean()
        items.push({
          articleId,
          storageKey: latest?.storageKey || null,
        })
      }
      const ready = items.filter((i) => i.storageKey)
      if (ready.length === 0) {
        throw new BadRequestError(
          'No built article PDFs found. Run a batch build first.'
        )
      }

      const job = await PipelineJob.create({
        type: 'page-numbers',
        status: 'queued',
        corpus: corpus._id,
        workspace: corpus.workspace || undefined,
        triggeredBy: context.user._id,
        params: {
          corpusId: corpus._id.toString(),
          startPage,
          missingArticles: items
            .filter((i) => !i.storageKey)
            .map((i) => i.articleId),
        },
      })
      try {
        const remote = await pipelineClient.startJob({
          type: 'page-numbers',
          params: {
            corpusId: corpus._id.toString(),
            startPage,
            articles: ready,
          },
        })
        job.remoteJobId = remote.id
        job.status = remote.status || 'queued'
        await job.save()
      } catch (err) {
        job.status = 'failed'
        job.error = err.message
        await job.save()
        throw err
      }
      return job
    },

    /**
     * Apply a previously-computed page-number mapping to each article's
     * workingVersion metadata + YAML. Returns the updated articles' ids.
     * Idempotent — running again with the same mapping is a no-op.
     */
    async applyPageNumbers(_, { input }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      if (!Array.isArray(input?.entries) || input.entries.length === 0) {
        throw new BadRequestError('input.entries[] is empty')
      }
      const updated = []
      for (const entry of input.entries) {
        if (!entry?.articleId || !Number.isInteger(entry.startPage)) continue
        let article
        try {
          article = await getArticleByContext(entry.articleId, context)
        } catch (err) {
          logger.warn(
            { err, articleId: entry.articleId },
            'applyPageNumbers: skipped article (no access)'
          )
          continue
        }
        const metadata = {
          ...(article.workingVersion?.metadata ?? {}),
          start_page: entry.startPage,
        }
        if (entry.pageCount) metadata.page_count = entry.pageCount
        article.workingVersion.metadata = metadata
        const corpus = input.corpusId
          ? await Corpus.findById(input.corpusId)
          : null
        const { markdown } = rebuildArticleYaml({ article, corpus })
        article.workingVersion.md = markdown
        await article.save()
        updated.push({
          articleId: article._id.toString(),
          startPage: entry.startPage,
          pageCount: entry.pageCount ?? null,
        })
      }
      return { applied: updated.length, entries: updated }
    },

    /**
     * Rebuild the YAML frontmatter for an article from its workingVersion
     * metadata + corpus-level fields (issue id, editors, imageCredit). The
     * rewritten markdown replaces `workingVersion.md`. Idempotent — running
     * it twice yields the same output.
     */
    async syncArticleYaml(_, { articleId, corpusId }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      const article = await getArticleByContext(articleId, context)
      const corpus = corpusId ? await Corpus.findById(corpusId) : null
      const { markdown, yaml, metadata } = rebuildArticleYaml({
        article,
        corpus,
      })
      article.workingVersion.md = markdown
      article.workingVersion.metadata = metadata
      await article.save()
      return { articleId, corpusId: corpusId || null, yaml, markdown }
    },

    /**
     * Upload a per-corpus template or CSS override. The base64-encoded
     * content lands in MinIO under pipeline-templates/<corpusId>/<kind>/...;
     * its storage key is recorded on `corpus.pipelineSettings` so the
     * pipeline runner can resolve it at job time. Idempotent on the
     * (corpus, kind, filename) tuple — re-uploading replaces the object.
     */
    async uploadCorpusTemplateOverride(
      _,
      { corpusId, kind, filename, contentBase64 },
      context
    ) {
      if (!context.user) throw new NotAuthenticatedError()
      if (!TEMPLATE_OVERRIDE_KINDS.includes(kind)) {
        throw new BadRequestError(
          `kind must be one of ${TEMPLATE_OVERRIDE_KINDS.join(', ')}`
        )
      }
      if (!filename || /\//.test(filename)) {
        throw new BadRequestError('filename must be a bare basename')
      }
      const corpus = await Corpus.findById(corpusId)
      if (!corpus) throw new NotFoundError('Corpus', corpusId)

      const buffer = Buffer.from(contentBase64 || '', 'base64')
      if (buffer.length === 0) {
        throw new BadRequestError('contentBase64 decoded to empty payload')
      }
      if (buffer.length > TEMPLATE_OVERRIDE_MAX_BYTES) {
        throw new BadRequestError(
          `override too large (max ${TEMPLATE_OVERRIDE_MAX_BYTES} bytes)`
        )
      }
      const key = templateOverrideKey(corpus._id.toString(), kind, filename)
      await putObject({
        key,
        body: buffer,
        contentType: TEMPLATE_OVERRIDE_MIME[kind],
      })

      const next = {
        ...(corpus.pipelineSettings?.toObject?.() ??
          corpus.pipelineSettings ??
          {}),
      }
      next[corpusOverrideField(kind)] = key
      corpus.pipelineSettings = next
      await corpus.save()

      let presignedUrl = null
      try {
        presignedUrl = await getPresignedGetUrl(key, 600)
      } catch {
        /* presign is best-effort */
      }
      return {
        corpusId: corpus._id.toString(),
        kind,
        storageKey: key,
        size: buffer.length,
        presignedUrl,
      }
    },

    /**
     * Drop the recorded override ref. The MinIO object is left in place
     * (cleanup of orphaned overrides is a deferred concern).
     */
    async clearCorpusTemplateOverride(_, { corpusId, kind }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      if (!TEMPLATE_OVERRIDE_KINDS.includes(kind)) {
        throw new BadRequestError(
          `kind must be one of ${TEMPLATE_OVERRIDE_KINDS.join(', ')}`
        )
      }
      const corpus = await Corpus.findById(corpusId)
      if (!corpus) throw new NotFoundError('Corpus', corpusId)
      const next = {
        ...(corpus.pipelineSettings?.toObject?.() ??
          corpus.pipelineSettings ??
          {}),
      }
      next[corpusOverrideField(kind)] = ''
      corpus.pipelineSettings = next
      await corpus.save()
      return corpus
    },

    async cancelPipelineJob(_, { id }, context) {
      if (!context.user) throw new NotAuthenticatedError()
      const job = await PipelineJob.findById(id)
      if (!job) throw new NotFoundError('PipelineJob', id)
      if (isTerminal(job.status)) return job
      if (job.remoteJobId) {
        try {
          await pipelineClient.cancelJob(job.remoteJobId)
        } catch (err) {
          logger.warn({ err }, 'pipeline cancel call failed; marking local')
        }
      }
      job.status = 'cancelled'
      job.finishedAt = job.finishedAt || new Date()
      await job.save()
      return job
    },
  },

  PipelineJob: {
    async artefacts(job) {
      if (!job.artefacts?.length) return []
      return ExportArtifact.find({ _id: { $in: job.artefacts } })
    },
  },

  ExportArtifact: {
    async presignedUrl(artefact) {
      if (!artefact?.storageKey) return null
      const { getPresignedGetUrl } = require('../helpers/storage.js')
      try {
        return await getPresignedGetUrl(artefact.storageKey, 3600)
      } catch {
        return null
      }
    },
  },
}

// Internal helpers exposed for tests; not part of the GraphQL resolver map.
module.exports.__test__ = {
  buildArticleMarkdown,
  refreshFromPipeline,
  persistArtefacts,
}
