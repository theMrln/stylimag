import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'

import { useOjsIssues, useOjsImport } from '../../../hooks/ojs.js'

import Modal from '../../molecules/Modal.jsx'
import Select from '../../atoms/Select.jsx'
import FormActions from '../../molecules/FormActions.jsx'
import Loading from '../../molecules/Loading.jsx'
import Alert from '../../molecules/Alert.jsx'

import styles from './ojsImportModal.module.scss'

/**
 * Get the display title for an OJS issue
 * OJS titles are localized objects like { en_US: "Title", fr_CA: "Titre" }
 */
function getIssueDisplayTitle(issue) {
  if (!issue.title) {
    return `Issue #${issue.id}`
  }

  // Handle localized title object
  if (typeof issue.title === 'object') {
    // Try common locales
    const title =
      issue.title.en_US ||
      issue.title.en ||
      issue.title.fr_CA ||
      issue.title.fr ||
      Object.values(issue.title)[0]

    if (title) {
      // Add volume/number info if available
      const parts = [title]
      if (issue.vol) parts.push(`Vol. ${issue.vol}`)
      if (issue.number) parts.push(`No. ${issue.number}`)
      if (issue.year) parts.push(`(${issue.year})`)
      return parts.join(' - ')
    }
  }

  // Fallback for string titles
  if (typeof issue.title === 'string') {
    return issue.title
  }

  return `Issue #${issue.id}`
}

/**
 * @param props
 * @param {object} props.bindings - Modal bindings from useModal
 * @param {function} props.onClose - Called when modal should close
 * @param {function} props.onImportSuccess - Called after successful import
 */
export default function OjsImportModal({
  bindings,
  onClose,
  onImportSuccess = () => {},
}) {
  const { t } = useTranslation()
  const { issues, error: fetchError, isLoading } = useOjsIssues()
  const { importCorpus } = useOjsImport()
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  const handleImport = useCallback(async () => {
    if (!selectedIssueId) {
      toast(t('ojs.import.selectIssueError'), { type: 'warning' })
      return
    }

    setIsImporting(true)
    try {
      const corpus = await importCorpus(selectedIssueId)
      toast(
        t('ojs.import.success', {
          corpusName: corpus.name,
        }),
        { type: 'success' }
      )
      onImportSuccess(corpus)
      onClose()
    } catch (err) {
      toast(
        t('ojs.import.error', {
          errorMessage: err.message,
        }),
        { type: 'error' }
      )
    } finally {
      setIsImporting(false)
    }
  }, [selectedIssueId, importCorpus, onClose, onImportSuccess, t])

  const handleCancel = useCallback(() => {
    setSelectedIssueId('')
    onClose()
  }, [onClose])

  return (
    <Modal {...bindings} title={t('ojs.import.modalTitle')} cancel={handleCancel}>
      <div className={styles.content}>
        <p className={styles.description}>{t('ojs.import.description')}</p>

        {fetchError && (
          <Alert
            className={styles.error}
            message={t('ojs.import.fetchError', {
              errorMessage: fetchError.message,
            })}
          />
        )}

        {isLoading ? (
          <Loading />
        ) : (
          <>
            {issues.length === 0 && !fetchError ? (
              <Alert
                className={styles.warning}
                message={t('ojs.import.noIssues')}
                type="warning"
              />
            ) : (
              <Select
                name="ojsIssue"
                id="ojsIssue"
                label={t('ojs.import.selectLabel')}
                value={selectedIssueId}
                onChange={(e) => setSelectedIssueId(e.target.value)}
                disabled={isImporting}
              >
                <option value="">{t('ojs.import.selectPlaceholder')}</option>
                {issues.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {getIssueDisplayTitle(issue)}
                  </option>
                ))}
              </Select>
            )}

            <FormActions
              onCancel={handleCancel}
              submitButton={{
                text: isImporting
                  ? 'ojs.import.importing'
                  : 'ojs.import.importButton',
                disabled: !selectedIssueId || isImporting || issues.length === 0,
              }}
              onSubmit={handleImport}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
