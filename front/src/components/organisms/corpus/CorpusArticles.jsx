import { Upload } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { DndProvider } from 'react-dnd'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'

import { dragAndDropManager } from '../../../hooks/dnd.js'
import useFetchData from '../../../hooks/graphql.js'
import { useModal } from '../../../hooks/modal.js'
import { usePushCorpusArticleOrderToOJS } from '../../../hooks/ojs.js'
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
    // Section ordering: by `sectionSeq` captured at import time from
    // OJS' issueMetadata.sections payload (the per-issue custom section
    // order set by the editor). Within a section: `order` (set by
    // drag-and-drop) wins over `seq` (publication.seq from OJS) so
    // manual reorders persist.
    //
    // Legacy entries with no `sectionSeq` fall back to a stable
    // section-id grouping so the page doesn't crash; they need to be
    // re-imported to benefit from the per-issue order.
    return [...raw].sort((a, b) => {
      const ssA = a.sectionSeq
      const ssB = b.sectionSeq
      if (ssA != null && ssB != null && ssA !== ssB) return ssA - ssB
      if (ssA != null && ssB == null) return -1
      if (ssA == null && ssB != null) return 1
      if (ssA == null && ssB == null) {
        const sectA = a.section ?? ''
        const sectB = b.section ?? ''
        if (sectA !== sectB) return String(sectA).localeCompare(String(sectB))
      }
      const keyA = a.order ?? a.seq ?? 0
      const keyB = b.order ?? b.seq ?? 0
      return keyA - keyB
    })
  }, [data])

  const handleUpdate = useCallback(() => {
    mutate()
  }, [mutate])

  const ojsInstance = data?.corpus?.[0]?.metadata?.ojs?._instance ?? null
  const showPushOrder = !!ojsInstance && corpusArticles.length > 0

  const flushOrderRef = useRef(null)
  const { pushOrder } = usePushCorpusArticleOrderToOJS()
  const [isPushing, setIsPushing] = useState(false)

  const handlePushOrder = useCallback(async () => {
    if (isPushing) return
    setIsPushing(true)
    try {
      // Commit any debounced reorder before pushing so OJS sees the latest
      // sequence the user just dragged into place.
      const pending = flushOrderRef.current?.()
      if (pending && typeof pending.then === 'function') {
        await pending
      }
      const updated = await pushOrder(corpusId)
      toast(t('actions.pushOrderToOjs.success', { count: updated ?? 0 }), {
        type: 'info',
      })
      mutate()
    } catch (err) {
      toast(
        t('actions.pushOrderToOjs.error', {
          errorMessage: err?.message ?? String(err),
        }),
        { type: 'error' }
      )
    } finally {
      setIsPushing(false)
    }
  }, [corpusId, isPushing, mutate, pushOrder, t])

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <Button
          onClick={() => addArticlesModal.show()}
          title={t('actions.addArticles.title')}
        >
          {t('actions.addArticles.label')}
        </Button>
        {showPushOrder && (
          <Button
            secondary
            onClick={handlePushOrder}
            disabled={isPushing}
            title={t('actions.pushOrderToOjs.title')}
          >
            <Upload size={16} />
            {isPushing
              ? t('actions.pushOrderToOjs.pending')
              : t('actions.pushOrderToOjs.label')}
          </Button>
        )}
      </div>

      {isLoading && <Loading />}
      {!isLoading && corpusArticles.length > 0 && (
        <ul>
          <DndProvider manager={dragAndDropManager} backend={undefined}>
            <CorpusArticleItems
              corpusId={corpusId}
              articles={corpusArticles}
              onUpdate={handleUpdate}
              flushOrderRef={flushOrderRef}
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
