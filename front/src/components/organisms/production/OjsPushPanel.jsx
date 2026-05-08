import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOjsInstances } from '../../../hooks/ojs.js'
import {
  usePushAuthorBiosToOjs,
  usePushDoisToOjs,
  usePushPageNumbersToOjs,
} from '../../../hooks/pipeline.js'
import { Button, Field } from '../../atoms/index.js'

import styles from './OjsPushPanel.module.scss'

function PushSummaryView({ summary, t }) {
  if (!summary) return null
  const { applied, dryRun, items } = summary
  return (
    <div className={styles.summary}>
      <p className={styles.summaryHeader}>
        {dryRun
          ? t('ojsPush.summary.dryRun', '{{n}} item(s) ready (dry run)', {
              n: items.length,
            })
          : t('ojsPush.summary.applied', '{{n}} item(s) applied', {
              n: applied,
            })}
      </p>
      <details>
        <summary>{t('ojsPush.summary.details', 'show details')}</summary>
        <pre className={styles.summaryDetails}>
          {JSON.stringify(items, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function PushSection({ titleKey, defaultTitle, helpKey, defaultHelp, hook, instance, entries }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { push, busy, summary, error, reset } = hook()
  return (
    <section className={styles.section}>
      <header>
        <strong>{t(titleKey, defaultTitle)}</strong>
        <p className={styles.help}>{t(helpKey, defaultHelp)}</p>
      </header>
      <div className={styles.actions}>
        <Button
          small
          secondary
          disabled={busy || !instance || !entries.length}
          onClick={() => {
            reset()
            push({ instance, entries, apply: false })
          }}
        >
          {t('ojsPush.dryRunLabel', 'dry run')}
        </Button>
        <Button
          small
          primary
          disabled={busy || !instance || !entries.length}
          onClick={() => {
            reset()
            push({ instance, entries, apply: true })
          }}
        >
          {t('ojsPush.applyLabel', 'apply')}
        </Button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
      <PushSummaryView summary={summary} t={t} />
    </section>
  )
}

/**
 * Push back metadata to OJS. Phase 4 ships the structured payload + dry-run
 * preview so editors can see what would be sent before any production
 * traffic. The actual entries (which submissionId/publicationId tie to
 * which article) need to be threaded in by the caller — for Phase 4 the
 * panel renders empty if `entries` aren't provided, deliberately requiring
 * an explicit hook-up before any PUTs land in OJS.
 */
export default function OjsPushPanel({
  pageNumberEntries = [],
  doiEntries = [],
  bioEntries = [],
}) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { instances } = useOjsInstances()
  const [instance, setInstance] = useState('staging')

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t('ojsPush.title', 'Push to OJS')}</h3>
        <p className={styles.subtitle}>
          {t(
            'ojsPush.subtitle',
            'Send page numbers, DOIs, and author bios back to the journal management system. Defaults to dry-run; nothing is sent until you click "apply".'
          )}
        </p>
      </header>

      <div className={styles.targetRow}>
        <label className={styles.targetLabel}>
          {t('ojsPush.target', 'OJS target')}
        </label>
        {instances && instances.length > 0 ? (
          <select
            className={styles.targetSelect}
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
          >
            {instances.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        ) : (
          <Field
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
          />
        )}
      </div>

      <PushSection
        titleKey="ojsPush.pages.title"
        defaultTitle="Page numbers"
        helpKey="ojsPush.pages.help"
        defaultHelp="Push start_page → 'pages' string for each publication."
        hook={usePushPageNumbersToOjs}
        instance={instance}
        entries={pageNumberEntries}
      />
      <PushSection
        titleKey="ojsPush.dois.title"
        defaultTitle="DOIs"
        helpKey="ojsPush.dois.help"
        defaultHelp="Push DOIs as publication-level identifiers."
        hook={usePushDoisToOjs}
        instance={instance}
        entries={doiEntries}
      />
      <PushSection
        titleKey="ojsPush.bios.title"
        defaultTitle="Author bios"
        helpKey="ojsPush.bios.help"
        defaultHelp="Push author biographies into each publication's authors."
        hook={usePushAuthorBiosToOjs}
        instance={instance}
        entries={bioEntries}
      />
    </section>
  )
}
