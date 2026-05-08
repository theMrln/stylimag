import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'

import styles from './ArticleFootnotes.module.scss'

/**
 * Pandoc-style footnote panel: lists every `[^ref]: …` definition along
 * with how many inline references point at it. Click a row to nudge the
 * editor caret to the definition line — the editor listens for the same
 * `UPDATE_LINE` action that ArticleTableOfContents uses.
 */
export default function ArticleFootnotes() {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const footnotes = useSelector((state) => state.articleFootnotes || [])

  const jumpTo = (line) => {
    if (line == null) return
    dispatch({ type: 'UPDATE_LINE', selectedLine: line })
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>{t('footnotes.title', 'Footnotes')}</h2>
      {footnotes.length === 0 ? (
        <p className={styles.empty}>
          {t(
            'footnotes.empty',
            'No footnotes detected. Use Pandoc syntax: `[^name]` in the body and `[^name]: …` to define.'
          )}
        </p>
      ) : (
        <ul className={styles.list}>
          {footnotes.map((fn) => {
            const orphaned = fn.definitionLine == null
            const unused = !orphaned && fn.referenceLines.length === 0
            return (
              <li
                key={fn.ref}
                className={styles.item}
                data-status={
                  orphaned ? 'orphaned' : unused ? 'unused' : 'ok'
                }
              >
                <button
                  type="button"
                  className={styles.itemHeader}
                  onClick={() =>
                    jumpTo(
                      fn.definitionLine ?? fn.referenceLines[0] ?? 0
                    )
                  }
                  title={t(
                    'footnotes.jump',
                    'Jump to footnote {{ref}} on line {{line}}',
                    {
                      ref: fn.ref,
                      line:
                        (fn.definitionLine ?? fn.referenceLines[0] ?? 0) +
                        1,
                    }
                  )}
                >
                  <span className={styles.ref}>[^{fn.ref}]</span>
                  <span className={styles.refCount}>
                    {orphaned
                      ? t('footnotes.orphaned', 'orphaned')
                      : unused
                        ? t('footnotes.unused', 'unused')
                        : t('footnotes.refs', '{{n}}×', {
                            n: fn.referenceLines.length,
                          })}
                  </span>
                </button>
                {fn.definition && (
                  <p className={styles.definition}>{fn.definition}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
