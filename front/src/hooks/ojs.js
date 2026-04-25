import { useSelector } from 'react-redux'

import { executeQuery } from '../helpers/graphQL.js'
import useGraphQL, {
  useConditionalFetchData,
  useMutateData,
} from './graphql.js'
import { useActiveWorkspaceId } from './workspace.js'

import { getCorpus as getCorpusQuery } from './Corpus.graphql'
import {
  getOjsInstances as getOjsInstancesQuery,
  getOjsIssues as getOjsIssuesQuery,
  importCorpusFromOJS as importCorpusFromOJSMutation,
  pushArticleMetadataToOJS as pushArticleMetadataToOJSMutation,
  pushCorpusArticleOrderToOJS as pushCorpusArticleOrderToOJSMutation,
} from './Ojs.graphql'

/**
 * Hook to fetch configured OJS instances (staging, production).
 * @returns {{instances: string[], error: Error|null, isLoading: boolean}}
 */
export function useOjsInstances() {
  const { data, error, isLoading } = useGraphQL(
    { query: getOjsInstancesQuery },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  return {
    instances: data?.ojsInstances ?? [],
    error,
    isLoading,
  }
}

/**
 * Hook to fetch OJS issues for a given instance. Fetches only when instance is set.
 * @param {'staging'|'production'|null} instance - Ojs instance; pass null to skip fetch
 * @returns {{issues: Array, error: Error|null, isLoading: boolean}}
 */
export function useOjsIssues(instance) {
  const { data, error, isLoading } = useConditionalFetchData(
    () =>
      instance ? { query: getOjsIssuesQuery, variables: { instance } } : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )
  return {
    issues: data?.ojsIssues ?? [],
    error,
    isLoading,
  }
}

/**
 * Hook for OJS import actions.
 * @returns {{importCorpus: function(number, 'staging'|'production'): Promise<object>}}
 */
export function useOjsImport() {
  const workspaceId = useActiveWorkspaceId() ?? null
  const sessionToken = useSelector((state) => state.sessionToken)

  const { mutate } = useMutateData({
    query: getCorpusQuery,
    variables: {
      isPersonalWorkspace: !workspaceId,
      filter: { workspaceId },
      workspaceId,
    },
  })

  const importCorpus = async (issueId, instance) => {
    const response = await executeQuery({
      sessionToken,
      query: importCorpusFromOJSMutation,
      variables: {
        issueId: parseInt(issueId, 10),
        workspaceId,
        instance,
      },
    })

    await mutate(async (data) => {
      return {
        ...data,
        corpus: [...(data?.corpus ?? []), response.importCorpusFromOJS],
      }
    })

    return response.importCorpusFromOJS
  }

  return { importCorpus }
}

/**
 * Hook for pushing the side-panel metadata of an article back to OJS.
 * Returns a function that takes the article id (and optional instance override)
 * and resolves to true on success.
 * @returns {{ pushArticleMetadata: (articleId: string, instance?: 'staging'|'production') => Promise<boolean> }}
 */
export function usePushArticleMetadataToOJS() {
  const sessionToken = useSelector((state) => state.sessionToken)

  const pushArticleMetadata = async (articleId, instance) => {
    const response = await executeQuery({
      sessionToken,
      query: pushArticleMetadataToOJSMutation,
      variables: { articleId, instance: instance ?? null },
      type: 'mutation',
    })
    return response?.pushArticleMetadataToOJS === true
  }

  return { pushArticleMetadata }
}

/**
 * Hook for pushing the article order within each section of a corpus back to
 * OJS as publication seq updates.
 * @returns {{ pushOrder: (corpusId: string, instance?: 'staging'|'production') => Promise<number> }}
 */
export function usePushCorpusArticleOrderToOJS() {
  const sessionToken = useSelector((state) => state.sessionToken)

  const pushOrder = async (corpusId, instance) => {
    const response = await executeQuery({
      sessionToken,
      query: pushCorpusArticleOrderToOJSMutation,
      variables: { corpusId, instance: instance ?? null },
      type: 'mutation',
    })
    return response?.pushCorpusArticleOrderToOJS ?? 0
  }

  return { pushOrder }
}
