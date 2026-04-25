import PropTypes from 'prop-types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'

import debounce from 'lodash.debounce'

import { useGraphQLClient } from '../../../helpers/graphQL.js'
import { Loading } from '../../molecules/index.js'

import CorpusArticleCard from './CorpusArticleCard.jsx'

import { updateArticlesOrder } from '../../../hooks/Corpus.graphql'

import styles from './CorpusArticleItems.module.scss'

export default function CorpusArticleItems({
  corpusId,
  articles,
  onUpdate,
  flushOrderRef,
}) {
  const { t } = useTranslation('corpus', { useSuspense: false })
  const [isLoading, setLoading] = useState(true)
  const [articleCards, setArticleCards] = useState([])
  useEffect(() => {
    try {
      setArticleCards(articles.map((a) => a.article))
    } finally {
      setLoading(false)
    }
  }, [articles])
  const { query } = useGraphQLClient()

  const updateArticleOrder = useCallback(
    debounce(
      async (orderedArticles) => {
        const articlesOrderInput = orderedArticles.map((item, index) => ({
          articleId: item._id,
          order: index,
        }))
        try {
          await query({
            query: updateArticlesOrder,
            variables: { corpusId, articlesOrderInput },
          })
          onUpdate()
          toast(t('actions.reorderArticles.success'), { type: 'info' })
        } catch (err) {
          toast(
            t('actions.reorderArticles.error', {
              errorMessage: err.toString(),
            }),
            { type: 'error' }
          )
        }
      },
      750,
      { leading: false, trailing: true }
    ),
    []
  )

  // Expose a flush so callers (e.g. the "Push order to OJS" button) can
  // commit any pending debounced reorder before triggering the push.
  useEffect(() => {
    if (!flushOrderRef) return
    flushOrderRef.current = () => updateArticleOrder.flush()
    return () => {
      if (flushOrderRef.current) flushOrderRef.current = null
    }
  }, [flushOrderRef, updateArticleOrder])
  const moveArticleCard = useCallback((dragIndex, hoverIndex) => {
    setArticleCards((prevCards) => {
      const length = prevCards.length
      const position =
        hoverIndex < dragIndex
          ? { startIndex: hoverIndex, endIndex: dragIndex }
          : { startIndex: dragIndex, endIndex: hoverIndex }
      const orderedArticles = [
        ...prevCards.slice(0, position.startIndex),
        prevCards[position.endIndex],
        ...prevCards.slice(position.startIndex + 1, position.endIndex),
        prevCards[position.startIndex],
        ...prevCards.slice(position.endIndex + 1, length),
      ]
      updateArticleOrder(orderedArticles)
      return orderedArticles
    })
  }, [])
  const renderCard = useCallback((card, index) => {
    return (
      <CorpusArticleCard
        key={card._id}
        index={index}
        id={card._id}
        article={card}
        moveCard={(dragIndex, hoverIndex) => {
          moveArticleCard(dragIndex, hoverIndex)
        }}
      />
    )
  }, [])

  if (isLoading) {
    return <Loading />
  }

  // Build rows: section headers + article cards, in order
  const rows = []
  let lastSectionKey = null
  articles.forEach((item, index) => {
    const sectionKey = String(item.section ?? '')
    const sectionTitle =
      item.sectionTitle?.trim() ||
      (sectionKey ? t('articles.sectionLabel', { section: sectionKey }) : t('articles.defaultSectionLabel'))
    if (sectionKey !== lastSectionKey) {
      rows.push({ type: 'section', key: `section-${sectionKey || 'default'}`, title: sectionTitle })
      lastSectionKey = sectionKey
    }
    const card = articleCards[index]
    if (card) rows.push({ type: 'article', index, article: card })
  })

  return (
    <div className={styles.articleList}>
      {rows.map((row) =>
        row.type === 'section' ? (
          <h3 key={row.key} className={styles.sectionTitle}>
            {row.title}
          </h3>
        ) : (
          <div key={row.article._id}>{renderCard(row.article, row.index)}</div>
        )
      )}
    </div>
  )
}

CorpusArticleItems.propTypes = {
  corpusId: PropTypes.string,
  articles: PropTypes.array,
  onUpdate: PropTypes.func,
  flushOrderRef: PropTypes.shape({ current: PropTypes.any }),
}
