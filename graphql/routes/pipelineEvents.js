const express = require('express')
const PipelineJob = require('../models/pipelineJob.js')
const Corpus = require('../models/corpus.js')
const Workspace = require('../models/workspace.js')
const ExportArtifact = require('../models/exportArtifact.js')
const pipelineClient = require('../helpers/pipelineClient.js')
const config = require('../config.js')
const { logger } = require('../logger.js')

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])

async function userCanSeeJob(user, job) {
  if (!user) return false
  if (job.triggeredBy && job.triggeredBy.toString() === user._id.toString()) {
    return true
  }
  if (!job.corpus) return false
  const corpus = await Corpus.findById(job.corpus)
  if (!corpus) return false
  if (corpus.creator?.toString() === user._id.toString()) return true
  if (corpus.workspace) {
    const ws = await Workspace.findOne({
      _id: corpus.workspace,
      'members.user': user._id,
    })
    if (ws) return true
  }
  return false
}

/**
 * Apply a single pipeline event to the local PipelineJob row.
 * Idempotent for status/progress; logsTail is only written on snapshot
 * (start) and terminal events to avoid double-logging when multiple
 * browsers subscribe to the same stream.
 */
async function applyEventToJob(job, event) {
  if (!event || !event.type) return
  if (event.type === 'progress') {
    job.progress = Math.max(job.progress ?? 0, event.progress ?? 0)
  } else if (event.type === 'status') {
    job.status = event.status
    if (typeof event.progress === 'number') job.progress = event.progress
    if (event.status === 'running' && !job.startedAt) job.startedAt = new Date()
    if (TERMINAL.has(event.status) && !job.finishedAt) {
      job.finishedAt = new Date()
    }
  } else if (event.type === 'snapshot') {
    const snap = event.job
    if (!snap) return
    job.status = snap.status
    job.progress = snap.progress ?? job.progress
    if (snap.error) job.error = snap.error
    if (snap.startedAt && !job.startedAt) job.startedAt = new Date(snap.startedAt)
    if (snap.finishedAt && !job.finishedAt) {
      job.finishedAt = new Date(snap.finishedAt)
    }
    if (Array.isArray(snap.logs) && snap.logs.length) {
      job.logsTail = snap.logs.slice(-200).join('\n')
    }
    if (TERMINAL.has(snap.status)) {
      await persistArtefacts(job, snap)
    }
  }
}

async function persistArtefacts(job, snap) {
  for (const a of snap.artefacts || []) {
    if (!a.storageKey) continue
    const existing = await ExportArtifact.findOne({ storageKey: a.storageKey })
    if (existing) {
      if (!job.artefacts.some((id) => id.toString() === existing._id.toString())) {
        job.artefacts.push(existing._id)
      }
      continue
    }
    const format =
      a.kind === 'article-html'
        ? 'html'
        : a.kind === 'cover-thumbnail'
          ? 'other' // image/png — `format` enum has no 'png', mimeType carries it
          : a.kind === 'article-pdf' ||
              a.kind === 'article-cover' ||
              a.kind === 'toc' ||
              a.kind === 'front-page' ||
              a.kind === 'complete-issue'
            ? 'pdf'
            : 'other'
    const created = await ExportArtifact.create({
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
    job.artefacts.push(created._id)
  }
}

/**
 * Parse a chunk of SSE bytes into discrete events (one per `data: …\n\n`).
 */
function makeEventParser(onEvent) {
  let buf = ''
  return function feed(chunk) {
    buf += chunk
    let sep
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const lines = block.split('\n')
      let data = ''
      for (const line of lines) {
        if (line.startsWith('data: ')) data += line.slice(6) + '\n'
        else if (line.startsWith('data:')) data += line.slice(5) + '\n'
      }
      data = data.replace(/\n$/, '')
      if (!data) continue
      try {
        onEvent(JSON.parse(data))
      } catch {
        /* drop malformed */
      }
    }
  }
}

function createPipelineEventsRouter() {
  const router = express.Router()

  router.get('/:jobId', async (req, res) => {
    const user = req.user
    if (!user) {
      res.status(401).end()
      return
    }
    const job = await PipelineJob.findById(req.params.jobId)
    if (!job) {
      res.status(404).end()
      return
    }
    if (!(await userCanSeeJob(user, job))) {
      res.status(403).end()
      return
    }
    if (!job.remoteJobId) {
      res.status(409).json({ error: 'job has no remoteJobId yet' })
      return
    }
    if (!(await pipelineClient.isConfigured())) {
      res.status(503).json({ error: 'pipeline service not configured' })
      return
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer
    })
    res.flushHeaders()

    const upstreamUrl = `${config.get('pipeline.serviceUrl').replace(/\/+$/, '')}/jobs/${encodeURIComponent(job.remoteJobId)}/stream`
    const token = config.get('pipeline.authToken')
    const headers = token ? { authorization: `Bearer ${token}` } : {}

    const controller = new AbortController()
    let upstreamRes
    try {
      upstreamRes = await fetch(upstreamUrl, {
        headers,
        signal: controller.signal,
      })
    } catch (err) {
      logger.warn({ err, upstreamUrl }, 'pipeline SSE upstream connect failed')
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: 'pipeline-unreachable' })}\n\n`
      )
      res.end()
      return
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: `upstream-${upstreamRes.status}` })}\n\n`
      )
      res.end()
      return
    }

    let pendingMongoP = Promise.resolve()
    const queueMongoUpdate = (event) => {
      pendingMongoP = pendingMongoP
        .then(async () => {
          try {
            const fresh = await PipelineJob.findById(job._id)
            if (!fresh) return
            await applyEventToJob(fresh, event)
            await fresh.save()
          } catch (err) {
            logger.warn(
              { err, jobId: job._id?.toString() },
              'failed to persist pipeline event'
            )
          }
        })
        .catch(() => {})
    }

    const parse = makeEventParser((event) => {
      // Always pass the event to the browser first so the UI never lags.
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        /* client closed */
      }
      // Tee selected events to the Mongo recorder.
      if (
        event?.type === 'snapshot' ||
        event?.type === 'status' ||
        event?.type === 'progress'
      ) {
        queueMongoUpdate(event)
      }
    })

    const reader = upstreamRes.body.getReader()
    const decoder = new TextDecoder()

    const close = () => {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
      try {
        res.end()
      } catch {
        /* already ended */
      }
    }

    req.on('close', close)
    res.on('close', close)
    ;(async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          parse(decoder.decode(value, { stream: true }))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          logger.warn({ err }, 'pipeline SSE upstream read failed')
        }
      } finally {
        close()
      }
    })()
  })

  return router
}

module.exports = {
  createPipelineEventsRouter,
  // exposed for tests
  __test__: { applyEventToJob, persistArtefacts, makeEventParser },
}
