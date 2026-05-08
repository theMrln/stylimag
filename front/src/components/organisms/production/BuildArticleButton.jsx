import { useTranslation } from 'react-i18next'

import { useBuildArticle } from '../../../hooks/pipeline.js'
import { Button } from '../../atoms/index.js'

import styles from './BuildArticleButton.module.scss'

function StatusLabel({ status, progress }) {
  if (!status) return null
  if (status === 'queued') return 'queued…'
  if (status === 'running') {
    const pct = Math.round((progress ?? 0) * 100)
    return `building… ${pct}%`
  }
  if (status === 'succeeded') return 'built ✓'
  if (status === 'failed') return 'failed ✗'
  if (status === 'cancelled') return 'cancelled'
  return status
}

/**
 * One-click PDF build for an article that lives in a corpus.
 * Phase 1: kick off the job, poll until terminal, render a download link
 * when an `article-pdf` artefact appears.
 */
export default function BuildArticleButton({ articleId, corpusId, engine }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { job, error, startBuild, cancelBuild } = useBuildArticle({
    articleId,
    corpusId,
  })

  const isActive =
    job && (job.status === 'queued' || job.status === 'running')

  const pdfArtefact = job?.artefacts?.find((a) => a.kind === 'article-pdf')

  return (
    <span className={styles.wrap}>
      <Button
        small
        secondary
        disabled={isActive || !articleId || !corpusId}
        onClick={() => startBuild({ engine })}
        title={t('buildArticle.tooltip', 'Build a PDF for this article')}
      >
        {t('buildArticle.label', 'Build PDF')}
      </Button>
      {job && (
        <span className={styles.status} data-status={job.status}>
          <StatusLabel status={job.status} progress={job.progress} />
        </span>
      )}
      {isActive && (
        <Button small link onClick={cancelBuild}>
          {t('buildArticle.cancel', 'cancel')}
        </Button>
      )}
      {(pdfArtefact?.downloadUrl || pdfArtefact?.presignedUrl) && (
        <a
          className={styles.download}
          href={pdfArtefact.downloadUrl || pdfArtefact.presignedUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('buildArticle.download', 'download PDF')}
        </a>
      )}
      {error && <span className={styles.error}>{error}</span>}
      {job?.error && !error && (
        <span className={styles.error}>{job.error}</span>
      )}
    </span>
  )
}
