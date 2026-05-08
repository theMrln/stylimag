import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { executeQuery } from '../../../helpers/graphQL.js'
import { cancelPipelineJob } from '../../../hooks/Pipeline.graphql'
import {
  isTerminalStatus,
  usePipelineJobs,
  usePipelineJobStream,
} from '../../../hooks/pipeline.js'
import { Button } from '../../atoms/index.js'
import { Loading } from '../../molecules/index.js'

import styles from './JobDashboard.module.scss'

const STATUS_LABEL = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
}

function ArtefactList({ artefacts }) {
  if (!artefacts || artefacts.length === 0) return null
  return (
    <ul className={styles.artefacts}>
      {artefacts.map((a) => {
        const href = a.downloadUrl || a.presignedUrl
        return (
          <li key={a._id}>
            <span className={styles.artefactKind}>{a.kind || a.format}</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.artefactLink}
              >
                download
              </a>
            ) : (
              <span className={styles.artefactPending}>(no link)</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function JobRow({ job: initialJob, refreshList }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const sessionToken = useSelector((state) => state.sessionToken)
  const { job, logs } = usePipelineJobStream({
    jobId: initialJob?._id,
    initialJob,
  })
  const current = job || initialJob

  const statusLabel = STATUS_LABEL[current.status] || current.status
  const pct = Math.round((current.progress ?? 0) * 100)

  const onCancel = useCallback(async () => {
    await executeQuery({
      sessionToken,
      query: cancelPipelineJob,
      variables: { id: current._id },
    })
    if (refreshList) refreshList()
  }, [current._id, refreshList, sessionToken])

  return (
    <li className={styles.row} data-status={current.status}>
      <header className={styles.rowHeader}>
        <span className={styles.type}>{current.type}</span>
        <span className={styles.status}>{statusLabel}</span>
        {current.status === 'running' && (
          <span className={styles.progress}>{pct}%</span>
        )}
        <span className={styles.timestamp}>
          {new Date(current.createdAt || Date.now()).toLocaleString()}
        </span>
        {!isTerminalStatus(current.status) && (
          <Button small link onClick={onCancel}>
            {t('jobDashboard.cancel', 'cancel')}
          </Button>
        )}
      </header>
      {current.error && <p className={styles.error}>{current.error}</p>}
      <ArtefactList artefacts={current.artefacts} />
      {logs && logs.length > 0 && (
        <details className={styles.logs}>
          <summary>{t('jobDashboard.logs', 'logs')}</summary>
          <pre>{logs.join('\n')}</pre>
        </details>
      )}
    </li>
  )
}

export default function JobDashboard({ corpusId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { jobs, loading, error, refresh } = usePipelineJobs({ corpusId })

  return (
    <section className={styles.dashboard}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {t('jobDashboard.title', 'Recent pipeline jobs')}
        </h3>
        <Button small secondary onClick={refresh}>
          {t('jobDashboard.refresh', 'refresh')}
        </Button>
      </header>
      {error && <p className={styles.errorBanner}>{error}</p>}
      {loading && jobs.length === 0 ? (
        <Loading />
      ) : jobs.length === 0 ? (
        <p className={styles.empty}>
          {t('jobDashboard.empty', 'No pipeline jobs yet for this corpus.')}
        </p>
      ) : (
        <ul className={styles.list}>
          {jobs.map((job) => (
            <JobRow key={job._id} job={job} refreshList={refresh} />
          ))}
        </ul>
      )}
    </section>
  )
}
