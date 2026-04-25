import YAML from 'js-yaml'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { useArticleMetadata } from '../../../hooks/article.js'
import { usePreferenceItem } from '../../../hooks/user.js'
import { Alert, Loading, Toggle } from '../../molecules/index.js'

import ArticleEditorMetadataForm from './ArticleEditorMetadataForm.jsx'
import MonacoYamlEditor from './YamlEditor.jsx'

import styles from './articleEditorMetadata.module.scss'

/**
 * @param {object} props
 * @param {string} props.articleId
 * @param {string} props.versionId
 * @returns {JSX.Element}
 */
export default function ArticleMetadata({ articleId, versionId }) {
  /** @type {object} */
  const articleWriters = useSelector((state) => state.articleWriters || {})
  const multiUserActive = useMemo(
    () => Object.keys(articleWriters).length > 1,
    [articleWriters]
  )
  const readOnly = multiUserActive || versionId
  const { t } = useTranslation()
  const {
    metadata,
    metadataFormType,
    metadataFormTypeOptions,
    metadataYaml,
    isLoading,
    updateMetadata,
    updateMetadataFormType,
  } = useArticleMetadata({
    articleId,
    versionId,
  })
  const [error, setError] = useState('')

  const { value: selector, setValue: setSelector } = usePreferenceItem(
    'metadataFormMode',
    'article'
  )

  const handleFormUpdate = useCallback(
    async (metadata) => {
      if (readOnly) {
        return
      }
      await updateMetadata(metadata)
    },
    [readOnly, updateMetadata]
  )

  const handleFormTypeUpdate = useCallback(
    async (formType) => {
      if (readOnly) {
        return
      }
      await updateMetadataFormType(formType)
    },
    [readOnly, updateMetadataFormType]
  )

  const handleYamlChange = useCallback(async (yaml) => {
    try {
      const [parsedMetadata = {}] = YAML.loadAll(yaml)
      setError('')
      // The raw YAML view hides the OJS reference blob; preserve it across edits
      // so re-import / push-to-OJS keeps working.
      const merged =
        metadata && metadata.ojs
          ? { ...parsedMetadata, ojs: metadata.ojs }
          : parsedMetadata
      await updateMetadata(merged)
    } catch (err) {
      setError(err.message)
    }
  }, [metadata, updateMetadata])

  if (isLoading) {
    return <Loading />
  }

  return (
    <div className={styles.yamlEditor}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('metadata.title')}</h2>

        <Toggle
          id="raw-mode"
          data-testid="raw-mode-toggle"
          checked={selector === 'raw'}
          title={t('metadata.showYaml')}
          onChange={(checked) => setSelector(checked ? 'raw' : 'basic')}
        >
          YAML
        </Toggle>
      </header>

      {versionId && (
        <div className={styles.readonly}>
          <Alert message={t('metadata.readonly.versionView')} type="warning" />
        </div>
      )}
      {!versionId && multiUserActive && (
        <div className={styles.readonly}>
          <Alert
            message={t('metadata.readonly.multiUserActive')}
            type="warning"
          />
        </div>
      )}
      {selector === 'raw' && (
        <>
          {error !== '' && <p className={styles.error}>{error}</p>}
          <MonacoYamlEditor
            readOnly={readOnly}
            height="100%"
            fontSize="14"
            text={metadataYaml}
            onTextUpdate={handleYamlChange}
          />
        </>
      )}
      {selector !== 'raw' && (
        <ArticleEditorMetadataForm
          articleId={articleId}
          readOnly={readOnly}
          metadata={metadata}
          metadataFormType={metadataFormType}
          metadataFormTypeOptions={metadataFormTypeOptions}
          error={(reason) => {
            setError(reason)
            if (reason !== '') {
              setSelector('raw')
            }
          }}
          onChange={handleFormUpdate}
          onTypeChange={handleFormTypeUpdate}
        />
      )}
    </div>
  )
}
