import clsx from 'clsx'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
import { MonacoBinding } from 'y-monaco'
import { Upload } from 'lucide-react'

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
import { useStyloExportPreview } from '../../../hooks/stylo-export.js'
import { buildPreviewWithMetadataHeader } from '../../../helpers/previewMetadata.js'
import defaultEditorOptions from '../monaco/options.js'
import { onDropIntoEditor, importMarkdownContent, readFileAsText } from '../bibliography/support.js'
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
  const fileInputRef = useRef(null)
  const [previewStyle, setPreviewStyle] = useState('imaginations') // 'imaginations' | 'standard'

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

  const { html: __html, isLoading: isPreviewLoading } = useStyloExportPreview({
    ...(mode === 'preview'
      ? {
          md_content: versionId ? version?.md : yText?.toString(),
          yaml_content: versionId
            ? version?.yaml
            : article?.workingVersion?.yaml,
          bib_content: versionId ? version?.bib : article?.workingVersion?.bib,
        }
      : {}),
    with_toc: true,
    with_nocite: true,
    with_link_citations: true,
  })

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
  const handleMarkdownFile = useCallback((file) => {
    setPendingImportFile(file)
    importModal.show()
  }, [importModal])

  // Handle import confirmation from modal
  const handleImportConfirm = useCallback(async (mode) => {
    if (!pendingImportFile || !editorRef.current) return
    
    try {
      const content = await readFileAsText(pendingImportFile)
      importMarkdownContent(editorRef.current, content, mode)
    } catch (error) {
      console.error('Failed to import markdown file:', error)
    } finally {
      setPendingImportFile(null)
      importModal.close()
    }
  }, [pendingImportFile, importModal])

  // Handle modal close
  const handleImportModalClose = useCallback(() => {
    setPendingImportFile(null)
    importModal.close()
  }, [importModal])

  // Handle file input change (toolbar button)
  const handleFileInputChange = useCallback((event) => {
    const file = event.target.files?.[0]
    if (file) {
      handleMarkdownFile(file)
    }
    // Reset input so same file can be selected again
    event.target.value = ''
  }, [handleMarkdownFile])

  // Trigger file input click
  const handleImportButtonClick = useCallback(() => {
    fileInputRef.current?.click()
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

  let timeoutId
  useEffect(() => {
    if (yText) {
      updateArticleStructureAndStats({ text: yText.toString() })
      yText.observe(function (yTextEvent, transaction) {
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
      })
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
      />

      <CollaborativeEditorWebSocketStatus
        className={styles.inlineStatus}
        status={websocketStatus}
      />

      {/* Hidden file input for markdown import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Markdown import modal */}
      <MarkdownImportModal
        bindings={importModal.bindings}
        file={pendingImportFile}
        onImport={handleImportConfirm}
        onClose={handleImportModalClose}
      />

      {/* Import from file button - shown when in write mode and connected */}
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
        </div>
      )}

      {/* Preview style switch - shown when in preview mode */}
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
