
const { Mutation: OjsMutation, Query: OjsQuery } = require('./ojsResolver')
const { before, after, describe, test, mock } = require('node:test')
const assert = require('node:assert')
const { setup, teardown } = require('../tests/harness')
const User = require('../models/user')
const Workspace = require('../models/workspace')
const ojsHelper = require('../helpers/ojs')

describe('ojs resolver', () => {
  let container
  let user
  let workspace

  before(async () => {
    container = await setup()
    user = await User.create({
      email: 'ojs-test@stylo.com',
      firstName: 'OJS',
      lastName: 'Tester',
    })
    workspace = await Workspace.create({
        name: 'OJS Workspace',
        color: '#ff0000',
        creator: user.id
    })
    // Add user as member
    workspace.members.push({ user: user.id })
    await workspace.save()
  })

  after(async () => {
    await teardown(container)
  })

  test('fetch issues', async () => {
    // Mock getOjsIssues
    const mockIssues = [{ id: 1, title: { en_US: 'Issue 1' } }]
    const mockFn = mock.method(ojsHelper, 'getOjsIssues', async () => mockIssues)

    const result = await OjsQuery.ojsIssues({}, {}, { user })
    assert.deepEqual(result, mockIssues)
    assert.equal(mockFn.mock.callCount(), 1)
    
    // Restore mock
    mockFn.mock.restore()
  })

  test('import corpus from OJS', async () => {
      // Mock helpers
      const mockIssueMetadata = {
          id: 123,
          title: { en_US: 'My Awesome Issue' },
          description: { en_US: 'Description' }
      }
      const mockSubmissions = [
          {
              id: 999,
              title: { en_US: 'Article 1' },
              abstract: { en_US: 'Abstract 1' }
          },
          {
            id: 1000,
            title: { en_US: 'Article 2' },
            abstract: { en_US: 'Abstract 2' }
        }
      ]

      const metaMock = mock.method(ojsHelper, 'getOjsIssueMetadata', async () => mockIssueMetadata)
      const subMock = mock.method(ojsHelper, 'getOjsIssueSubmissions', async () => mockSubmissions)

      const corpus = await OjsMutation.importCorpusFromOJS(
          {},
          { issueId: 123, workspaceId: workspace.id },
          { user }
      )

      assert.equal(corpus.name, 'My Awesome Issue')
      assert.equal(corpus.articles.length, 2)
      assert.equal(corpus.workspace.toString(), workspace.id.toString())
      
      // Verify articles
      const article1 = corpus.articles[0]
      // Need to populate or fetch article? 
      // The resolver pushes objects { article: ArticleDoc, order: 0 }
      // but Mongoose array push might just have IDs if not populated?
      // Actually in the resolver we did: newCorpus.articles.push({ article: newArticle, order: order++ })
      // where newArticle is a document. So it should be present.
      
      // But verify with DB fetch to be sure
      const dbCorpus = await require('../models/corpus').findById(corpus._id).populate({path: 'articles.article'})
      assert.equal(dbCorpus.articles.length, 2)
      assert.equal(dbCorpus.articles[0].article.title, 'Article 1')
      assert.equal(dbCorpus.metadata.ojs.id, 123)

      metaMock.mock.restore()
      subMock.mock.restore()

  })

  test('import throws if not authenticated', async () => {
      await assert.rejects(
          async () => OjsMutation.importCorpusFromOJS({}, { issueId: 1, workspaceId: '1' }, {}),
          { message: 'Unable to find an authentication context.' }
      )
  })

  test('import throws if workspace not found', async () => {
    await assert.rejects(
        async () => OjsMutation.importCorpusFromOJS({}, { issueId: 1, workspaceId: '000000000000000000000000' }, { user }),
        { message: 'Unable to find resource Workspace #000000000000000000000000.' }
    )
  })

})
