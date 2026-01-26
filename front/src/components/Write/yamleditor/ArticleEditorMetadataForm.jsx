import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import Form from '../../Form'

import { ArticleSchemas } from '../../../schemas/schemas.js'
import { hasOjsData, mapOjsToStyloMetadata } from '../../../helpers/ojsMapper.js'

import Button from '../../atoms/Button.jsx'
import Select from '../../atoms/Select.jsx'

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
  const [type, setType] = useState(metadataFormType)
  const schemaMerged = useMemo(() => {
    const schema = ArticleSchemas.find((o) => o.name === type)
    if (schema === undefined) {
      const option = metadataFormTypeOptions.find((o) => o.name === type)
      if (option) {
        return option.data
      }
      // QUESTION: what should we do, if we can't find the form?
      return ArticleSchemas.find((o) => o.name === 'default').data
    } else {
      return schema.data
    }
  }, [metadataFormTypeOptions, type])
  const uiSchema = useMemo(() => {
    const schema = ArticleSchemas.find((o) => o.name === type)
    if (schema === undefined) {
      const option = metadataFormTypeOptions.find((o) => o.name === type)
      if (option) {
        return option.ui
      }
      // QUESTION: what should we do, if we can't find the form?
      return ArticleSchemas.find((o) => o.name === 'default').ui
    } else {
      return schema.ui
    }
  }, [metadataFormTypeOptions, type])

  const handleChange = useCallback(
    (newFormData) => onChange(newFormData),
    [onChange]
  )

  const handleTypeChange = useCallback(
    (type) => {
      setType(type)
      const schema = ArticleSchemas.find((o) => o.name === type)
      if (schema && schema.const !== undefined) {
        handleChange({
          ...metadata,
          ...schema.const,
        })
      } else {
        // remove default const properties `@version` and `type` since we are using a custom schema
        const { ['@version']: del, type, ...customMetadata } = metadata
        handleChange(customMetadata)
      }
      onTypeChange(type)
    },
    [handleChange, setType, onTypeChange]
  )

  // Check if this article has OJS data that can be re-imported
  const showOjsReimport = useMemo(() => hasOjsData(metadata), [metadata])

  // Handle re-importing metadata from stored OJS data
  const handleOjsReimport = useCallback(() => {
    if (!metadata?.ojs) return
    
    const reimportedMetadata = mapOjsToStyloMetadata(metadata.ojs, {
      // Keep the type and version from current metadata
      type: metadata.type,
      '@version': metadata['@version'],
    })
    handleChange(reimportedMetadata)
  }, [metadata, handleChange])

  const { t } = useTranslation()
  return (
    <>
      <div className={styles.header}>
        <Select
          disabled={readOnly}
          label={t('article.type.label')}
          value={type}
          onChange={(event) => handleTypeChange(event?.target?.value ?? event)}
        >
          <option value="default">{t('article.type.default')}</option>
          <option value="blog-post">{t('article.type.blogPost')}</option>
          <option value="meeting-notes">
            {t('article.type.meetingNotes')}
          </option>
          <option value="chapter">{t('article.type.chapter')}</option>
          {metadataFormTypeOptions.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
        </Select>

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
        formData={metadata}
        schema={schemaMerged}
        uiSchema={uiSchema}
        onChange={handleChange}
      />
    </>
  )
}
