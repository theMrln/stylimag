import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import { useCorpusIssueMetadata } from '../../hooks/pipeline.js'
import BuildPanel from '../organisms/production/BuildPanel.jsx'
import IssueMetadataPanel from '../organisms/production/IssueMetadataPanel.jsx'
import JobDashboard from '../organisms/production/JobDashboard.jsx'
import OjsPushPanel from '../organisms/production/OjsPushPanel.jsx'
import PageNumberSyncPanel from '../organisms/production/PageNumberSyncPanel.jsx'
import PipelineHealthBadge from '../organisms/production/PipelineHealthBadge.jsx'
import PublisherSettings from '../organisms/production/PublisherSettings.jsx'
import StaticDeployPanel from '../organisms/production/StaticDeployPanel.jsx'
import { PageTitle } from '../atoms/index.js'

import styles from './Production.module.scss'

export default function Production() {
  const { t } = useTranslation('production', { useSuspense: false })
  const { corpusId } = useParams()
  const { data: corpus } = useCorpusIssueMetadata({ corpusId })
  const corpusLabel = corpus?.name || corpusId
  const [dashboardKey, setDashboardKey] = useState(0)

  // Bump the dashboard key whenever a new job is started so the list
  // refreshes with the freshly-created PipelineJob row at the top.
  const handleJobStarted = () => setDashboardKey((k) => k + 1)

  return (
    <section className={styles.section}>
      <Helmet>
        <title>
          {corpus?.name
            ? t('page.titleWithName', '{{name}} — Production', {
                name: corpus.name,
              })
            : t('page.title', 'Production')}
        </title>
      </Helmet>

      <header className={styles.header}>
        <PageTitle title={t('page.heading', 'Production pipeline')} />
        <PipelineHealthBadge />
      </header>

      <p className={styles.intro}>
        {t(
          'page.intro',
          'Build per-article PDFs and assemble the issue: covers, TOC, front page, and a merged complete-issue PDF. Then push metadata back to OJS or deploy artefacts to a static host.'
        )}
      </p>

      <nav className={styles.crumbs}>
        <Link to="/corpus">{t('page.crumbs.allCorpora', 'all corpora')}</Link>
        <span aria-hidden="true">›</span>
        <span title={corpusId}>{corpusLabel}</span>
      </nav>

      <BuildPanel corpusId={corpusId} onJobStarted={handleJobStarted} />
      <IssueMetadataPanel corpusId={corpusId} />
      <PublisherSettings corpusId={corpusId} />
      <PageNumberSyncPanel corpusId={corpusId} />
      <OjsPushPanel
        pageNumberEntries={[]}
        doiEntries={[]}
        bioEntries={[]}
      />
      <StaticDeployPanel corpusId={corpusId} />
      <JobDashboard key={dashboardKey} corpusId={corpusId} />
    </section>
  )
}
