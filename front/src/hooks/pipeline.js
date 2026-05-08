import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import { executeQuery } from '../helpers/graphQL.js'
import {
  applyPageNumbers as applyPageNumbersMutation,
  cancelPipelineJob as cancelMutation,
  getCorpusArtefactSummary,
  getCorpusIssueMetadata,
  getPipelineHealth,
  getPipelineJob,
  getPipelineJobs,
  pushAuthorBiosToOJS as pushBiosMutation,
  pushDoisToOJS as pushDoisMutation,
  pushPageNumbersToOJS as pushPagesMutation,
  startBatchBuild as startBatchBuildMutation,
  startBuildArticle as startBuildArticleMutation,
  startBuildCompleteIssue as startBuildCompleteIssueMutation,
  startBuildCovers as startBuildCoversMutation,
  startBuildFrontPage as startBuildFrontPageMutation,
  startBuildToc as startBuildTocMutation,
  startPageNumberSync as startPageNumberSyncMutation,
  syncArticleYaml as syncArticleYamlMutation,
  updateCorpusIssueMetadata as updateCorpusIssueMetadataMutation,
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

/**
 * Summarise which publishing artefacts the corpus has produced so far —
 * used by status badges on the corpus list. Returns a map of kind → most
 * recent ready artefact's storageKey (or null) and a flag for whether any
 * job is currently in flight.
 */
export function useCorpusArtefactSummary({ corpusId } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [summary, setSummary] = useState({ kinds: {}, inFlight: false })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!corpusId) return
    setLoading(true)
    try {
      const data = await executeQuery({
        sessionToken,
        query: getCorpusArtefactSummary,
        variables: { corpusId, limit: 50 },
      })
      const jobs = data?.pipelineJobs ?? []
      const kinds = {}
      let inFlight = false
      for (const job of jobs) {
        if (!isTerminalStatus(job.status)) inFlight = true
        if (job.status !== 'succeeded') continue
        for (const a of job.artefacts || []) {
          if (a.status !== 'ready') continue
          if (!kinds[a.kind]) kinds[a.kind] = { _id: a._id, format: a.format }
        }
      }
      setSummary({ kinds, inFlight })
    } catch {
      /* swallow — badges are advisory */
    } finally {
      setLoading(false)
    }
  }, [corpusId, sessionToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { summary, loading, refresh }
}

/**
 * Wraps a "start <type> build" mutation so a single component can fire any of
 * the corpus-scoped artefact jobs (batch, covers, toc, front-page,
 * complete-issue) and observe the resulting job over SSE. Returns:
 *   { start, job, isRunning, error, logs }
 */
function useCorpusJobMutation({ corpusId, mutation, mutationKey }) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [seedJob, setSeedJob] = useState(null)
  const [error, setError] = useState(null)

  const stream = usePipelineJobStream({
    jobId: seedJob?._id,
    initialJob: seedJob,
  })
  const job = stream.job || seedJob

  const start = useCallback(
    async (extra = {}) => {
      if (!corpusId) {
        const err = 'corpusId is required'
        setError(err)
        return null
      }
      setError(null)
      try {
        const data = await executeQuery({
          sessionToken,
          query: mutation,
          variables: { corpusId, ...extra },
        })
        const created = data?.[mutationKey]
        if (created) setSeedJob(created)
        return created
      } catch (err) {
        setError(err.message)
        return null
      }
    },
    [corpusId, mutation, mutationKey, sessionToken]
  )

  return {
    start,
    job,
    logs: stream.logs,
    error: error || stream.error,
    isRunning: Boolean(job) && !isTerminalStatus(job.status),
  }
}

export function useStartBatchBuild({ corpusId } = {}) {
  return useCorpusJobMutation({
    corpusId,
    mutation: startBatchBuildMutation,
    mutationKey: 'startBatchBuild',
  })
}

export function useStartBuildCovers({ corpusId } = {}) {
  return useCorpusJobMutation({
    corpusId,
    mutation: startBuildCoversMutation,
    mutationKey: 'startBuildCovers',
  })
}

export function useStartBuildToc({ corpusId } = {}) {
  return useCorpusJobMutation({
    corpusId,
    mutation: startBuildTocMutation,
    mutationKey: 'startBuildToc',
  })
}

export function useStartBuildFrontPage({ corpusId } = {}) {
  return useCorpusJobMutation({
    corpusId,
    mutation: startBuildFrontPageMutation,
    mutationKey: 'startBuildFrontPage',
  })
}

export function useStartBuildCompleteIssue({ corpusId } = {}) {
  return useCorpusJobMutation({
    corpusId,
    mutation: startBuildCompleteIssueMutation,
    mutationKey: 'startBuildCompleteIssue',
  })
}

/**
 * Page-number sync: kicks off the pipeline page-numbers job, exposes the
 * computed mapping (job.params.results once succeeded), and provides an
 * `apply` action that POSTs the mapping back to graphql for YAML rewriting.
 */
export function usePageNumberSync({ corpusId } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const job = useCorpusJobMutation({
    corpusId,
    mutation: startPageNumberSyncMutation,
    mutationKey: 'startPageNumberSync',
  })
  const [applyResult, setApplyResult] = useState(null)
  const [applyError, setApplyError] = useState(null)
  const [applying, setApplying] = useState(false)

  const apply = useCallback(async () => {
    const results = job.job?.params?.results
    if (!Array.isArray(results) || results.length === 0) return null
    const entries = results
      .filter((r) => Number.isInteger(r.startPage))
      .map((r) => ({
        articleId: r.articleId,
        startPage: r.startPage,
        pageCount: r.pageCount ?? null,
      }))
    if (entries.length === 0) return null
    setApplying(true)
    setApplyError(null)
    try {
      const data = await executeQuery({
        sessionToken,
        query: applyPageNumbersMutation,
        variables: { input: { corpusId, entries } },
      })
      setApplyResult(data?.applyPageNumbers || null)
      return data?.applyPageNumbers
    } catch (err) {
      setApplyError(err.message)
      return null
    } finally {
      setApplying(false)
    }
  }, [corpusId, job.job?.params?.results, sessionToken])

  return { ...job, apply, applying, applyResult, applyError }
}

function makeOjsPushHook(mutation, mutationKey) {
  return function useOjsPush() {
    const sessionToken = useSelector((state) => state.sessionToken)
    const [busy, setBusy] = useState(false)
    const [summary, setSummary] = useState(null)
    const [error, setError] = useState(null)

    const push = useCallback(
      async ({ instance, entries, apply = false } = {}) => {
        setBusy(true)
        setError(null)
        try {
          const data = await executeQuery({
            sessionToken,
            query: mutation,
            variables: { instance, entries, apply },
          })
          const next = data?.[mutationKey]
          setSummary(next || null)
          return next
        } catch (err) {
          setError(err.message)
          return null
        } finally {
          setBusy(false)
        }
      },
      [sessionToken]
    )

    return { push, busy, summary, error, reset: () => setSummary(null) }
  }
}

export const usePushPageNumbersToOjs = makeOjsPushHook(
  pushPagesMutation,
  'pushPageNumbersToOJS'
)
export const usePushDoisToOjs = makeOjsPushHook(
  pushDoisMutation,
  'pushDoisToOJS'
)
export const usePushAuthorBiosToOjs = makeOjsPushHook(
  pushBiosMutation,
  'pushAuthorBiosToOJS'
)

/**
 * Rebuild + persist an article's YAML frontmatter. Returns the rewritten
 * markdown so the caller can offer a diff/preview before committing in the
 * UI (the mutation has already saved the article in graphql).
 */
export function useSyncArticleYaml() {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const sync = useCallback(
    async ({ articleId, corpusId } = {}) => {
      if (!articleId) {
        setError('articleId is required')
        return null
      }
      setBusy(true)
      setError(null)
      try {
        const data = await executeQuery({
          sessionToken,
          query: syncArticleYamlMutation,
          variables: { articleId, corpusId },
        })
        setResult(data?.syncArticleYaml || null)
        return data?.syncArticleYaml || null
      } catch (err) {
        setError(err.message)
        return null
      } finally {
        setBusy(false)
      }
    },
    [sessionToken]
  )

  return { sync, busy, result, error }
}

/**
 * Read + write the issue-level corpus metadata (editors[], imageCredit{}).
 * Backed by the shared graphql cache via SWR-style refresh.
 */
export function useCorpusIssueMetadata({ corpusId } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!corpusId) return null
    setLoading(true)
    try {
      const res = await executeQuery({
        sessionToken,
        query: getCorpusIssueMetadata,
        variables: { corpusId },
      })
      setData(res?.corpus || null)
      return res?.corpus
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [corpusId, sessionToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = useCallback(
    async ({ editors, imageCredit }) => {
      if (!corpusId) return null
      setError(null)
      try {
        const res = await executeQuery({
          sessionToken,
          query: updateCorpusIssueMetadataMutation,
          variables: {
            corpusId,
            input: {
              ...(editors !== undefined ? { editors } : {}),
              ...(imageCredit !== undefined ? { imageCredit } : {}),
            },
          },
        })
        const updated = res?.corpus?.updateIssueMetadata
        if (updated) {
          setData((prev) => ({
            ...(prev || {}),
            editors: updated.editors,
            imageCredit: updated.imageCredit,
          }))
        }
        return updated
      } catch (err) {
        setError(err.message)
        return null
      }
    },
    [corpusId, sessionToken]
  )

  return { data, loading, error, refresh, save }
}
