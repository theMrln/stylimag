import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCorpusIssueMetadata } from '../../../hooks/pipeline.js'
import { Button, Field } from '../../atoms/index.js'
import { Loading } from '../../molecules/index.js'

import styles from './IssueMetadataPanel.module.scss'

const EDITOR_KEYS = [
  ['familyName', 'Family name'],
  ['givenName', 'Given name'],
  ['email', 'Email'],
  ['ORCID', 'ORCID'],
  ['affiliation', 'Affiliation'],
  ['bio', 'Bio'],
]

const IMAGE_CREDIT_LOCALES = ['en', 'en_US', 'fr', 'fr_CA']

function emptyEditor() {
  return {
    familyName: '',
    givenName: '',
    email: '',
    ORCID: '',
    affiliation: '',
    bio: '',
  }
}

function normaliseImageCredit(raw) {
  const out = {}
  if (raw && typeof raw === 'object') {
    for (const k of IMAGE_CREDIT_LOCALES) {
      if (typeof raw[k] === 'string') out[k] = raw[k]
    }
  }
  return out
}

export default function IssueMetadataPanel({ corpusId }) {
  const { t } = useTranslation('production', { useSuspense: false })
  const { data, loading, error, save } = useCorpusIssueMetadata({ corpusId })

  const [editors, setEditors] = useState([])
  const [imageCredit, setImageCredit] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    if (data) {
      setEditors(
        Array.isArray(data.editors) && data.editors.length
          ? data.editors.map((e) => ({ ...emptyEditor(), ...e }))
          : []
      )
      setImageCredit(normaliseImageCredit(data.imageCredit))
    }
  }, [data])

  const updateEditor = (idx, field, value) => {
    setEditors((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const moveEditor = (idx, delta) => {
    setEditors((prev) => {
      const next = [...prev]
      const target = idx + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      const result = await save({ editors, imageCredit })
      if (result) setSavedAt(new Date())
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Loading />

  return (
    <form className={styles.panel} onSubmit={onSubmit}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {t('issueMetadata.title', 'Issue metadata')}
        </h3>
        <p className={styles.subtitle}>
          {t(
            'issueMetadata.subtitle',
            'Editors and cover-image credit. Local-only — never pushed back to OJS.'
          )}
        </p>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <fieldset className={styles.fieldset}>
        <legend>{t('issueMetadata.editors', 'Editors')}</legend>
        {editors.length === 0 && (
          <p className={styles.empty}>
            {t('issueMetadata.noEditors', 'No editors yet — add one below.')}
          </p>
        )}
        {editors.map((editor, idx) => (
          <div key={idx} className={styles.editorRow}>
            <header className={styles.editorRowHeader}>
              <strong>
                {t('issueMetadata.editorN', 'Editor {{n}}', { n: idx + 1 })}
              </strong>
              <span className={styles.editorRowActions}>
                <Button
                  small
                  link
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveEditor(idx, -1)}
                >
                  ↑
                </Button>
                <Button
                  small
                  link
                  type="button"
                  disabled={idx === editors.length - 1}
                  onClick={() => moveEditor(idx, 1)}
                >
                  ↓
                </Button>
                <Button
                  small
                  link
                  type="button"
                  onClick={() =>
                    setEditors((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  {t('issueMetadata.remove', 'remove')}
                </Button>
              </span>
            </header>
            <div className={styles.editorFields}>
              {EDITOR_KEYS.map(([key, label]) => (
                <Field
                  key={key}
                  label={t(`issueMetadata.field.${key}`, label)}
                  value={editor[key] ?? ''}
                  onChange={(e) => updateEditor(idx, key, e.target.value)}
                />
              ))}
            </div>
          </div>
        ))}
        <Button
          small
          secondary
          type="button"
          onClick={() => setEditors((prev) => [...prev, emptyEditor()])}
        >
          {t('issueMetadata.addEditor', '+ add editor')}
        </Button>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>{t('issueMetadata.imageCredit', 'Cover image credit')}</legend>
        <div className={styles.editorFields}>
          {IMAGE_CREDIT_LOCALES.map((locale) => (
            <Field
              key={locale}
              label={locale}
              value={imageCredit[locale] ?? ''}
              onChange={(e) =>
                setImageCredit((prev) => ({
                  ...prev,
                  [locale]: e.target.value,
                }))
              }
            />
          ))}
        </div>
      </fieldset>

      <footer className={styles.footer}>
        <Button primary type="submit" disabled={saving}>
          {saving
            ? t('issueMetadata.saving', 'saving…')
            : t('issueMetadata.save', 'save metadata')}
        </Button>
        {saveError && <span className={styles.error}>{saveError}</span>}
        {savedAt && !saveError && (
          <span className={styles.saved}>
            {t('issueMetadata.savedAt', 'saved at {{when}}', {
              when: savedAt.toLocaleTimeString(),
            })}
          </span>
        )}
      </footer>
    </form>
  )
}
