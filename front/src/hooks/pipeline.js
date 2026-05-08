import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import { executeQuery } from '../helpers/graphQL.js'
import {
  cancelPipelineJob as cancelMutation,
  getPipelineHealth,
  getPipelineJob,
  getPipelineJobs,
  startBuildArticle as startBuildArticleMutation,
} from './Pipeline.graphql'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const POLL_INTERVAL_MS = 5_000 // SSE-disconnect fallback only
const MAX_LIVE_LOG_LINES = 200

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status)
}

export function usePipelineHealth({ enabled = true } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!enabled) return null
    setLoading(true)
    try {
      const data = await executeQuery({
        sessionToken,
        query: getPipelineHealth,
        variables: {},
      })
      setHealth(data?.pipelineHealth ?? null)
      return data?.pipelineHealth
    } catch (err) {
      setHealth({ ok: false, error: err.message })
      return null
    } finally {
      setLoading(false)
    }
  }, [enabled, sessionToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { health, loading, refresh }
}

/**
 * Subscribe to a PipelineJob's live event stream (status, progress, log lines)
 * via the graphql `/pipeline-events/:id` SSE proxy. Falls back to a slow poll
 * if EventSource isn't available or the connection drops.
 *
 * Returns { job, logs, error, refresh } where:
 *  - job is whatever the server sent (snapshot/status updates merged)
 *  - logs is an in-memory rolling list of log lines from this session
 *  - refresh() forces a one-off pipelineJob query (useful after cancel)
 */
export function usePipelineJobStream({ jobId, initialJob = null } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [job, setJob] = useState(initialJob)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!jobId) return null
    try {
      const data = await executeQuery({
        sessionToken,
        query: getPipelineJob,
        variables: { id: jobId },
      })
      const next = data?.pipelineJob
      if (next) setJob(next)
      return next
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [jobId, sessionToken])

  // Keep job in sync if the parent passes a new initial value.
  useEffect(() => {
    if (initialJob && initialJob._id === jobId) setJob(initialJob)
  }, [initialJob, jobId])

  useEffect(() => {
    if (!jobId) return undefined
    if (typeof window === 'undefined' || !window.EventSource) {
      // No EventSource: fall back to polling.
      pollRef.current = setInterval(refresh, POLL_INTERVAL_MS)
      return () => clearInterval(pollRef.current)
    }

    let closed = false
    const url = `/pipeline-events/${encodeURIComponent(jobId)}`
    const source = new EventSource(url, { withCredentials: true })

    source.onmessage = (msg) => {
      let event = null
      try {
        event = JSON.parse(msg.data)
      } catch {
        return
      }
      if (!event) return
      if (event.type === 'snapshot' && event.job) {
        setJob((prev) => ({ ...(prev || {}), ...event.job }))
        if (Array.isArray(event.job.logs)) {
          setLogs(event.job.logs.slice(-MAX_LIVE_LOG_LINES))
        }
      } else if (event.type === 'log') {
        setLogs((prev) => {
          const next = prev.concat([event.line])
          return next.length > MAX_LIVE_LOG_LINES
            ? next.slice(next.length - MAX_LIVE_LOG_LINES)
            : next
        })
      } else if (event.type === 'progress') {
        setJob((prev) => (prev ? { ...prev, progress: event.progress } : prev))
      } else if (event.type === 'status') {
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: event.status,
                progress:
                  typeof event.progress === 'number'
                    ? event.progress
                    : prev.progress,
              }
            : prev
        )
        if (isTerminalStatus(event.status)) {
          // Pull the final view from graphql so we get artefacts + finishedAt.
          refresh()
          source.close()
        }
      } else if (event.type === 'artefact' && event.artefact) {
        // We don't have ExportArtifact._id here yet (graphql tee assigns it
        // on terminal). Trigger a refresh so artefacts populate.
        refresh()
      } else if (event.type === 'error') {
        setError(event.error || 'pipeline-stream-error')
      }
    }

    source.onerror = () => {
      if (closed) return
      // Browser will auto-reconnect for transient failures. If the upstream
      // job is already terminal we just close cleanly on the next message.
    }

    return () => {
      closed = true
      try {
        source.close()
      } catch {
        /* ignore */
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobId, refresh])

  return { job, logs, error, refresh }
}

/**
 * Hook for kicking off and tracking a single article-pdf build. After the
 * mutation returns, hands off to usePipelineJobStream for live updates.
 */
export function useBuildArticle({ articleId, corpusId } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [seedJob, setSeedJob] = useState(null)
  const [error, setError] = useState(null)

  const stream = usePipelineJobStream({
    jobId: seedJob?._id,
    initialJob: seedJob,
  })

  const job = stream.job || seedJob

  const startBuild = useCallback(
    async ({ engine = 'paged' } = {}) => {
      if (!articleId || !corpusId) {
        const err = 'articleId and corpusId are required'
        setError(err)
        return null
      }
      setError(null)
      try {
        const data = await executeQuery({
          sessionToken,
          query: startBuildArticleMutation,
          variables: { articleId, corpusId, engine },
        })
        const created = data?.startBuildArticle
        if (created) setSeedJob(created)
        return created
      } catch (err) {
        setError(err.message)
        return null
      }
    },
    [articleId, corpusId, sessionToken]
  )

  const cancelBuild = useCallback(async () => {
    if (!job?._id) return
    try {
      const data = await executeQuery({
        sessionToken,
        query: cancelMutation,
        variables: { id: job._id },
      })
      if (data?.cancelPipelineJob) setSeedJob(data.cancelPipelineJob)
    } catch (err) {
      setError(err.message)
    }
  }, [job?._id, sessionToken])

  return {
    job,
    logs: stream.logs,
    error: error || stream.error,
    isRunning: Boolean(job) && !isTerminalStatus(job.status),
    startBuild,
    cancelBuild,
  }
}

/**
 * List of recent pipeline jobs for a given corpus. Re-fetches on demand;
 * live updates flow through individual usePipelineJobStream subscriptions.
 */
export function usePipelineJobs({ corpusId, limit = 20 } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!corpusId) return
    setLoading(true)
    try {
      const data = await executeQuery({
        sessionToken,
        query: getPipelineJobs,
        variables: { corpusId, limit },
      })
      setJobs(data?.pipelineJobs ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [corpusId, limit, sessionToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { jobs, loading, error, refresh }
}
