import useSWR from 'swr'

import { applicationConfig } from '../config.js'

/**
 * Returns true when the configured pandoc-export endpoint looks usable.
 * We bail out when the value is empty, stringified as "undefined", or points
 * at the frontend's own origin (which would just 405 via nginx).
 *
 * @param {string} endpoint
 * @returns {boolean}
 */
function isPandocEndpointUsable(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') {
    return false
  }
  if (endpoint === 'undefined' || endpoint === 'null') {
    return false
  }
  try {
    const url = new URL(endpoint, window.location.href)
    if (
      url.origin === window.location.origin &&
      (url.pathname === '' || url.pathname === '/')
    ) {
      // Would target the frontend's own nginx and 405 on POST.
      return false
    }
    return true
  } catch {
    return false
  }
}

const fetcher = (url) => fetch(url).then((response) => response.json())

function postFetcher([url, formData]) {
  const body = new FormData()

  Object.entries(formData).forEach(([key, value]) => body.append(key, value))

  return fetch(url, { method: 'POST', body }).then((response) =>
    response.text()
  )
}

export default function useStyloExport({ bibliography_style, bib: excerpt }) {
  const { pandocExportEndpoint } = applicationConfig

  const { data: exportFormats } = useSWR(
    `${pandocExportEndpoint}/api/available_exports`,
    fetcher,
    { fallbackData: [] }
  )
  const { data: exportStyles } = useSWR(
    `${pandocExportEndpoint}/api/available_bibliographic_styles`,
    fetcher,
    { fallbackData: [] }
  )
  const { data: exportStylesPreview, isLoading } = useSWR(
    () => {
      if (bibliography_style !== '') {
        return [
          `${pandocExportEndpoint}/api/bibliography_preview`,
          { excerpt, bibliography_style },
        ]
      }
      return null
    },
    postFetcher,
    { fallbackData: '' }
  )

  return {
    exportFormats,
    exportStyles: exportStyles.map(({ title: name, name: key }) => ({
      key,
      name,
    })),
    exportStylesPreview,
    isLoading,
  }
}

/**
 *
 * @param {{
 *   md_content: string,
 *   bib_content: string,
 *   yaml_content: string,
 *   with_toc?: boolean,
 *   with_nocite?: boolean,
 *   with_link_citations?: boolean
 * }} StyloExportPreviewParams
 * @returns {Promise<{ html: string, isLoading: boolean }>}
 */
export function useStyloExportPreview({
  md_content,
  bib_content,
  yaml_content,
  with_toc = false,
  with_nocite = false,
  with_link_citations = false,
}) {
  const { pandocExportEndpoint } = applicationConfig
  const endpointUsable = isPandocEndpointUsable(pandocExportEndpoint)
  const { data: html, isLoading } = useSWR(
    () => {
      // Pause until inputs and endpoint are ready (SWR uses null, not throw).
      // https://swr.vercel.app/docs/conditional-fetching
      if (md_content === undefined || !endpointUsable) {
        return null
      }
      return [
        `${pandocExportEndpoint}/api/article_preview`,
        {
          bibliography_style: 'chicagomodified',
          md_content,
          yaml_content,
          bib_content,
          with_toc,
          with_nocite,
          with_link_citations,
        },
      ]
    },
    postFetcher,
    { fallbackData: '' }
  )

  return { html, isLoading }
}
