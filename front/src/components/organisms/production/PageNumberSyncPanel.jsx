import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isTerminalStatus,
  usePageNumberSync,
} from '../../../hooks/pipeline.js'
import { Button, Field } from '../../atoms/index.js'

import styles from './PageNumberSyncPanel.module.scss'

function ResultsTable({ results, t }) {
  if (!Array.isArray(results) || results.length === 0) return null
  return (
    <table className={styles.results}>
      <thead>
        <tr>
          <th>{t('pageNumbers.col.article', 'article')}</th>
          <th>{t('pageNumbers.col.start', 'start_page')}</th>
          <th>{t('pageNumbers.col.pages', 'pages')}</th>
          <th>{t('pageNumbers.col.status', 'status')}</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.articleId} data-status={r.error ? 'error' : 'ok'}>
            <td className={styles.articleId}>{r.articleId}</td>
            <td>{r.startPage ?? '—'}</td>
            <td>{r.pageCount ?? '—'}</td>
            <td>{r.error ? r.error : '✓'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Page-number sync UI. Editor flow:
 *   1. (optional) tweak issue start page
 *   2. click "compute" → kicks off pipeline page-numbers job, dashboard streams progress
 *   3. once succeeded the proposed mapping renders below; click "apply"
 *      to write start_page back into each article's YAML.
 */
export default function PageNumberSyncPanel({ corpusId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const [startPage, setStartPage] = useState(1)
  const sync = usePageNumberSync({ corpusId })

  const computed = sync.job?.params?.results
  const ready =
    sync.job &&
    sync.job.status === 'succeeded' &&
    Array.isArray(computed) &&
    computed.length > 0

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {t('pageNumbers.title', 'Page numbers')}
        </h3>
        <p className={styles.subtitle}>
          {t(
            'pageNumbers.subtitle',
            'Probe each article PDF for its page count, then commit the running start_page back into article YAML.'
          )}
        </p>
      </header>

      <div className={styles.controls}>
        <Field
          label={t('pageNumbers.startPage', 'Issue start page')}
          type="number"
          min={1}
          value={startPage}
          onChange={(e) => setStartPage(parseInt(e.target.value, 10) || 1)}
        />
        <Button
          secondary
          disabled={sync.isRunning}
          onClick={() => sync.start({ startPage })}
        >
          {sync.isRunning
            ? t('pageNumbers.computing', 'computing…')
            : t('pageNumbers.compute', 'compute mapping')}
        </Button>
        {sync.job && (
          <span
            className={styles.status}
            data-status={sync.job.status}
          >
            {sync.job.status}
            {sync.job.status === 'running' && (
              <> · {Math.round((sync.job.progress ?? 0) * 100)}%</>
            )}
          </span>
        )}
      </div>

      {sync.error && <p className={styles.error}>{sync.error}</p>}

      {ready && (
        <>
          <ResultsTable results={computed} t={t} />
          <div className={styles.applyRow}>
            <Button
              primary
              disabled={sync.applying || !!sync.applyResult}
              onClick={() => sync.apply()}
            >
              {sync.applying
                ? t('pageNumbers.applying', 'applying…')
                : t('pageNumbers.apply', 'apply to article YAML')}
            </Button>
            {sync.applyResult && (
              <span className={styles.applied}>
                {t('pageNumbers.applied', '{{n}} article(s) updated', {
                  n: sync.applyResult.applied,
                })}
              </span>
            )}
            {sync.applyError && (
              <span className={styles.error}>{sync.applyError}</span>
            )}
          </div>
        </>
      )}

      {sync.job &&
        isTerminalStatus(sync.job.status) &&
        !ready &&
        sync.job.status !== 'succeeded' && (
          <p className={styles.error}>
            {sync.job.error ||
              t('pageNumbers.noResults', 'No mapping was produced.')}
          </p>
        )}
    </section>
  )
}
