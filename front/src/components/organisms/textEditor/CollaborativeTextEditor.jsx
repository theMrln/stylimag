import clsx from 'clsx'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import { MonacoBinding } from 'y-monaco'
import { FolderUp, Upload } from 'lucide-react'

import {
  MarkdownMenu,
  MetopesMenu,
  Separator,
  actions,
  registerActions,
} from './actions'
import { DiffEditor } from '@monaco-editor/react'
import throttle from 'lodash.throttle'
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'

import { useArticleVersion, useEditableArticle } from '../../../hooks/article.js'
import { useBibliographyCompletion } from '../../../hooks/bibliography.js'
import { useCollaboration } from '../../../hooks/collaboration.js'
import { useModal } from '../../../hooks/modal.js'
import {
  isPandocEndpointUsable,
  resolvePreviewEngine,
  useStyloExportPreview,
} from '../../../hooks/stylo-export.js'
import { useLitePreview } from '../../../hooks/lite-preview.js'
import { applicationConfig } from '../../../config.js'
import { buildPreviewWithMetadataHeader } from '../../../helpers/previewMetadata.js'
import defaultEditorOptions from '../monaco/options.js'
import {
  onDropIntoEditor,
  importMarkdownContent,
  processMarkdownImageLinks,
  readFileAsText,
} from '../bibliography/support.js'
import previewImaginationsCss from '../../../styles/preview-imaginations.css?raw'

import Alert from '../../molecules/Alert.jsx'
import Button from '../../atoms/Button.jsx'
import Loading from '../../molecules/Loading.jsx'
import { Toggle } from '../../molecules/index.js'
import MonacoEditor from '../../molecules/MonacoEditor.jsx'
import CollaborativeEditorArticleHeader from './CollaborativeEditorArticleHeader.jsx'
import CollaborativeEditorWebSocketStatus from './CollaborativeEditorWebSocketStatus.jsx'
import MarkdownImportModal from '../MarkdownImportModal.jsx'

import styles from './CollaborativeTextEditor.module.scss'

/**
 * @typedef {import('monaco-editor').editor.IStandaloneCodeEditor} IStandaloneCodeEditor
 * @typedef {import('monaco-editor')} monaco
 */

/**
 * @param {object} props
 * @param {string} props.articleId
 * @param {string|undefined} props.versionId
 * @param {'write' | 'compare' | 'preview'} props.mode
 * @returns {Element}
 */
export default function CollaborativeTextEditor({
  articleId,
  versionId,
  mode,
}) {
  const { yText, awareness, websocketStatus, dynamicStyles } = useCollaboration(
    { articleId, versionId }
  )
  const { t } = useTranslation('editor')
  const { t: tCommon } = useTranslation()
  
  // Markdown import state
  const importModal = useModal()
  const [pendingImportFile, setPendingImportFile] = useState(null)
  const [pendingCompanionFiles, setPendingCompanionFiles] = useState([])
  const [importProcessing, setImportProcessing] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const [previewStyle, setPreviewStyle] = useState('imaginations') // 'imaginations' | 'standard'
  const [previewEngine, setPreviewEngine] = useState(() =>
    resolvePreviewEngine()
  ) // 'lite' | 'export'
  const exportEndpointAvailable = useMemo(
    () => isPandocEndpointUsable(applicationConfig.pandocExportEndpoint),
    []
  )
  const engineLocked = applicationConfig.previewEngine !== 'auto'

  const {
    version,
    error,
    isLoading: isVersionLoading,
  } = useArticleVersion({ versionId })
  const { provider: bibliographyCompletionProvider } =
    useBibliographyCompletion()
  const {
    article,
    bibliography,
    isLoading: isWorkingVersionLoading,
  } = useEditableArticle({
    articleId,
    versionId,
  })

  const isPreviewMode = mode === 'preview'
  const previewMd = isPreviewMode
    ? versionId
      ? version?.md
      : yText?.toString()
    : undefined
  const previewYaml = isPreviewMode
    ? versionId
      ? version?.yaml
      : article?.workingVersion?.yaml
    : undefined
  const previewBib = isPreviewMode
    ? versionId
      ? version?.bib
      : article?.workingVersion?.bib
    : undefined

  // Export engine: runs on the server and honors YAML / BibTeX.
  // Only pass inputs when that engine is active so we don't trigger a SWR
  // POST on every keystroke when the user has picked the lite renderer.
  const { html: exportHtml, isLoading: isExportPreviewLoading } =
    useStyloExportPreview({
      ...(isPreviewMode && previewEngine === 'export'
        ? {
            md_content: previewMd,
            yaml_content: previewYaml,
            bib_content: previewBib,
          }
        : {}),
      with_toc: false,
      with_nocite: true,
      with_link_citations: true,
    })

  // Lite engine: client-only markdown-it + DOMPurify. Synchronous.
  const { html: liteHtml } = useLitePreview(
    isPreviewMode && previewEngine === 'lite' ? { md_content: previewMd } : {}
  )

  const __html = previewEngine === 'lite' ? liteHtml : exportHtml
  const isPreviewLoading =
    previewEngine === 'export' ? isExportPreviewLoading : false

  const dispatch = useDispatch()
  const editorRef = useRef(null)
  const editorCursorPosition = useSelector(
    (state) => state.editorCursorPosition,
    shallowEqual
  )

  const hasVersion = useMemo(() => !!versionId, [versionId])
  const previewMetadata = useMemo(
    () =>
      hasVersion ? version?.metadata : article?.workingVersion?.metadata,
    [hasVersion, version?.metadata, article?.workingVersion?.metadata]
  )
  const previewHtml = useMemo(() => {
    if (mode !== 'preview' || !__html) return __html ?? ''
    const { fullArticleHtml } = buildPreviewWithMetadataHeader(
      previewMetadata,
      __html
    )
    return fullArticleHtml || __html
  }, [mode, __html, previewMetadata])
  const isLoading =
    yText === null ||
    isPreviewLoading ||
    isWorkingVersionLoading ||
    isVersionLoading

  const options = useMemo(
    () => ({
      ...defaultEditorOptions,
      contextmenu: hasVersion ? false : websocketStatus === 'connected',
      readOnly: hasVersion ? true : websocketStatus !== 'connected',
      dropIntoEditor: {
        enabled: true,
      },
    }),
    [websocketStatus, hasVersion]
  )

  const updateArticleStructureAndStats = useCallback(
    throttle(
      ({ text: md }) => {
        dispatch({ type: 'UPDATE_ARTICLE_STATS', md })
        dispatch({ type: 'UPDATE_ARTICLE_STRUCTURE', md })
      },
      250,
      { leading: false, trailing: true }
    ),
    []
  )

  // Handle markdown file dropped or selected
  const handleMarkdownFile = useCallback(
    (file, companions = []) => {
      setPendingImportFile(file)
      setPendingCompanionFiles(companions)
      setImportProgress(null)
      setImportProcessing(false)
      importModal.show()
    },
    [importModal]
  )

  // Handle import confirmation from modal. Image links inside the markdown
  // are persisted upfront — before applying the edit — so the editor only
  // ever sees stable platform URLs. We keep the modal open during the
  // upload phase so the user gets progress feedback; the final
  // `executeEdits` runs after the modal closes (otherwise the surrounding
  // document is inert and `editor.focus()` is silently dropped).
  const handleImportConfirm = useCallback(
    async (mode) => {
      if (!pendingImportFile || !editorRef.current) return

      const file = pendingImportFile
      const companions = pendingCompanionFiles
      setImportProcessing(true)
      setImportProgress({
        processed: 0,
        total: 0,
        uploaded: 0,
        failed: 0,
        skipped: 0,
      })

      let finalContent = ''
      let summary = null
      try {
        const raw = await readFileAsText(file)
        summary = await processMarkdownImageLinks(raw, {
          articleId,
          files: companions,
          onProgress: setImportProgress,
        })
        finalContent = summary.content
        if (summary.failed > 0) {
          console.warn(
            `Markdown import: ${summary.failed}/${summary.total} image link(s) failed to upload; original URL kept.`
          )
        }
      } catch (error) {
        console.error('Failed to import markdown file:', error)
        setImportProcessing(false)
        return
      }

      setPendingImportFile(null)
      setPendingCompanionFiles([])
      setImportProcessing(false)
      setImportProgress(null)
      importModal.close()

      try {
        importMarkdownContent(editorRef.current, finalContent, mode)
      } catch (error) {
        console.error('Failed to apply imported markdown to editor:', error)
      }

      if (summary) {
        const { uploaded, failed, unresolved, unresolvedSamples } = summary
        if (uploaded > 0) {
          toast(tCommon('markdownImport.toastUploaded', { count: uploaded }), {
            type: 'success',
          })
        }
        if (unresolved > 0) {
          const sample = unresolvedSamples.slice(0, 3).join(', ')
          toast(
            tCommon('markdownImport.toastUnresolved', {
              count: unresolved,
              sample,
            }),
            { type: 'warning', autoClose: 8000 }
          )
        }
        if (failed > 0) {
          toast(tCommon('markdownImport.toastFailed', { count: failed }), {
            type: 'error',
          })
        }
      }
    },
    [pendingImportFile, pendingCompanionFiles, articleId, importModal, tCommon]
  )

  // Handle modal close
  const handleImportModalClose = useCallback(() => {
    if (importProcessing) return
    setPendingImportFile(null)
    setPendingCompanionFiles([])
    setImportProgress(null)
    importModal.close()
  }, [importModal, importProcessing])

  // Handle file input change (toolbar button). The picker accepts multiple
  // files so the user can select a markdown together with the images it
  // references (resolved via relative path).
  const handleFileInputChange = useCallback(
    (event) => {
      const fileList = Array.from(event.target.files ?? [])
      const markdown = fileList.find(
        (f) =>
          f.name.toLowerCase().endsWith('.md') ||
          f.name.toLowerCase().endsWith('.markdown') ||
          f.name.toLowerCase().endsWith('.txt')
      )
      if (markdown) {
        const companions = fileList.filter((f) => f !== markdown)
        handleMarkdownFile(markdown, companions)
      }
      event.target.value = ''
    },
    [handleMarkdownFile]
  )

  // Handle folder input change. Shallowest markdown wins so an article
  // packaged as `MyArticle/article.md + media/*` is detected even if the
  // user picks the parent directory.
  const handleFolderInputChange = useCallback(
    (event) => {
      const fileList = Array.from(event.target.files ?? [])
      const markdownCandidates = fileList.filter(
        (f) =>
          f.name.toLowerCase().endsWith('.md') ||
          f.name.toLowerCase().endsWith('.markdown') ||
          f.name.toLowerCase().endsWith('.txt')
      )
      if (markdownCandidates.length === 0) {
        toast(tCommon('markdownImport.toastNoMarkdownInFolder'), {
          type: 'warning',
        })
        event.target.value = ''
        return
      }
      const markdown = markdownCandidates.sort((a, b) => {
        const da = (a.webkitRelativePath || a.name).split('/').length
        const db = (b.webkitRelativePath || b.name).split('/').length
        return da - db
      })[0]
      const companions = fileList.filter((f) => f !== markdown)
      handleMarkdownFile(markdown, companions)
      event.target.value = ''
    },
    [handleMarkdownFile, tCommon]
  )

  const handleImportButtonClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleImportFolderClick = useCallback(() => {
    folderInputRef.current?.click()
  }, [])

  const handleCollaborativeEditorDidMount = useCallback(
    (
      /** @type {IStandaloneCodeEditor} */ editor,
      /** @type {monaco} */ monaco
    ) => {
      editorRef.current = editor

      editor.onDropIntoEditor(onDropIntoEditor(editor, {
        onMarkdownFile: handleMarkdownFile,
        articleId,
      }))

      const contextMenu = editor.getContribution('editor.contrib.contextmenu')
      const originalMenuActions = contextMenu._getMenuActions(
        editor.getModel(),
        editor.contextMenuId
      )

      contextMenu._getMenuActions = function _getStyloCustomMenuActions() {
        return [
          ...originalMenuActions,
          new Separator(),
          MetopesMenu({ editor, t }),
          MarkdownMenu({ editor, t }),
        ]
      }

      // Command Palette commands
      registerActions(editor, t, actions.metopes)
      registerActions(editor, t, actions.md, { palette: false })

      const completionProvider = bibliographyCompletionProvider.register(monaco)
      editor.onDidDispose(() => completionProvider.dispose())

      const model = editor.getModel()
      // Set EOL to LF otherwise it causes synchronization issues due to inconsistent EOL between Windows and Linux.
      // https://github.com/yjs/y-monaco/issues/27
      model.setEOL(monaco.editor.EndOfLineSequence.LF)
      if (yText && awareness) {
        new MonacoBinding(yText, model, new Set([editor]), awareness)
      }
    },
    [yText, awareness, handleMarkdownFile]
  )

  const handleEditorDidMount = useCallback((editor) => {
    editorRef.current = editor
  }, [])

  useEffect(() => {
    if (!yText) return
    /* `timeoutId` lives inside the effect so it's reset whenever the effect
       reruns (article/version/yText change). The previous module-level `let`
       was created fresh on every render, which broke the debounce check. */
    let timeoutId
    const onYTextChange = () => {
      dispatch({
        type: 'UPDATE_ARTICLE_WORKING_COPY_STATUS',
        status: 'syncing',
      })
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        dispatch({
          type: 'UPDATE_ARTICLE_WORKING_COPY_STATUS',
          status: 'synced',
        })
      }, 4000)
      updateArticleStructureAndStats({ text: yText.toString() })
    }
    updateArticleStructureAndStats({ text: yText.toString() })
    yText.observe(onYTextChange)
    /* Without this cleanup, every rerun of the effect (e.g. version switch,
       editor remount) added another observer and they piled up — each yText
       edit then fan-fired N dispatches, throttled writes, and `toString()`
       calls, which is a plausible cause of the preview→write freeze. */
    return () => {
      yText.unobserve(onYTextChange)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [articleId, versionId, yText])

  useEffect(() => {
    if (versionId) {
      dispatch({ type: 'UPDATE_ARTICLE_STATS', md: version.md })
      dispatch({ type: 'UPDATE_ARTICLE_STRUCTURE', md: version.md })
    }
  }, [versionId])

  useEffect(() => {
    if (bibliography) {
      bibliographyCompletionProvider.bibTeXEntries = bibliography.entries
    }
  }, [bibliography])

  useEffect(() => {
    const line = editorCursorPosition.lineNumber
    const editor = editorRef.current
    editor?.focus()
    const endOfLineColumn = editor?.getModel()?.getLineMaxColumn(line + 1)
    editor?.setPosition({ lineNumber: line + 1, column: endOfLineColumn })
    editor?.revealLineNearTop(line + 1, 1) // smooth
  }, [editorRef, editorCursorPosition])

  if (isLoading) {
    return <Loading />
  }

  if (error) {
    return <Alert message={error.message} />
  }

  return (
    <>
      <style>{dynamicStyles}</style>
      <Helmet>
        <title>{article.title}</title>
      </Helmet>

      <CollaborativeEditorArticleHeader
        articleTitle={article.title}
        versionId={versionId}
        metadata={
          hasVersion ? version?.metadata : article?.workingVersion?.metadata
        }
      />

      <CollaborativeEditorWebSocketStatus
        className={styles.inlineStatus}
        status={websocketStatus}
      />

      {/* Hidden file input for markdown import. `multiple` so the user can
          pick a markdown file together with the images it references via
          relative paths — they'll be uploaded and rewritten before import. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,image/*"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Hidden folder input — `webkitdirectory` is a non-standard DOM
          attribute that React doesn't know about, so we set it on mount
          via the ref to avoid an "unknown prop" warning. Lets the user
          pick a whole article folder (markdown + assets) so relative
          image links resolve against `webkitRelativePath`. */}
      <input
        ref={(el) => {
          folderInputRef.current = el
          if (el) {
            el.setAttribute('webkitdirectory', '')
            el.setAttribute('directory', '')
          }
        }}
        type="file"
        multiple
        onChange={handleFolderInputChange}
        style={{ display: 'none' }}
      />

      {/* Markdown import modal */}
      <MarkdownImportModal
        bindings={importModal.bindings}
        file={pendingImportFile}
        companionFiles={pendingCompanionFiles}
        processing={importProcessing}
        progress={importProgress}
        onImport={handleImportConfirm}
        onClose={handleImportModalClose}
      />

      {/* Import from file/folder buttons - shown in write mode when connected */}
      {mode === 'write' && !hasVersion && websocketStatus === 'connected' && (
        <div className={styles.editorToolbar}>
          <Button
            small
            secondary
            onClick={handleImportButtonClick}
            title={tCommon('markdownImport.buttonTitle')}
          >
            <Upload size={16} />
            {tCommon('markdownImport.buttonText')}
          </Button>
          <Button
            small
            secondary
            onClick={handleImportFolderClick}
            title={tCommon('markdownImport.folderButtonTitle')}
          >
            <FolderUp size={16} />
            {tCommon('markdownImport.folderButtonText')}
          </Button>
        </div>
      )}

      {/* Preview style and engine switches - shown when in preview mode */}
      {mode === 'preview' && (
        <div className={styles.editorToolbar}>
          <Toggle
            id="preview-style-imaginations"
            checked={previewStyle === 'imaginations'}
            title={tCommon('article.editor.previewImaginations')}
            onChange={(checked) =>
              setPreviewStyle(checked ? 'imaginations' : 'standard')
            }
          >
            {previewStyle === 'imaginations'
              ? tCommon('article.editor.previewImaginations')
              : tCommon('article.editor.previewStandard')}
          </Toggle>
          {/* Show the engine toggle only when both engines are available and
              the admin hasn't forced a single engine via env. */}
          {!engineLocked && exportEndpointAvailable && (
            <Toggle
              id="preview-engine-lite"
              checked={previewEngine === 'lite'}
              title={tCommon('article.editor.previewEngineToggleTitle')}
              onChange={(checked) =>
                setPreviewEngine(checked ? 'lite' : 'export')
              }
            >
              {previewEngine === 'lite'
                ? tCommon('article.editor.previewEngineLite')
                : tCommon('article.editor.previewEngineExport')}
            </Toggle>
          )}
        </div>
      )}

      {mode === 'preview' && previewEngine === 'lite' && (
        <div className={styles.litePreviewNotice} role="note">
          <strong>{tCommon('article.editor.previewLiteNoticeTitle')}</strong>{' '}
          {tCommon('article.editor.previewLiteNoticeBody')}
        </div>
      )}

      {mode === 'preview' && previewStyle === 'imaginations' && (
        <section
          className={`${styles.previewPage} stylo-preview-imaginations`}
        >
          <style>{previewImaginationsCss}</style>
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </section>
      )}

      {mode === 'preview' && previewStyle === 'standard' && (
        <section className={styles.previewPage}>
          <div dangerouslySetInnerHTML={{ __html: __html ?? '' }} />
        </section>
      )}

      {mode === 'compare' && (
        <div className={styles.collaborativeEditor}>
          <DiffEditor
            className={styles.editor}
            width={'100%'}
            height={'auto'}
            modified={article.workingVersion?.md}
            original={version.md}
            language="markdown"
            options={defaultEditorOptions}
          />
        </div>
      )}

      <div
        className={clsx(
          styles.collaborativeEditor,
          mode !== 'write' && styles.hidden
        )}
      >
        <MonacoEditor
          width={'100%'}
          height={'auto'}
          options={options}
          className={styles.editor}
          defaultLanguage="markdown"
          {...(hasVersion
            ? { value: version.md, onMount: handleEditorDidMount }
            : { onMount: handleCollaborativeEditorDidMount })}
        />
      </div>
    </>
  )
}
