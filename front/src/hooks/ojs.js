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
