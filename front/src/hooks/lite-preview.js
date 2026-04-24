import { useMemo } from 'react'

import { renderLitePreviewHtml } from '../helpers/litePreview.js'

/**
 * Client-only "lite" preview hook. Same return shape as
 * `useStyloExportPreview` so callers can swap engines with minimal changes.
 *
 * Unlike the export-based hook, rendering is synchronous (no network, no
 * Pandoc), so `isLoading` is always false once we have inputs.
 *
 * @param {{ md_content?: string }} params
 * @returns {{ html: string, isLoading: boolean }}
 */
export function useLitePreview({ md_content } = {}) {
  const html = useMemo(() => {
    if (md_content === undefined) return ''
    return renderLitePreviewHtml({ md_content })
  }, [md_content])

  return { html, isLoading: false }
}
