import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useDeployTargets,
  useStartStaticDeploy,
} from '../../../hooks/pipeline.js'
import { Button, Field } from '../../atoms/index.js'

import styles from './StaticDeployPanel.module.scss'

const DEFAULT_KIND = 's3'
const KINDS = ['s3', 'ftp', 'gcs', 'netlify']

/**
 * Helper editor for a single deploy target. Rendered inline beneath the
 * select so adding/editing is one click away. Phase 6 ships generic JSON
 * editors for `config` and `credentials`; per-kind structured forms can
 * land later as the FTP/GCS/Netlify adapters come online.
 */
function TargetForm({ target, onSubmit, onCancel, t }) {
  const initial = useMemo(() => ({
    name: target?.name || '',
    kind: target?.kind || DEFAULT_KIND,
    config: target?.config ? JSON.stringify(target.config, null, 2) : '{}',
    credentials: '',
  }), [target])
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => setDraft(initial), [initial])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    let configObj
    try {
      configObj = draft.config.trim() ? JSON.parse(draft.config) : {}
    } catch {
      setError(t('staticDeploy.form.invalidConfig', 'config: invalid JSON'))
      setBusy(false)
      return
    }
    let credentialsObj
    if (draft.credentials.trim()) {
      try {
        credentialsObj = JSON.parse(draft.credentials)
      } catch {
        setError(
          t('staticDeploy.form.invalidCredentials', 'credentials: invalid JSON')
        )
        setBusy(false)
        return
      }
    }
    const result = await onSubmit({
      name: draft.name,
      kind: draft.kind,
      config: configObj,
      ...(credentialsObj !== undefined ? { credentials: credentialsObj } : {}),
    })
    setBusy(false)
    if (!result) {
      setError(t('staticDeploy.form.failed', 'save failed'))
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <Field
          label={t('staticDeploy.form.name', 'Display name')}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <label className={styles.kindLabel}>
          {t('staticDeploy.form.kind', 'Adapter')}
          <select
            className={styles.kindSelect}
            value={draft.kind}
            disabled={Boolean(target)}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t('staticDeploy.form.config', 'Config (JSON)')}
        <textarea
          rows={6}
          className={styles.textarea}
          value={draft.config}
          onChange={(e) => setDraft({ ...draft, config: e.target.value })}
        />
      </label>
      <label>
        {t(
          'staticDeploy.form.credentials',
          'Credentials (JSON, leave blank to keep existing)'
        )}
        <textarea
          rows={5}
          className={styles.textarea}
          value={draft.credentials}
          onChange={(e) =>
            setDraft({ ...draft, credentials: e.target.value })
          }
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.formFooter}>
        <Button primary type="submit" disabled={busy}>
          {busy
            ? t('staticDeploy.form.saving', 'saving…')
            : t('staticDeploy.form.save', 'save target')}
        </Button>
        <Button link type="button" onClick={onCancel}>
          {t('staticDeploy.form.cancel', 'cancel')}
        </Button>
      </div>
    </form>
  )
}

export default function StaticDeployPanel({ corpusId, workspaceId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { targets, refresh, create, update, remove, error } =
    useDeployTargets({ workspaceId })
  const { start, job, isRunning, error: deployError } = useStartStaticDeploy({
    corpusId,
  })

  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | targetId

  useEffect(() => {
    if (!selectedId && targets.length > 0) setSelectedId(targets[0]._id)
  }, [selectedId, targets])

  const selected = targets.find((tg) => tg._id === selectedId) || null
  const editingTarget =
    editing === 'new'
      ? null
      : targets.find((tg) => tg._id === editing) || null

  const summary = job?.params?.summary

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {t('staticDeploy.title', 'Static publishing')}
        </h3>
        <p className={styles.subtitle}>
          {t(
            'staticDeploy.subtitle',
            'Push the corpus’ ready artefacts to a static host. Targets carry encrypted credentials; FTP/GCS/Netlify adapters are stubs in this build (S3 is real).'
          )}
        </p>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.targetRow}>
        <label className={styles.targetLabel}>
          {t('staticDeploy.target', 'Target')}
        </label>
        <select
          className={styles.targetSelect}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {targets.length === 0 && (
            <option value="">
              {t('staticDeploy.noTargets', '(no targets yet)')}
            </option>
          )}
          {targets.map((tg) => (
            <option key={tg._id} value={tg._id}>
              {tg.name} ({tg.kind})
            </option>
          ))}
        </select>
        <Button small secondary onClick={() => setEditing('new')}>
          {t('staticDeploy.addTarget', '+ new target')}
        </Button>
        {selected && (
          <Button small link onClick={() => setEditing(selected._id)}>
            {t('staticDeploy.editTarget', 'edit')}
          </Button>
        )}
        {selected && (
          <Button
            small
            link
            onClick={async () => {
              if (
                window.confirm(
                  t(
                    'staticDeploy.confirmDelete',
                    'Delete deploy target {{name}}?',
                    { name: selected.name }
                  )
                )
              ) {
                await remove(selected._id)
                setSelectedId('')
              }
            }}
          >
            {t('staticDeploy.deleteTarget', 'delete')}
          </Button>
        )}
      </div>

      {editing && (
        <TargetForm
          target={editingTarget}
          t={t}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            const result = editingTarget
              ? await update(editingTarget._id, {
                  name: input.name,
                  config: input.config,
                  ...(input.credentials !== undefined
                    ? { credentials: input.credentials }
                    : {}),
                })
              : await create(input)
            if (result) {
              setEditing(null)
              setSelectedId(result._id)
              await refresh()
            }
            return result
          }}
        />
      )}

      <div className={styles.deployRow}>
        <Button
          secondary
          disabled={isRunning || !selectedId}
          onClick={() => start({ targetId: selectedId, dryRun: true })}
        >
          {t('staticDeploy.dryRun', 'dry-run deploy')}
        </Button>
        <Button
          primary
          disabled={isRunning || !selectedId}
          onClick={() => start({ targetId: selectedId, dryRun: false })}
        >
          {t('staticDeploy.deploy', 'deploy')}
        </Button>
        {job && (
          <span className={styles.status} data-status={job.status}>
            {job.status}
            {job.status === 'running' && (
              <> · {Math.round((job.progress ?? 0) * 100)}%</>
            )}
          </span>
        )}
        {deployError && <span className={styles.error}>{deployError}</span>}
      </div>

      {summary && (
        <div className={styles.summary}>
          <p className={styles.summaryHeader}>
            {summary.dryRun
              ? t(
                  'staticDeploy.summary.dryRun',
                  '{{n}} item(s) ready (dry run)',
                  { n: summary.items?.length || 0 }
                )
              : t('staticDeploy.summary.applied', '{{n}} item(s) applied', {
                  n: summary.applied || 0,
                })}
          </p>
          <details>
            <summary>
              {t('staticDeploy.summary.details', 'show details')}
            </summary>
            <pre className={styles.summaryDetails}>
              {JSON.stringify(summary.items || [], null, 2)}
            </pre>
          </details>
        </div>
      )}
    </section>
  )
}
