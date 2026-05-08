import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOjsInstances } from '../../../hooks/ojs.js'
import { useCorpusPipelineSettings } from '../../../hooks/pipeline.js'
import { Button, Field } from '../../atoms/index.js'

import styles from './PublisherSettings.module.scss'

function OverrideSlot({ kind, label, accept, settingsKey, settings, hooks }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const inputRef = useRef(null)
  const [pending, setPending] = useState(null)
  const currentRef = settings?.[settingsKey] || ''

  return (
    <div className={styles.overrideRow}>
      <header>
        <strong>{label}</strong>
        {currentRef ? (
          <span className={styles.refSet}>
            {t('publisher.refSet', 'set: {{ref}}', { ref: currentRef })}
          </span>
        ) : (
          <span className={styles.refUnset}>
            {t('publisher.refUnset', 'using bundled default')}
          </span>
        )}
      </header>
      <div className={styles.overrideActions}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => setPending(e.target.files?.[0] || null)}
        />
        <Button
          small
          secondary
          disabled={!pending || hooks.busy}
          onClick={async () => {
            await hooks.uploadOverride({ kind, file: pending })
            setPending(null)
            if (inputRef.current) inputRef.current.value = ''
          }}
        >
          {hooks.busy
            ? t('publisher.uploading', 'uploading…')
            : t('publisher.upload', 'upload')}
        </Button>
        {currentRef && (
          <Button
            small
            link
            disabled={hooks.busy}
            onClick={() => hooks.clearOverride({ kind })}
          >
            {t('publisher.clear', 'clear override')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Per-corpus publisher settings: template + CSS overrides, OJS target,
 * Prince toggle. Lives on the Production page next to the build panel.
 */
export default function PublisherSettings({ corpusId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const hooks = useCorpusPipelineSettings({ corpusId })
  const { instances } = useOjsInstances()

  const [ojsTargetId, setOjsTargetId] = useState('')
  const [staticDeployTargetId, setStaticDeployTargetId] = useState('')
  const [princeEnabled, setPrinceEnabled] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    if (hooks.settings) {
      setOjsTargetId(hooks.settings.ojsTargetId || '')
      setStaticDeployTargetId(hooks.settings.staticDeployTargetId || '')
      setPrinceEnabled(Boolean(hooks.settings.princeEnabled))
    }
  }, [hooks.settings])

  const onSubmit = async (e) => {
    e.preventDefault()
    const result = await hooks.saveSettings({
      ojsTargetId,
      staticDeployTargetId,
      princeEnabled,
    })
    if (result) setSavedAt(new Date())
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {t('publisher.title', 'Publisher settings')}
        </h3>
        <p className={styles.subtitle}>
          {t(
            'publisher.subtitle',
            'Per-corpus configuration that drives the publishing pipeline.'
          )}
        </p>
      </header>

      {hooks.error && <p className={styles.error}>{hooks.error}</p>}

      <fieldset className={styles.fieldset}>
        <legend>{t('publisher.overrides', 'Template and CSS overrides')}</legend>
        <p className={styles.help}>
          {t(
            'publisher.overridesHelp',
            'Drop a custom Pandoc HTML5 template or print CSS to override the bundled defaults for this corpus only.'
          )}
        </p>
        <OverrideSlot
          kind="template"
          settingsKey="templateId"
          label={t('publisher.templateLabel', 'Pandoc HTML5 template')}
          accept=".html5,.html,.htm"
          settings={hooks.settings}
          hooks={hooks}
        />
        <OverrideSlot
          kind="css"
          settingsKey="cssOverrideRef"
          label={t('publisher.cssLabel', 'Print CSS override')}
          accept=".css"
          settings={hooks.settings}
          hooks={hooks}
        />
      </fieldset>

      <form className={styles.fieldset} onSubmit={onSubmit}>
        <legend>{t('publisher.targets', 'Targets')}</legend>
        <div className={styles.targetsGrid}>
          <label className={styles.targetLabel}>
            {t('publisher.ojsTarget', 'OJS target id')}
            {instances && instances.length > 0 ? (
              <select
                className={styles.select}
                value={ojsTargetId}
                onChange={(e) => setOjsTargetId(e.target.value)}
              >
                <option value="">{t('publisher.unset', '(unset)')}</option>
                {instances.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            ) : (
              <Field
                value={ojsTargetId}
                onChange={(e) => setOjsTargetId(e.target.value)}
              />
            )}
          </label>
          <label className={styles.targetLabel}>
            {t('publisher.staticDeployTarget', 'Static-deploy target id')}
            <Field
              value={staticDeployTargetId}
              onChange={(e) => setStaticDeployTargetId(e.target.value)}
            />
          </label>
        </div>
        <label className={styles.princeRow}>
          <input
            type="checkbox"
            checked={princeEnabled}
            onChange={(e) => setPrinceEnabled(e.target.checked)}
          />
          <span>
            {t(
              'publisher.princeEnabled',
              'Allow PrinceXML engine for this corpus (requires container rebuild)'
            )}
          </span>
        </label>
        <div className={styles.formFooter}>
          <Button primary type="submit" disabled={hooks.busy}>
            {hooks.busy
              ? t('publisher.saving', 'saving…')
              : t('publisher.save', 'save settings')}
          </Button>
          {savedAt && !hooks.error && (
            <span className={styles.saved}>
              {t('publisher.savedAt', 'saved at {{when}}', {
                when: savedAt.toLocaleTimeString(),
              })}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}
