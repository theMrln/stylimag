import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Replace, FileInput } from 'lucide-react'

import Modal from '../molecules/Modal.jsx'
import Button from '../atoms/Button.jsx'
import FormActions from '../molecules/FormActions.jsx'

import styles from './markdownImportModal.module.scss'

/**
 * Modal for importing markdown files with replace/insert options
 * @param {object} props
 * @param {object} props.bindings - Modal bindings from useModal hook
 * @param {File|null} props.file - The file to import
 * @param {(mode: 'replace' | 'insert') => void} props.onImport - Callback when import is confirmed
 * @param {() => void} props.onClose - Callback when modal is closed
 */
export default function MarkdownImportModal({
  bindings,
  file,
  onImport,
  onClose,
}) {
  const { t } = useTranslation()
  const [selectedMode, setSelectedMode] = useState('insert')

  const handleImport = useCallback(() => {
    onImport(selectedMode)
  }, [onImport, selectedMode])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

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

        <FormActions
          onCancel={handleCancel}
          onSubmit={handleImport}
          submitButton={{
            text: t('markdownImport.importButton'),
            disabled: !file,
          }}
        />
      </div>
    </Modal>
  )
}
