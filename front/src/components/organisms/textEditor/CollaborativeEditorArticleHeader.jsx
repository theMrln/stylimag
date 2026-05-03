import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { Toggle } from '../../molecules/index.js'
import {
  formatAuthorsForLocaleAsLines,
  getLocalizedValue,
} from '../../../helpers/ojsMapper.js'

import CollaborativeEditorActiveVersion from './CollaborativeEditorActiveVersion.jsx'
import CollaborativeEditorWriters from './CollaborativeEditorWriters.jsx'

import styles from './CollaborativeEditorArticleHeader.module.scss'

/**
 * Map an i18next short locale to the OJS-shaped locale used in metadata.
 * Falls back to en_US for any unknown short locale.
 * @param {string|undefined} short
 * @returns {{ primary: string, secondary: string }}
 */
function localePair(short) {
  if (short && short.toLowerCase().startsWith('fr')) {
    return { primary: 'fr_CA', secondary: 'en_US' }
  }
  return { primary: 'en_US', secondary: 'fr_CA' }
}

/**
 * Best-effort author list extraction. Supports OJS-shaped authors (with
 * `givenName`/`familyName` localized objects) as well as plain strings or
 * simple `{ name }` shapes that legacy articles may use.
 * @param {unknown} authors
 * @param {string} locale
 * @returns {string[]}
 */
function authorsToLines(authors, locale) {
  if (!Array.isArray(authors) || authors.length === 0) return []
  const ojs = formatAuthorsForLocaleAsLines(authors, locale)
  if (ojs.length > 0) return ojs
  return authors
    .map((a) => {
      if (typeof a === 'string') return a.trim()
      if (a && typeof a === 'object') {
        if (typeof a.name === 'string') return a.name.trim()
        const given =
          getLocalizedValue(a.givenName, locale) || (a.forename || '').trim()
        const family =
          getLocalizedValue(a.familyName, locale) || (a.surname || '').trim()
        if (given && family) return `${given} ${family}`
        return family || given || ''
      }
      return ''
    })
    .filter(Boolean)
}

/**
 * @param {object} props
 * @param {string} props.articleTitle
 * @param {string|undefined} props.versionId
 * @param {object|undefined} [props.metadata] - OJS-shaped metadata used to surface authors below the title
 * @returns {import('react').ReactElement}
 */
export default function CollaborativeEditorArticleHeader({
  articleTitle,
  versionId,
  metadata,
}) {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const searchParamMode = useMemo(
    () => searchParams.get('mode'),
    [searchParams]
  )

  const authorsText = useMemo(() => {
    const { primary, secondary } = localePair(i18n.language)
    const list = metadata?.authors
    let lines = authorsToLines(list, primary)
    if (lines.length === 0) {
      lines = authorsToLines(list, secondary)
    }
    return lines.join(', ')
  }, [metadata, i18n.language])

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{articleTitle}</h1>
      {authorsText && (
        <p className={styles.authors} aria-label={t('article.editor.authorsLabel')}>
          {authorsText}
        </p>
      )}

      <div className={styles.row}>
        <Toggle
          id="preview-mode"
          checked={searchParamMode === 'preview'}
          title={t('article.editor.preview')}
          onChange={(checked) =>
            setSearchParams(checked ? { mode: 'preview' } : {})
          }
        >
          {t('article.editor.preview')}
        </Toggle>

        <div className={styles.writers}>
          <CollaborativeEditorWriters />
        </div>
      </div>
      <CollaborativeEditorActiveVersion versionId={versionId} />
    </header>
  )
}
