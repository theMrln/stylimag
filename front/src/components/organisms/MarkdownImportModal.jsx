import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Replace, FileInput, ImageDown } from 'lucide-react'

import Modal from '../molecules/Modal.jsx'
import FormActions from '../molecules/FormActions.jsx'

import styles from './markdownImportModal.module.scss'

/**
 * Modal for importing markdown files with replace/insert options.
 *
 * The modal is also responsible for surfacing image-upload progress while
 * the parent processes inline image links — the parent passes a `progress`
 * object and a `processing` flag, and the modal shows a non-blocking
 * status panel.
 *
 * @param {object} props
 * @param {object} props.bindings - Modal bindings from useModal hook
 * @param {File|null} props.file - The file to import
 * @param {File[]} [props.companionFiles] - Companion files (e.g. images) bundled with the markdown
 * @param {(mode: 'replace' | 'insert') => void} props.onImport - Callback when import is confirmed
 * @param {() => void} props.onClose - Callback when modal is closed
 * @param {boolean} [props.processing] - True while the parent is uploading images
 * @param {{ processed: number, total: number, uploaded: number, failed: number, skipped: number }} [props.progress]
 */
export default function MarkdownImportModal({
  bindings,
  file,
  companionFiles = [],
  onImport,
  onClose,
  processing = false,
  progress = null,
}) {
  const { t } = useTranslation()
  const [selectedMode, setSelectedMode] = useState('insert')

  const handleImport = useCallback(() => {
    onImport(selectedMode)
  }, [onImport, selectedMode])

  const handleCancel = useCallback(() => {
    if (processing) return
    onClose()
  }, [onClose, processing])

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Modal {...bindings} title={t('markdownImport.modalTitle')} cancel={handleCancel}>
      <div className={styles.content}>
        {file && (
          <div className={styles.fileInfo}>
            <FileText size={24} />
            <div className={styles.fileDetails}>
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
            </div>
          </div>
        )}

        {companionFiles.length > 0 ? (
          <div className={styles.companions}>
            <ImageDown size={16} />
            <span>
              {t('markdownImport.companionFiles', {
                count: companionFiles.length,
              })}
            </span>
          </div>
        ) : (
          <div className={styles.hint}>
            <ImageDown size={16} />
            <span>{t('markdownImport.noCompanionsHint')}</span>
          </div>
        )}

        <p className={styles.description}>
          {t('markdownImport.description')}
        </p>

        <div className={styles.options}>
          <label className={styles.option}>
            <input
              type="radio"
              name="importMode"
              value="insert"
              checked={selectedMode === 'insert'}
              onChange={() => setSelectedMode('insert')}
              disabled={processing}
            />
            <div className={styles.optionContent}>
              <FileInput size={20} />
              <div>
                <span className={styles.optionTitle}>
                  {t('markdownImport.insertAtCursor')}
                </span>
                <span className={styles.optionDescription}>
                  {t('markdownImport.insertDescription')}
                </span>
              </div>
            </div>
          </label>

          <label className={styles.option}>
            <input
              type="radio"
              name="importMode"
              value="replace"
              checked={selectedMode === 'replace'}
              onChange={() => setSelectedMode('replace')}
              disabled={processing}
            />
            <div className={styles.optionContent}>
              <Replace size={20} />
              <div>
                <span className={styles.optionTitle}>
                  {t('markdownImport.replaceAll')}
                </span>
                <span className={styles.optionDescription}>
                  {t('markdownImport.replaceDescription')}
                </span>
              </div>
            </div>
          </label>
        </div>

        {processing && (
          <div className={styles.progress} role="status" aria-live="polite">
            <div className={styles.progressLabel}>
              {progress && progress.total > 0
                ? t('markdownImport.uploadingImages', {
                    processed: progress.processed,
                    total: progress.total,
                  })
                : t('markdownImport.preparingImport')}
            </div>
            {progress && progress.total > 0 && (
              <progress
                className={styles.progressBar}
                value={progress.processed}
                max={progress.total}
              />
            )}
          </div>
        )}

        <FormActions
          onCancel={handleCancel}
          onSubmit={handleImport}
          submitButton={{
            text: processing
              ? 'markdownImport.importingButton'
              : 'markdownImport.importButton',
            disabled: !file || processing,
          }}
        />
      </div>
    </Modal>
  )
}
