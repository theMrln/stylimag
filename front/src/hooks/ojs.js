import { useSelector } from 'react-redux'

import { executeQuery } from '../helpers/graphQL.js'
import useGraphQL, { useMutateData } from './graphql.js'
import { useActiveWorkspaceId } from './workspace.js'

import {
  getOjsIssues as getOjsIssuesQuery,
  importCorpusFromOJS as importCorpusFromOJSMutation,
} from './Ojs.graphql'

import { getCorpus as getCorpusQuery } from './Corpus.graphql'

/**
 * Hook to fetch OJS issues
 * @returns {{issues: Array, error: Error|null, isLoading: boolean}}
 */
export function useOjsIssues() {
  const { data, error, isLoading } = useGraphQL(
    {
      query: getOjsIssuesQuery,
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )

  return {
    issues: data?.ojsIssues || [],
    error,
    isLoading,
  }
}

/**
 * Hook for OJS import actions
 * @returns {{importCorpus: function(number): Promise<object>}}
 */
export function useOjsImport() {
  const workspaceId = useActiveWorkspaceId() ?? null
  const sessionToken = useSelector((state) => state.sessionToken)

  // Mutate corpus list after import
  const { mutate } = useMutateData({
    query: getCorpusQuery,
    variables: {
      isPersonalWorkspace: !workspaceId,
      filter: {
        workspaceId,
      },
      workspaceId,
    },
  })

  const importCorpus = async (issueId) => {
    const response = await executeQuery({
      sessionToken,
      query: importCorpusFromOJSMutation,
      variables: {
        issueId: parseInt(issueId, 10),
        workspaceId,
      },
    })

    // Update the corpus list with the new corpus
    await mutate(async (data) => {
      return {
        ...data,
        corpus: [...(data?.corpus ?? []), response.importCorpusFromOJS],
      }
    })

    return response.importCorpusFromOJS
  }

  return {
    importCorpus,
  }
}
