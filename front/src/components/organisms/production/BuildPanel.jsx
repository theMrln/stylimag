import { useTranslation } from 'react-i18next'

import {
  useStartBatchBuild,
  useStartBuildCompleteIssue,
  useStartBuildCovers,
  useStartBuildFrontPage,
  useStartBuildToc,
} from '../../../hooks/pipeline.js'
import { Button } from '../../atoms/index.js'

import styles from './BuildPanel.module.scss'

function statusLine(t, runner) {
  if (!runner.job) return null
  if (runner.job.status === 'queued') return t('buildPanel.statusQueued', 'queued…')
  if (runner.job.status === 'running')
    return t('buildPanel.statusRunning', 'running… {{pct}}%', {
      pct: Math.round((runner.job.progress ?? 0) * 100),
    })
  if (runner.job.status === 'succeeded') return t('buildPanel.statusOk', 'done ✓')
  if (runner.job.status === 'failed')
    return t('buildPanel.statusFail', 'failed ✗')
  if (runner.job.status === 'cancelled')
    return t('buildPanel.statusCancelled', 'cancelled')
  return runner.job.status
}

function ActionRow({ label, description, runner, t, onAfter }) {
  return (
    <li className={styles.row}>
      <div>
        <strong className={styles.rowLabel}>{label}</strong>
        <p className={styles.rowDescription}>{description}</p>
      </div>
      <div className={styles.rowActions}>
        <Button
          small
          secondary
          disabled={runner.isRunning}
          onClick={async () => {
            await runner.start()
            if (onAfter) onAfter()
          }}
        >
          {runner.isRunning
            ? t('buildPanel.runningLabel', 'running…')
            : t('buildPanel.runLabel', 'run')}
        </Button>
        <span className={styles.rowStatus}>{statusLine(t, runner)}</span>
        {runner.error && <span className={styles.rowError}>{runner.error}</span>}
      </div>
    </li>
  )
}

export default function BuildPanel({ corpusId, onJobStarted }) {
  const { t } = useTranslation('production', { useSuspense: false })

  const batch = useStartBatchBuild({ corpusId })
  const covers = useStartBuildCovers({ corpusId })
  const toc = useStartBuildToc({ corpusId })
  const front = useStartBuildFrontPage({ corpusId })
  const complete = useStartBuildCompleteIssue({ corpusId })

  return (
    <section className={styles.panel}>
      <h3 className={styles.title}>
        {t('buildPanel.title', 'Build issue artefacts')}
      </h3>
      <ul className={styles.list}>
        <ActionRow
          t={t}
          runner={batch}
          onAfter={onJobStarted}
          label={t('buildPanel.batch.label', 'Batch build all articles')}
          description={t(
            'buildPanel.batch.description',
            'Run the article-PDF pipeline against every article in this corpus, sequentially.'
          )}
        />
        <ActionRow
          t={t}
          runner={covers}
          onAfter={onJobStarted}
          label={t('buildPanel.covers.label', 'Article cover pages')}
          description={t(
            'buildPanel.covers.description',
            'Per-article cover pages. Renderer port pending — runs as a stub for now and surfaces the gap in the dashboard.'
          )}
        />
        <ActionRow
          t={t}
          runner={toc}
          onAfter={onJobStarted}
          label={t('buildPanel.toc.label', 'Table of contents')}
          description={t(
            'buildPanel.toc.description',
            'TOC page. Renderer port pending.'
          )}
        />
        <ActionRow
          t={t}
          runner={front}
          onAfter={onJobStarted}
          label={t('buildPanel.frontPage.label', 'Front page / front matter')}
          description={t(
            'buildPanel.frontPage.description',
            'Cover + masthead artefact. Renderer port pending.'
          )}
        />
        <ActionRow
          t={t}
          runner={complete}
          onAfter={onJobStarted}
          label={t('buildPanel.completeIssue.label', 'Complete issue PDF')}
          description={t(
            'buildPanel.completeIssue.description',
            'Front page + TOC + every article PDF, merged. Renderer port pending.'
          )}
        />
      </ul>
    </section>
  )
}
