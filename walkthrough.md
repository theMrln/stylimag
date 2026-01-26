# OJS Integration Walkthrough

I have implemented the functionality to import issues from OJS into Stylo as Corpora, with their submissions becoming Articles.

## Changes

### 1. Configuration
- Added `OJS_API_ENDPOINT` and `OJS_API_TOKEN` processing in the new helper.
- **Action Required**: You must update your `.env` file with these keys.

### 2. Helper Module
- created `graphql/helpers/ojs.js` to handle API communication with OJS.

### 3. GraphQL Schema
- Updated `graphql/schema.js` to include:
    - `type OjsIssue`
    - `Query.ojsIssues`
    - `Mutation.importCorpusFromOJS`

### 4. Resolvers
- Created `graphql/resolvers/ojsResolver.js` which implements the logic:
    - Fetches issue metadata.
    - Creates a new Corpus.
    - Iterates (sequentially) through articles/submissions.
    - Creates Articles with OJS metadata.
    - Links everything together (User -> Article, User -> Workspace, Workspace -> Corpus, Corpus -> Article).
- Registered the new resolver in `graphql/resolvers/index.js`.

### 5. Verification
- Created `graphql/resolvers/ojsResolver.test.js` with unit tests mocking the OJS API responses.

## Verification Steps

To verify the implementation:

1.  **Configure Environment**:
    Add the following to your `.env` file:
    ```bash
    OJS_API_ENDPOINT=https://your-ojs-site.com/index.php/journal/api/v1
    OJS_API_TOKEN=your_api_token
    ```

    You must run the tests from the `graphql` directory. If you are using a local MongoDB instead of Docker, set `TEST_DATABASE_URL`:
    ```bash
    cd graphql
    export TEST_DATABASE_URL=mongodb://127.0.0.1:27017/stylo-tests
    node --test resolvers/ojsResolver.test.js
    ```

3.  **Manual Test (GraphQL Playground)**:
    - Start the server: `npm run dev:graphql`
    - List issues:
      ```graphql
      query {
        ojsIssues {
          id
          title
        }
      }
      ```
    - Import an issue (replace `123` with real ID and use a valid Workspace ID):
      ```graphql
      mutation {
        importCorpusFromOJS(issueId: 123, workspaceId: "your_workspace_id") {
          _id
          name
          articles {
            article {
              title
            }
          }
        }
      }
      ```
