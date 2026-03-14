import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { useCorpus } from '../../hooks/corpus.js'
import { useModal } from '../../hooks/modal.js'
import { useOjsInstances } from '../../hooks/ojs.js'
import { useWorkspaceName } from '../../hooks/workspace.js'
import { Button, PageTitle } from '../atoms/index.js'
import { Alert, Loading } from '../molecules/index.js'

import Modal from '../molecules/Modal.jsx'
import CorpusForm from '../organisms/corpus/CorpusForm.jsx'
import CorpusItem from '../organisms/corpus/CorpusItem.jsx'
import OjsImportModal from '../organisms/corpus/OjsImportModal.jsx'
import WorkspaceLabel from '../organisms/workspace/WorkspaceLabel.jsx'

import styles from './Corpus.module.scss'

export default function Corpus() {
  const { t } = useTranslation('corpus', { useSuspense: false })
  const { t: tCommon } = useTranslation()
  const { workspaceId } = useParams()
  const { corpus, workspace, isLoading, error } = useCorpus({ workspaceId })
  const { instances: ojsInstances } = useOjsInstances()
  const createCorpusModal = useModal()
  const ojsImportModal = useModal()
  const [ojsImportInstance, setOjsImportInstance] = useState(null)
  const workspaceName = useWorkspaceName({ workspace })

  const openOjsImport = (instance) => {
    setOjsImportInstance(instance)
    ojsImportModal.show()
  }

  const closeOjsImport = () => {
    setOjsImportInstance(null)
    ojsImportModal.close()
  }

  return (
    <section className={styles.section}>
      <Helmet>
        <title>{t('title', { workspace: workspaceName })}</title>
      </Helmet>

      <header className={styles.header}>
        <PageTitle title={t('header')}></PageTitle>
        <Button primary onClick={() => createCorpusModal.show()}>
          {t('actions.create.label')}
        </Button>
        {ojsInstances.includes('staging') && (
          <Button secondary onClick={() => openOjsImport('staging')}>
            {tCommon('ojs.import.buttonStaging')}
          </Button>
        )}
        {ojsInstances.includes('production') && (
          <Button secondary onClick={() => openOjsImport('production')}>
            {tCommon('ojs.import.buttonProduction')}
          </Button>
        )}
      </header>
      <WorkspaceLabel color={workspace.color} name={workspace.name} />
      <p className={styles.introduction}>{t('description')}</p>

      <Modal {...createCorpusModal.bindings} title={t('actions.create.title')}>
        <CorpusForm
          onSubmit={() => createCorpusModal.close()}
          onCancel={() => createCorpusModal.close()}
        />
      </Modal>

      <OjsImportModal
        bindings={ojsImportModal.bindings}
        instance={ojsImportInstance}
        onClose={closeOjsImport}
      />

      {error && <Alert className={styles.message} message={error.message} />}

      {isLoading ? (
        <Loading />
      ) : (
        <div className={styles.corpusList}>
          {corpus.map((c) => (
            <CorpusItem key={c._id} corpus={c} />
          ))}
        </div>
      )}
    </section>
  )
}
