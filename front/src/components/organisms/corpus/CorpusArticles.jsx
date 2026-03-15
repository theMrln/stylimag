import { useCallback, useMemo } from 'react'
import { DndProvider } from 'react-dnd'
import { useTranslation } from 'react-i18next'

import { dragAndDropManager } from '../../../hooks/dnd.js'
import useFetchData from '../../../hooks/graphql.js'
import { useModal } from '../../../hooks/modal.js'
import { Button } from '../../atoms/index.js'
import { Loading } from '../../molecules/index.js'

import ArticlesSelectorModal from '../article/ArticlesSelectorModal.jsx'
import CorpusArticleItems from './CorpusArticleItems.jsx'

import { getCorpus } from '../../../hooks/Corpus.graphql'

import styles from './CorpusArticles.module.scss'

export default function CorpusArticles({ corpusId }) {
  const { t } = useTranslation('corpus', { useSuspense: false })
  const addArticlesModal = useModal()
  const { data, isLoading, mutate } = useFetchData(
    {
      query: getCorpus,
      variables: {
        filter: { corpusId: corpusId },
        includeArticles: true,
        includeArticleMetadata: true,
      },
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )
  const corpusArticles = useMemo(() => {
    const raw = data?.corpus?.[0]?.articles || []
    return [...raw].sort((a, b) => {
      const sectA = a.section ?? ''
      const sectB = b.section ?? ''
      if (sectA !== sectB) {
        return String(sectA).localeCompare(String(sectB))
      }
      const seqA = a.seq ?? a.order ?? 0
      const seqB = b.seq ?? b.order ?? 0
      return seqA - seqB
    })
  }, [data])

  const handleUpdate = useCallback(() => {
    mutate()
  }, [mutate])

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <Button
          onClick={() => addArticlesModal.show()}
          title={t('actions.addArticles.title')}
        >
          {t('actions.addArticles.label')}
        </Button>
      </div>

      {isLoading && <Loading />}
      {!isLoading && corpusArticles.length > 0 && (
        <ul>
          <DndProvider manager={dragAndDropManager} backend={undefined}>
            <CorpusArticleItems
              corpusId={corpusId}
              articles={corpusArticles}
              onUpdate={handleUpdate}
            />
          </DndProvider>
        </ul>
      )}
      <ArticlesSelectorModal
        corpusId={corpusId}
        corpusArticles={corpusArticles}
        bindings={addArticlesModal.bindings}
        close={addArticlesModal.close}
        onUpdate={handleUpdate}
      />
    </section>
  )
}
