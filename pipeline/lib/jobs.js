const { randomUUID } = require('node:crypto')

const jobs = new Map()
const subscribers = new Map() // jobId → Set<(event) => void>

function nowStamp() {
  return new Date().toISOString().split('T')[1].split('.')[0]
}

function publish(jobId, event) {
  const subs = subscribers.get(jobId)
  if (!subs) return
  for (const fn of subs) {
    try {
      fn(event)
    } catch {
      /* drop broken subscriber */
    }
  }
}

function createJob({ type, params }) {
  const id = randomUUID()
  const job = {
    id,
    type,
    status: 'queued',
    progress: 0,
    logs: [`[${nowStamp()}] Job created: ${type}`],
    params,
    artefacts: [],
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  }
  jobs.set(id, job)
  return job
}

function getJob(id) {
  return jobs.get(id)
}

function listJobs() {
  return Array.from(jobs.values())
}

function appendLog(id, msg) {
  const job = jobs.get(id)
  if (!job) return
  const line = `[${nowStamp()}] ${msg}`
  job.logs.push(line)
  publish(id, { type: 'log', line })
}

function setStatus(id, status, extra = {}) {
  const job = jobs.get(id)
  if (!job) return
  job.status = status
  if (status === 'running' && !job.startedAt) job.startedAt = Date.now()
  if (
    (status === 'succeeded' ||
      status === 'failed' ||
      status === 'cancelled') &&
    !job.finishedAt
  ) {
    job.finishedAt = Date.now()
  }
  Object.assign(job, extra)
  publish(id, { type: 'status', status, progress: job.progress })
}

function setProgress(id, progress) {
  const job = jobs.get(id)
  if (!job) return
  job.progress = Math.max(0, Math.min(1, progress))
  publish(id, { type: 'progress', progress: job.progress })
}

function addArtefact(id, artefact) {
  const job = jobs.get(id)
  if (!job) return
  job.artefacts.push(artefact)
  publish(id, { type: 'artefact', artefact })
}

function fail(id, err) {
  const job = jobs.get(id)
  if (!job) return
  job.error = err?.message || String(err)
  appendLog(id, `Error: ${job.error}`)
  setStatus(id, 'failed')
}

function subscribe(id, fn) {
  if (!subscribers.has(id)) subscribers.set(id, new Set())
  subscribers.get(id).add(fn)
  return () => {
    const set = subscribers.get(id)
    if (set) {
      set.delete(fn)
      if (set.size === 0) subscribers.delete(id)
    }
  }
}

function summarise(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    logs: job.logs,
    artefacts: job.artefacts,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

module.exports = {
  createJob,
  getJob,
  listJobs,
  appendLog,
  setStatus,
  setProgress,
  addArtefact,
  fail,
  subscribe,
  summarise,
}
