import { useTranslation } from 'react-i18next'

import { useArticleArtefacts } from '../../../hooks/pipeline.js'
import { Button } from '../../atoms/index.js'
import { Loading } from '../../molecules/index.js'

import styles from './ArticleArtefacts.module.scss'

/**
 * Order matters: editors usually want the rendered PDF first, then the
 * HTML, then the cover variants. Anything else (page-numbers result,
 * etc.) shows up under the canonical kinds in encounter order.
 */
const KIND_ORDER = [
  'article-pdf',
  'article-html',
  'article-cover',
  'cover-thumbnail',
]

const KIND_LABELS = {
  'article-pdf': 'Article PDF',
  'article-html': 'Article HTML',
  'article-cover': 'Cover page',
  'cover-thumbnail': 'Cover thumbnail',
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export default function ArticleArtefacts() {
  const { t } = useTranslation()
  // articleId is on the route loader; CollaborativeEditor renders this
  // via EditorMenuContent which already pulls from useParams there. Read
  // it from the URL to avoid prop-drilling through EditorMenuContent —
  // the editor menu's other panels do the same.
  const articleId = window.location.pathname.match(
    /\/article\/([a-f\d]{24})/i
  )?.[1]
  const { artefacts, loading, error, refresh } = useArticleArtefacts({
    articleId,
  })

  if (!articleId) return null

  const sorted = [...artefacts].sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a.kind)
    const bi = KIND_ORDER.indexOf(b.kind)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('articleFiles.title', 'Files')}</h2>
        <Button small link onClick={refresh}>
          {t('articleFiles.refresh', 'refresh')}
        </Button>
      </header>
      {loading && artefacts.length === 0 ? (
        <Loading />
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : sorted.length === 0 ? (
        <p className={styles.empty}>
          {t(
            'articleFiles.empty',
            'No published files yet. Build the article PDF from the corpus production page to see download links here.'
          )}
        </p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((a) => (
            <li key={a._id} className={styles.row} data-kind={a.kind}>
              <div className={styles.rowText}>
                <strong className={styles.kind}>
                  {t(
                    `articleFiles.kind.${a.kind}`,
                    KIND_LABELS[a.kind] || a.kind
                  )}
                </strong>
                <span className={styles.meta}>
                  {a.format ? a.format.toUpperCase() : ''}
                  {a.size ? ` · ${formatBytes(a.size)}` : ''}
                  {a.createdAt
                    ? ` · ${new Date(a.createdAt).toLocaleString()}`
                    : ''}
                </span>
              </div>
              {a.presignedUrl ? (
                <a
                  className={styles.download}
                  href={a.presignedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('articleFiles.download', 'download')}
                </a>
              ) : (
                <span className={styles.unavailable}>
                  {t('articleFiles.unavailable', 'no link')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
