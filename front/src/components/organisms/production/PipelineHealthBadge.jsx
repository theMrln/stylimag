import { useTranslation } from 'react-i18next'

import { usePipelineHealth } from '../../../hooks/pipeline.js'

import styles from './PipelineHealthBadge.module.scss'

function describe(health) {
  if (!health) return { ok: false, label: 'unknown', detail: '' }
  if (health.ok) {
    const pandocVersion = health.pandoc?.version || 'pandoc'
    const chromeVersion = health.chromium?.version || 'chromium'
    return { ok: true, label: 'pipeline ready', detail: `${pandocVersion} · ${chromeVersion}` }
  }
  const detail = health.error
    ? health.error
    : !health.pandoc?.ok
      ? 'pandoc unavailable'
      : !health.chromium?.ok
        ? 'chromium unavailable'
        : !health.storage?.ok
          ? 'object storage not configured'
          : 'pipeline degraded'
  return { ok: false, label: 'pipeline degraded', detail }
}

/**
 * Compact green/red badge that surfaces the pipeline service's /health.
 * Replaces imaginations-issue-template's DependencyChecker (which inspected
 * locally-installed binaries on the user's machine — not relevant in a
 * container deploy where the pipeline image guarantees them).
 */
export default function PipelineHealthBadge() {
  const { t } = useTranslation('production', { useSuspense: false })
  const { health, loading, refresh } = usePipelineHealth()
  const { ok, label, detail } = describe(health)

  return (
    <button
      type="button"
      className={`${styles.badge} ${ok ? styles.ok : styles.degraded}`}
      onClick={refresh}
      title={detail || t('pipelineHealth.refresh', 'refresh health')}
      aria-label={`${label}: ${detail}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>
        {loading ? t('pipelineHealth.checking', 'checking…') : label}
      </span>
    </button>
  )
}
