import clsx from 'clsx'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import slugify from 'slugify'

import { applicationConfig } from '../../../config.js'
import {
  useArticleVersion,
  useEditableArticle,
} from '../../../hooks/article.js'
import {
  isPandocEndpointUsable,
  useStyloExportPreview,
} from '../../../hooks/stylo-export.js'
import { buildPreviewWithMetadataHeader } from '../../../helpers/previewMetadata.js'
import previewImaginationsCss from '../../../styles/preview-imaginations.css?raw'

import { Button, Select } from '../../atoms/index.js'

import buttonStyles from '../../atoms/Button.module.scss'
import formStyles from '../../molecules/form.module.scss'
import styles from './Export.module.scss'

const FORMAT_MARKDOWN = 'markdown'
const FORMAT_HTML = 'html'

/**
 * Trigger a client-side download of the given content.
 * @param {{content: BlobPart, filename: string, mimeType: string}} args
 */
function downloadBlob({ content, filename, mimeType }) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  /* Revoke on the next tick: revoking immediately races with the click handler
     in some browsers and aborts the download. */
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Compose a stand-alone HTML document from a body fragment, embedding the
 * Imaginations preview stylesheet so the export looks like the in-app
 * "faithful preview" without depending on the Stylo CSS bundle.
 * @param {{title: string, bodyHtml: string}} args
 * @returns {string}
 */
function buildHtmlDocument({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${previewImaginationsCss}
</style>
</head>
<body class="stylo-preview-imaginations">
${bodyHtml}
</body>
</html>
`
}

/**
 * Concatenate the YAML front matter and the markdown body the way Stylo
 * stores articles on disk and the way the editor's "draft view" shows the
 * source. The GraphQL `yaml(strip_markdown: true)` output is already wrapped
 * in `---\n...---`, so we only need to ensure a separating newline.
 * @param {{yaml?: string|null, md?: string|null}} args
 * @returns {string}
 */
function buildMarkdownContent({ yaml, md }) {
  const yamlPart = yaml ? (yaml.endsWith('\n') ? yaml : yaml + '\n') : ''
  const body = md ?? ''
  if (!yamlPart) return body
  return body.startsWith('\n') ? yamlPart + body : yamlPart + '\n' + body
}

/**
 * @param {object} props
 * @param {string?} props.bookId
 * @param {string?} props.articleVersionId - deprecated alias of versionId
 * @param {string?} props.versionId
 * @param {string?} props.articleId
 * @param {string} props.name
 * @param {() => void} [props.onCancel]
 * @returns {React.ReactElement}
 */
export default function Export({
  bookId,
  articleVersionId = '',
  versionId: versionIdProp,
  articleId,
  name,
  onCancel,
}) {
  const { t } = useTranslation()
  const versionId = versionIdProp ?? articleVersionId ?? ''
  const [format, setFormat] = useState(FORMAT_MARKDOWN)

  const filenameBase = useMemo(
    () => slugify(name || 'export', { strict: true, lower: true }) || 'export',
    [name]
  )

  const exportEndpointUsable = useMemo(
    () => isPandocEndpointUsable(applicationConfig.pandocExportEndpoint),
    []
  )

  const isCorpus = !!bookId && !articleId
  const { pandocExportHost, pandocExportEndpoint } = applicationConfig

  /* The corpus export still goes through the pandoc-export microservice
     because building an assembled HTML/Markdown for a multi-article corpus
     client-side would require fetching every working version and stitching
     them, which is out of scope for this simplification. */
  const corpusExportUrl = useMemo(() => {
    if (!bookId) return ''
    const formatsParam = format === FORMAT_MARKDOWN ? 'originals' : 'html'
    return `${pandocExportEndpoint}/generique/corpus/export/${pandocExportHost}/${bookId}/${filenameBase}/?with_toc=0&with_nocite=1&with_link_citations=1&with_ascii=0&formats=${formatsParam}`
  }, [bookId, filenameBase, format, pandocExportEndpoint, pandocExportHost])

  return (
    <>
      <section className={styles.export}>
        <form className={formStyles.form}>
          <Select
            id="export-format"
            label={t('export.format.label')}
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value={FORMAT_MARKDOWN}>
              {t('export.format.markdown')}
            </option>
            <option value={FORMAT_HTML}>{t('export.format.html')}</option>
          </Select>

          {!isCorpus &&
            format === FORMAT_HTML &&
            !exportEndpointUsable && (
              <p className={styles.disabledNotice}>
                {t('export.html.endpointUnavailable')}
              </p>
            )}
        </form>
      </section>

      <footer className={styles.actions}>
        {onCancel && (
          <Button
            aria-label={t('modal.cancelButton.label')}
            secondary
            onClick={() => onCancel()}
          >
            {t('modal.cancelButton.text')}
          </Button>
        )}
        {isCorpus ? (
          <a
            className={clsx(buttonStyles.button, buttonStyles.primary)}
            href={corpusExportUrl}
            rel="noreferrer noopener"
            target="_blank"
            role="button"
          >
            {t('export.downloadButton.text')}
          </a>
        ) : (
          <ArticleExportButton
            articleId={articleId}
            versionId={versionId}
            format={format}
            filenameBase={filenameBase}
            name={name}
            onCancel={onCancel}
            exportEndpointUsable={exportEndpointUsable}
          />
        )}
      </footer>
    </>
  )
}

/**
 * Article-only download button. Lives in its own component so the article
 * GraphQL hooks (`useEditableArticle`, `useArticleVersion`) are never called
 * with empty IDs in the corpus path.
 * @param {object} props
 * @param {string} props.articleId
 * @param {string} props.versionId
 * @param {string} props.format - 'markdown' | 'html'
 * @param {string} props.filenameBase
 * @param {string} [props.name]
 * @param {() => void} [props.onCancel]
 * @param {boolean} props.exportEndpointUsable
 * @returns {React.ReactElement}
 */
function ArticleExportButton({
  articleId,
  versionId,
  format,
  filenameBase,
  name,
  onCancel,
  exportEndpointUsable,
}) {
  const { t } = useTranslation()
  /* `useEditableArticle`'s `hasVersion` flag is `typeof versionId === 'string'`,
     so an empty string would request the (nonexistent) version "" instead of
     the working copy. Normalize to `undefined` for the working-copy case. */
  const effectiveVersionId = versionId || undefined
  const { article } = useEditableArticle({
    articleId,
    versionId: effectiveVersionId,
  })
  const { version } = useArticleVersion({ versionId: effectiveVersionId })

  const md = effectiveVersionId ? version?.md : article?.workingVersion?.md
  const yaml = effectiveVersionId
    ? version?.yaml
    : article?.workingVersion?.yaml
  const metadata = effectiveVersionId
    ? version?.metadata
    : article?.workingVersion?.metadata
  const bib = effectiveVersionId
    ? version?.bib
    : article?.workingVersion?.bib

  const wantsHtml = format === FORMAT_HTML
  const { html: previewHtml, isLoading: isHtmlLoading } = useStyloExportPreview(
    {
      md_content: wantsHtml ? md : undefined,
      yaml_content: yaml,
      bib_content: bib,
      with_toc: false,
      with_nocite: true,
      with_link_citations: true,
    }
  )

  const markdownReady = md !== undefined && md !== null
  const htmlReady = wantsHtml && !!previewHtml && !isHtmlLoading

  const handleDownload = useCallback(() => {
    if (format === FORMAT_MARKDOWN) {
      downloadBlob({
        content: buildMarkdownContent({ yaml, md }),
        filename: `${filenameBase}.md`,
        mimeType: 'text/markdown;charset=utf-8',
      })
      onCancel?.()
      return
    }
    if (format === FORMAT_HTML && previewHtml) {
      const { fullArticleHtml } = buildPreviewWithMetadataHeader(
        metadata,
        previewHtml
      )
      const html = buildHtmlDocument({
        title: name || filenameBase,
        bodyHtml: fullArticleHtml || previewHtml,
      })
      downloadBlob({
        content: html,
        filename: `${filenameBase}.html`,
        mimeType: 'text/html;charset=utf-8',
      })
      onCancel?.()
    }
  }, [filenameBase, format, md, metadata, name, onCancel, previewHtml, yaml])

  const canDownload =
    format === FORMAT_MARKDOWN
      ? markdownReady
      : htmlReady && exportEndpointUsable

  return (
    <Button primary onClick={handleDownload} disabled={!canDownload}>
      {format === FORMAT_HTML && isHtmlLoading
        ? t('export.downloadButton.preparing')
        : t('export.downloadButton.text')}
    </Button>
  )
}
