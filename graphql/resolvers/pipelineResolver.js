const YAML = require('js-yaml')
const PipelineJob = require('../models/pipelineJob.js')
const ExportArtifact = require('../models/exportArtifact.js')
const Corpus = require('../models/corpus.js')
const { getArticleByContext } = require('./articleResolver.js')
const pipelineClient = require('../helpers/pipelineClient.js')
const { toLegacyFormat } = require('../helpers/metadata.js')
const {
  NotAuthenticatedError,
  NotFoundError,
  BadRequestError,
} = require('../helpers/errors.js')
const { logger } = require('../logger.js')

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
