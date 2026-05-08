import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import JobDashboard from '../organisms/production/JobDashboard.jsx'
import PipelineHealthBadge from '../organisms/production/PipelineHealthBadge.jsx'
import { PageTitle } from '../atoms/index.js'

import styles from './Production.module.scss'

export default function Production() {
  const { t } = useTranslation('production', { useSuspense: false })
  const { corpusId } = useParams()

  return (
    <section className={styles.section}>
      <Helmet>
        <title>{t('page.title', 'Production')}</title>
      </Helmet>

      <header className={styles.header}>
        <PageTitle title={t('page.heading', 'Production pipeline')} />
        <PipelineHealthBadge />
      </header>

      <p className={styles.intro}>
        {t(
          'page.intro',
          'Build per-article PDFs and follow the publishing pipeline. Issue-level artefacts (covers, TOC, complete-issue) and OJS push-back land in later phases.'
        )}
      </p>

      <nav className={styles.crumbs}>
        <Link to="/corpus">{t('page.crumbs.allCorpora', 'all corpora')}</Link>
        <span aria-hidden="true">›</span>
        <span>{corpusId}</span>
      </nav>

      <JobDashboard corpusId={corpusId} />
    </section>
  )
}
