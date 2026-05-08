import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import { executeQuery } from '../helpers/graphQL.js'
import {
  cancelPipelineJob as cancelMutation,
  getPipelineHealth,
  getPipelineJob,
  startBuildArticle as startBuildArticleMutation,
} from './Pipeline.graphql'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const POLL_INTERVAL_MS = 2_000

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
 * Hook for kicking off and tracking a single article-pdf build.
 * Returns { startBuild, cancelBuild, job, error, isRunning }.
 */
export function useBuildArticle({ articleId, corpusId } = {}) {
  const sessionToken = useSelector((state) => state.sessionToken)
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const pollOnce = useCallback(
    async (id) => {
      try {
        const data = await executeQuery({
          sessionToken,
          query: getPipelineJob,
          variables: { id },
        })
        const next = data?.pipelineJob
        if (next) {
          setJob(next)
          if (isTerminalStatus(next.status)) stopPolling()
        }
      } catch (err) {
        setError(err.message)
        stopPolling()
      }
    },
    [sessionToken, stopPolling]
  )

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
        if (created) {
          setJob(created)
          stopPolling()
          if (!isTerminalStatus(created.status)) {
            pollRef.current = setInterval(
              () => pollOnce(created._id),
              POLL_INTERVAL_MS
            )
          }
        }
        return created
      } catch (err) {
        setError(err.message)
        return null
      }
    },
    [articleId, corpusId, pollOnce, sessionToken, stopPolling]
  )

  const cancelBuild = useCallback(async () => {
    if (!job?._id) return
    try {
      const data = await executeQuery({
        sessionToken,
        query: cancelMutation,
        variables: { id: job._id },
      })
      if (data?.cancelPipelineJob) setJob(data.cancelPipelineJob)
      stopPolling()
    } catch (err) {
      setError(err.message)
    }
  }, [job?._id, sessionToken, stopPolling])

  return {
    job,
    error,
    isRunning:
      Boolean(job) && !isTerminalStatus(job.status) && job.status !== 'queued'
        ? true
        : Boolean(job) && job.status === 'queued',
    startBuild,
    cancelBuild,
  }
}
