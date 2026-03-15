import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import Form from '../../molecules/Form.jsx'

import { ArticleSchemas } from '../../../schemas/schemas.js'
import {
  hasOjsData,
  mapOjsToOjsMetadata,
  normalizeMetadataToOjsShape,
} from '../../../helpers/ojsMapper.js'

import Button from '../../atoms/Button.jsx'

import styles from './ArticleEditorMetadataForm.module.scss'

/**
 * @param {object} props properties
 * @param {any} props.metadata
 * @param {string} props.metadataFormType
 * @param {any} props.metadataFormTypeOptions
 * @param {boolean} props.readOnly
 * @param {(any) => void} props.onChange
 * @param {(any) => void} props.onTypeChange
 * @returns {Element}
 */
export default function ArticleEditorMetadataForm({
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
