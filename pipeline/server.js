const express = require('express')
const { logger } = require('./lib/logger')
const jobs = require('./lib/jobs')
const preflight = require('./lib/preflight')
const {
  runArticlePdfJob,
  runBatchBuildJob,
} = require('./lib/build-article')
const { runPageNumbersJob } = require('./lib/page-numbers')
const { runStaticDeployJob } = require('./lib/run-static-deploy')
const { runArticleCoverJob } = require('./lib/article-covers')
const { runFrontPageJob } = require('./lib/front-page')
const { runTocJob } = require('./lib/toc')
const { runCompleteIssueJob } = require('./lib/complete-issue')

const PORT = parseInt(process.env.PORT || '3070', 10)
const AUTH_TOKEN = process.env.PIPELINE_AUTH_TOKEN || ''

const app = express()
app.use(express.json({ limit: '32mb' }))

function requireToken(req, res, next) {
  if (!AUTH_TOKEN) {
    // Local dev: allow if no token set, but warn loudly.
    return next()
  }
  const header = req.get('authorization') || ''
  const supplied = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.get('x-pipeline-token') || ''
  if (supplied !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

app.get('/health', async (_req, res) => {
  const h = await preflight.runHealth()
  res.status(h.ok ? 200 : 503).json(h)
})

const JOB_RUNNERS = {
  'article-pdf': runArticlePdfJob,
  batch: runBatchBuildJob,
  'page-numbers': runPageNumbersJob,
  'static-deploy': runStaticDeployJob,
  'article-cover': runArticleCoverJob,
  toc: runTocJob,
  'front-page': runFrontPageJob,
  'complete-issue': runCompleteIssueJob,
}

app.post('/jobs', requireToken, async (req, res) => {
  const { type, params } = req.body || {}
  if (!type || !JOB_RUNNERS[type]) {
    return res.status(400).json({ error: `unknown job type: ${type}` })
  }
  if (type === 'article-pdf') {
    const errors = preflight.validateArticleJobParams(params)
    if (errors.length) {
      return res.status(400).json({ error: 'preflight failed', details: errors })
    }
  }
  if (type === 'batch') {
    if (!Array.isArray(params?.articles) || params.articles.length === 0) {
      return res
        .status(400)
        .json({ error: 'preflight failed', details: ['articles[] required'] })
    }
    for (const item of params.articles) {
      const errs = preflight.validateArticleJobParams({
        ...item,
        corpusId: params.corpusId,
      })
      if (errs.length) {
        return res
          .status(400)
          .json({ error: 'preflight failed', details: errs, item })
      }
    }
  }
  const job = jobs.createJob({ type, params })
  res.status(202).json(jobs.summarise(job))
  setImmediate(() => {
    JOB_RUNNERS[type]({ job, jobs }).catch((err) => {
      logger.error({ err, jobId: job.id }, 'Job runner failed')
      jobs.fail(job.id, err)
    })
  })
})

app.get('/jobs/:id', requireToken, (req, res) => {
  const job = jobs.getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json(jobs.summarise(job))
})

app.get('/jobs/:id/stream', requireToken, (req, res) => {
  const job = jobs.getJob(req.params.id)
  if (!job) return res.status(404).end()
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // Replay current state to the new subscriber so the UI never starts blank.
  send({ type: 'snapshot', job: jobs.summarise(job) })

  const unsubscribe = jobs.subscribe(job.id, send)
  req.on('close', () => unsubscribe())
})

app.post('/jobs/:id/cancel', requireToken, (req, res) => {
  const job = jobs.getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  if (job.status !== 'running' && job.status !== 'queued') {
    return res.status(409).json({ error: `job is ${job.status}` })
  }
  // Cooperative cancel — runners can poll job.status === 'cancelled' later.
  // Phase 1: mark cancelled; current article-pdf runner is short and won't
  // notice mid-flight. Improvement tracked for Phase 2.
  jobs.setStatus(job.id, 'cancelled')
  res.json(jobs.summarise(job))
})

app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error')
  res.status(500).json({ error: err.message })
})

if (!AUTH_TOKEN) {
  logger.warn(
    'PIPELINE_AUTH_TOKEN is not set — accepting unauthenticated requests'
  )
}

preflight.logHealthOnStart().catch((err) => {
  logger.error({ err }, 'Preflight failed on startup')
})

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Stylimag pipeline service listening')
})
