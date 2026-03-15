import { useRef } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { Link } from 'react-router'

import styles from './corpusArticleCard.module.scss'

/**
 * Get first string from a localized object (en_US, fr_CA, etc.)
 * @param {object|string} obj
 * @returns {string}
 */
function firstLocaleValue(obj) {
  if (obj == null) return ''
  if (typeof obj === 'string') return obj.trim()
  const v = obj.en_US ?? obj.en ?? obj.fr_CA ?? obj.fr ?? Object.values(obj).find((x) => typeof x === 'string')
  return (v && String(v).trim()) ?? ''
}

/**
 * Format metadata authors for display. Supports OJS shape (givenName/familyName as localized objects) and legacy (forename/surname).
 * @param {Array<{ givenName?: object|string, familyName?: object|string, forename?: string, surname?: string }>} authors
 * @returns {string}
 */
function formatAuthors(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return ''
  return authors
    .map((a) => {
      const given = (firstLocaleValue(a.givenName) || a.forename?.trim()) ?? ''
      const family = (firstLocaleValue(a.familyName) || a.surname?.trim()) ?? ''
      if (family && given) return `${family}, ${given}`
      return family || given
    })
    .filter(Boolean)
    .join('; ')
}

export default function CorpusArticleCard({ id, article, index, moveCard }) {
  const ref = useRef(null)
  const [{ handlerId }, drop] = useDrop({
    accept: 'card',
    collect(monitor) {
      return {
        handlerId: monitor.getHandlerId(),
      }
    },
    hover(item, monitor) {
      if (!ref.current) {
        return
      }
      const dragIndex = item.index
      const hoverIndex = index
      // Don't replace items with themselves
      if (dragIndex === hoverIndex) {
        return
      }
      // Determine rectangle on screen
      const hoverBoundingRect = ref.current?.getBoundingClientRect()
      // Get vertical middle
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2
      // Determine mouse position
      const clientOffset = monitor.getClientOffset()
      // Get pixels to the top
      const hoverClientY = clientOffset.y - hoverBoundingRect.top
      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%
      // Dragging downwards
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return
      }
      // Dragging upwards
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return
      }
      // Time to actually perform the action
      moveCard(dragIndex, hoverIndex)
      // Note: we're mutating the monitor item here!
      // Generally it's better to avoid mutations,
      // but it's good here for the sake of performance
      // to avoid expensive index searches.
      item.index = hoverIndex
    },
  })
  const [{ isDragging }, drag] = useDrag({
    type: 'card',
    item: () => {
      return { id, index }
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  })
  const opacity = isDragging ? 0 : 1
  drag(drop(ref))

  return (
    <div
      className={styles.card}
      ref={ref}
      style={{ opacity }}
      data-handler-id={handlerId}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1.05rem"
        height="1.05rem"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="tabler-icon tabler-icon-grip-vertical"
      >
        <path d="M9 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
        <path d="M9 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
        <path d="M9 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
        <path d="M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
        <path d="M15 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
        <path d="M15 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>
      </svg>

      <div className={styles.articleInfo}>
        <Link to={`/article/${article._id}`} className={styles.title}>
          {article.title}
        </Link>
        {(() => {
          const authors = article.workingVersion?.metadata?.authors
          const text = formatAuthors(authors)
          return text ? (
            <span className={styles.authors}>{text}</span>
          ) : null
        })()}
      </div>
    </div>
  )
}
