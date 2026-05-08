import { useTranslation } from 'react-i18next'

import { useCorpusArtefactSummary } from '../../../hooks/pipeline.js'

import styles from './CorpusArtefactBadges.module.scss'

const KIND_LABELS = [
  ['article-pdf', 'art', 'Per-article PDFs'],
  ['article-cover', 'cov', 'Article covers'],
  ['toc', 'toc', 'Table of contents'],
  ['front-page', 'fp', 'Front page'],
  ['complete-issue', 'iss', 'Complete-issue PDF'],
]

/**
 * Compact strip of green/grey badges showing which publishing artefacts the
 * corpus has produced so far. Lives on `CorpusItem` headers so editors can
 * see issue readiness at a glance without opening the production page.
 */
export default function CorpusArtefactBadges({ corpusId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { summary } = useCorpusArtefactSummary({ corpusId })

  return (
    <div
      className={styles.row}
      role="list"
      aria-label={t('badges.aria', 'Publishing artefacts')}
      title={
        summary.inFlight
          ? t('badges.inFlightTooltip', 'A pipeline job is in flight…')
          : ''
      }
    >
      {KIND_LABELS.map(([kind, short, longLabel]) => {
        const present = Boolean(summary.kinds[kind])
        return (
          <span
            key={kind}
            role="listitem"
            className={`${styles.badge} ${present ? styles.ok : styles.missing}`}
            title={t(`badges.${kind}`, longLabel)}
          >
            {short}
          </span>
        )
      })}
      {summary.inFlight && <span className={styles.spinner} aria-hidden="true" />}
    </div>
  )
}
