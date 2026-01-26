# OJS Metadata Import Implementation

## Goal
Enable Stylo to import metadata directly from Open Journal Systems (OJS). This functionality will allow users to select an OJS issue, which will then be imported as a Stylo Corpus, with all its articles created as Stylo Articles populated with metadata from OJS.

## User Review Required
> [!IMPORTANT]
> **Environment Configuration**: The user must provide `OJS_API_ENDPOINT` and `OJS_API_TOKEN` in the `.env` file for this feature to work.
> **Authentication**: The implementation assumes the provided API Token has sufficient permissions to read issues and submissions.

## Proposed Changes

### Configuration
#### ✅ [MODIFY] [.env](file:///Users/mrln/gitlab/stylo-miroir/.env)
- Add `OJS_API_ENDPOINT` and `OJS_API_TOKEN` variables.
- Template updated in `infrastructure/templates/.env`.

### GraphQL Backend
#### ✅ [NEW] [graphql/helpers/ojs.js](file:///Users/mrln/gitlab/stylo-miroir/graphql/helpers/ojs.js)
- Implement `fetchOjs(path, options)` helper using native `fetch`.
- Implement `getOjsIssues()`: Fetches list of issues.
- Implement `getOjsIssueMetadata(issueId)`: Fetches metadata for a specific issue.
- Implement `getOjsPublication(submissionId, publicationId)`: Fetches metadata for a specific article/publication.

#### ✅ [MODIFY] [graphql/schema.js](file:///Users/mrln/gitlab/stylo-miroir/graphql/schema.js)
- Add `type OjsIssue { id: Int!, title: JSON, ... }`.
- Add `Query.ojsIssues: [OjsIssue]`.
- Add `Mutation.importCorpusFromOJS(issueId: Int!, workspaceId: ID!): Corpus`.

#### ✅ [NEW] [graphql/resolvers/ojsResolver.js](file:///Users/mrln/gitlab/stylo-miroir/graphql/resolvers/ojsResolver.js)
- Implement `Query.ojsIssues`.
- Implement `Mutation.importCorpusFromOJS`:
    - Fetch issue metadata.
    - Create new `Corpus` (mapped from Issue).
    - Iterate through articles in the issue.
    - Create new `Article` (mapped from Submission/Publication).
    - populate `Article` metadata using `updateWorkingVersion`.
    - Add `Article` to `Corpus`.

#### ✅ [MODIFY] [graphql/resolvers/index.js](file:///Users/mrln/gitlab/stylo-miroir/graphql/resolvers/index.js)
- Register the new `ojsResolver` (OjsQuery and OjsMutation are spread into Query/Mutation).

## Verification Plan

### Automated Tests
- ✅ Unit tests for `graphql/helpers/ojs.js` (`graphql/helpers/ojs.test.js`) - tests URL construction, error handling, missing config.
- ✅ `graphql/resolvers/ojsResolver.test.js` to test the resolver logic (mocking the helper).

### Manual Verification
1.  Configure `.env` with valid OJS credentials.
2.  Start the GraphQL server: `npm run dev:graphql`.
3.  Open GraphQL Playground (usually at `http://localhost:3000/graphql` or similar).
4.  Run query `query { ojsIssues { id title } }` to verify connection and listing.
5.  Run mutation `mutation { importCorpusFromOJS(issueId: "...") { _id name articles { article { title } } } }`.
6.  Verify in Stylo UI (or via Query) that the Corpus and Articles exist and have correct metadata.
