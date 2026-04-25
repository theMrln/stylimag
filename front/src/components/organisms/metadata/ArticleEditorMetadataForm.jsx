import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Upload } from 'lucide-react'

import Form from '../../molecules/Form.jsx'

import { ArticleSchemas } from '../../../schemas/schemas.js'
import {
  hasOjsData,
  mapOjsToOjsMetadata,
  normalizeMetadataToOjsShape,
} from '../../../helpers/ojsMapper.js'
import { usePushArticleMetadataToOJS } from '../../../hooks/ojs.js'

import Button from '../../atoms/Button.jsx'

import styles from './ArticleEditorMetadataForm.module.scss'

/**
 * @param {object} props properties
 * @param {string} [props.articleId]
 * @param {any} props.metadata
 * @param {string} props.metadataFormType
 * @param {any} props.metadataFormTypeOptions
 * @param {boolean} props.readOnly
 * @param {(any) => void} props.onChange
 * @param {(any) => void} props.onTypeChange
 * @returns {Element}
 */
export default function ArticleEditorMetadataForm({
  articleId,
  metadata,
  metadataFormType = 'default',
  metadataFormTypeOptions = [],
  readOnly = false,
  onChange = () => {},
  onTypeChange = () => {},
}) {
  const defaultSchema = ArticleSchemas.find((o) => o.name === 'default')
  const schemaMerged = useMemo(
    () =>
      metadataFormTypeOptions.find((o) => o.name === metadataFormType)?.data ??
      defaultSchema?.data,
    [metadataFormTypeOptions, metadataFormType]
  )
  const uiSchema = useMemo(
    () =>
      metadataFormTypeOptions.find((o) => o.name === metadataFormType)?.ui ??
      defaultSchema?.ui,
    [metadataFormTypeOptions, metadataFormType]
  )
  const formData = useMemo(
    () => normalizeMetadataToOjsShape(metadata),
    [metadata]
  )

  const handleChange = useCallback(
    (newFormData) => onChange(newFormData),
    [onChange]
  )

  const showOjsReimport = useMemo(() => hasOjsData(metadata), [metadata])

  const handleOjsReimport = useCallback(() => {
    if (!metadata?.ojs) return
    const reimportedMetadata = mapOjsToOjsMetadata(metadata.ojs, {
      type: metadata.type,
      '@version': metadata['@version'],
    })
    handleChange(reimportedMetadata)
  }, [metadata, handleChange])

  const { pushArticleMetadata } = usePushArticleMetadataToOJS()
  const [pushStatus, setPushStatus] = useState(null) // null | 'pending' | 'success' | { error: string }
  const handlePushToOjs = useCallback(async () => {
    if (!articleId) return
    setPushStatus('pending')
    try {
      await pushArticleMetadata(articleId)
      setPushStatus('success')
    } catch (err) {
      setPushStatus({ error: err?.message || 'Push failed' })
    }
  }, [articleId, pushArticleMetadata])

  const { t } = useTranslation()
  return (
    <>
      <div className={styles.header}>
        {showOjsReimport && !readOnly && (
          <Button
            small
            secondary
            onClick={handleOjsReimport}
            title={t('ojs.reimport.buttonTitle')}
            className={styles.ojsReimportButton}
          >
            <RefreshCw size={16} />
            {t('ojs.reimport.buttonText')}
          </Button>
        )}
        {showOjsReimport && !readOnly && articleId && (
          <Button
            small
            secondary
            onClick={handlePushToOjs}
            disabled={pushStatus === 'pending'}
            title={t('ojs.push.buttonTitle')}
            className={styles.ojsReimportButton}
          >
            <Upload size={16} />
            {pushStatus === 'pending'
              ? t('ojs.push.buttonPending')
              : t('ojs.push.buttonText')}
          </Button>
        )}
        {pushStatus === 'success' && (
          <span className={styles.ojsPushStatus}>
            {t('ojs.push.success')}
          </span>
        )}
        {pushStatus && typeof pushStatus === 'object' && pushStatus.error && (
          <span className={styles.ojsPushError}>{pushStatus.error}</span>
        )}
      </div>
      <Form
        readOnly={readOnly}
        formData={formData}
        schema={schemaMerged}
        uiSchema={uiSchema}
        onChange={handleChange}
      />
    </>
  )
}
