const { Mutation: OjsMutation, Query: OjsQuery } = require('./ojsResolver')
const { before, after, describe, test, mock } = require('node:test')
const assert = require('node:assert')
const { setup, teardown } = require('../tests/harness')
const User = require('../models/user')
const Workspace = require('../models/workspace')
const Article = require('../models/article')
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
      creator: user.id,
    })
    // Add user as member
    workspace.members.push({ user: user.id })
    await workspace.save()
  })

  after(async () => {
    await teardown(container)
  })

  test('fetch issues', async () => {
    const mockIssues = [{ id: 1, title: { en_US: 'Issue 1' } }]
    const mockFn = mock.method(
      ojsHelper,
      'getOjsIssues',
      async () => mockIssues
    )

    const result = await OjsQuery.ojsIssues(
      {},
      { instance: 'staging' },
      { user }
    )
    assert.deepEqual(result, mockIssues)
    assert.equal(mockFn.mock.callCount(), 1)
    assert.equal(mockFn.mock.calls[0].arguments[0], 'staging')
    mockFn.mock.restore()
  })

  test('import corpus from OJS', async () => {
    // Mock helpers
    const mockIssueMetadata = {
      id: 123,
      title: { en_US: 'My Awesome Issue' },
      description: { en_US: 'Description' },
    }
    const mockSubmissions = [
      {
        id: 999,
        title: { en_US: 'Article 1' },
        abstract: { en_US: 'Abstract 1' },
      },
      {
        id: 1000,
        title: { en_US: 'Article 2' },
        abstract: { en_US: 'Abstract 2' },
      },
    ]

    const metaMock = mock.method(
      ojsHelper,
      'getOjsIssueMetadata',
      async () => mockIssueMetadata
    )
    const subMock = mock.method(
      ojsHelper,
      'getOjsIssueSubmissions',
      async () => mockSubmissions
    )

    const corpus = await OjsMutation.importCorpusFromOJS(
      {},
      { issueId: 123, workspaceId: workspace.id, instance: 'staging' },
      { user }
    )

    assert.equal(corpus.name, 'My Awesome Issue')
    assert.equal(corpus.articles.length, 2)
    assert.equal(corpus.workspace.toString(), workspace.id.toString())

    // Verify with DB fetch
    const dbCorpus = await require('../models/corpus')
      .findById(corpus._id)
      .populate({ path: 'articles.article' })
    assert.equal(dbCorpus.articles.length, 2)
    assert.equal(dbCorpus.articles[0].article.title, 'Article 1')
    assert.equal(dbCorpus.metadata.ojs.id, 123)

    metaMock.mock.restore()
    subMock.mock.restore()
  })

  test('import throws if not authenticated', async () => {
    await assert.rejects(
      async () =>
        OjsMutation.importCorpusFromOJS(
          {},
          { issueId: 1, workspaceId: '1', instance: 'staging' },
          {}
        ),
      { message: 'Unable to find an authentication context.' }
    )
  })

  test('import throws if workspace not found', async () => {
    await assert.rejects(
      async () =>
        OjsMutation.importCorpusFromOJS(
          {},
          {
            issueId: 1,
            workspaceId: '000000000000000000000000',
            instance: 'staging',
          },
          { user }
        ),
      {
        message: 'Unable to find resource Workspace #000000000000000000000000.',
      }
    )
  })

  // Helper: build an article with a fixed OJS reference and a list of side-panel authors.
  async function articleWithAuthors(authors) {
    return Article.create({
      title: 'Push test',
      owner: user.id,
      workingVersion: {
        md: '',
        bib: '',
        metadata: {
          locale: 'en',
          title: { en_US: 'Pushed Title' },
          abstract: { en_US: 'Pushed Abstract' },
          start_page: 7,
          authors,
          ojs: { id: 555, currentPublicationId: 777, _instance: 'staging' },
        },
      },
    })
  }

  function mockOjsAuthorEndpoints(existing) {
    return {
      updatePub: mock.method(
        ojsHelper,
        'updateOjsPublication',
        async () => ({ ok: true })
      ),
      listAuthors: mock.method(
        ojsHelper,
        'getOjsPublicationAuthors',
        async () => existing
      ),
      updateAuthor: mock.method(
        ojsHelper,
        'updateOjsAuthor',
        async () => ({ ok: true })
      ),
      createAuthor: mock.method(
        ojsHelper,
        'createOjsAuthor',
        async () => ({ id: 99 })
      ),
      deleteAuthor: mock.method(
        ojsHelper,
        'deleteOjsAuthor',
        async () => ({ ok: true })
      ),
    }
  }

  test('push article syncs publication fields and matches authors by name when names overlap', async () => {
    // Side panel: Alice, Carol, Eve.  OJS: Alice, Bob.
    // Name match: Alice. Counts of leftovers differ (2 vs 1) so no positional
    // fallback. Carol + Eve are CREATED, Bob is DELETED.
    const article = await articleWithAuthors([
      { givenName: { en_US: 'Alice' }, familyName: { en_US: 'Smith' } },
      { givenName: { en_US: 'Carol' }, familyName: { en_US: 'Doe' } },
      { givenName: { en_US: 'Eve' }, familyName: { en_US: 'New' } },
    ])
    const m = mockOjsAuthorEndpoints([
      {
        id: 11,
        seq: 0,
        userGroupId: 14,
        givenName: { en_US: 'Alice' },
        familyName: { en_US: 'Smith' },
      },
      {
        id: 12,
        seq: 1,
        userGroupId: 14,
        givenName: { en_US: 'Bob' },
        familyName: { en_US: 'Jones' },
      },
    ])

    const result = await OjsMutation.pushArticleMetadataToOJS(
      {},
      { articleId: article.id, instance: null },
      { user }
    )

    assert.equal(result, true)
    assert.deepEqual(m.updatePub.mock.calls[0].arguments, [
      'staging',
      555,
      777,
      {
        title: { en_US: 'Pushed Title' },
        abstract: { en_US: 'Pushed Abstract' },
        pages: '7',
      },
    ])
    assert.equal(m.updateAuthor.mock.callCount(), 1)
    assert.equal(m.updateAuthor.mock.calls[0].arguments[3], 11)
    assert.deepEqual(m.updateAuthor.mock.calls[0].arguments[4], {
      givenName: { en_US: 'Alice' },
      familyName: { en_US: 'Smith' },
      seq: 0,
    })
    assert.equal(m.createAuthor.mock.callCount(), 2)
    assert.equal(m.createAuthor.mock.calls[0].arguments[3].seq, 1)
    assert.equal(m.createAuthor.mock.calls[1].arguments[3].seq, 2)
    assert.equal(m.deleteAuthor.mock.callCount(), 1)
    assert.equal(m.deleteAuthor.mock.calls[0].arguments[3], 12)

    mock.restoreAll()
  })

  test('push article reorders authors safely (all by name)', async () => {
    // Side panel re-orders authors; every name still matches. Each existing
    // author stays attached to the same OJS record, just with a new seq.
    const article = await articleWithAuthors([
      { givenName: { en_US: 'Carol' }, familyName: { en_US: 'Doe' } },
      { givenName: { en_US: 'Alice' }, familyName: { en_US: 'Smith' } },
      { givenName: { en_US: 'Bob' }, familyName: { en_US: 'Jones' } },
    ])
    const m = mockOjsAuthorEndpoints([
      {
        id: 11,
        seq: 0,
        userGroupId: 14,
        givenName: { en_US: 'Alice' },
        familyName: { en_US: 'Smith' },
      },
      {
        id: 12,
        seq: 1,
        userGroupId: 14,
        givenName: { en_US: 'Bob' },
        familyName: { en_US: 'Jones' },
      },
      {
        id: 13,
        seq: 2,
        userGroupId: 14,
        givenName: { en_US: 'Carol' },
        familyName: { en_US: 'Doe' },
      },
    ])

    await OjsMutation.pushArticleMetadataToOJS(
      {},
      { articleId: article.id, instance: null },
      { user }
    )

    assert.equal(m.updateAuthor.mock.callCount(), 3)
    assert.equal(m.createAuthor.mock.callCount(), 0)
    assert.equal(m.deleteAuthor.mock.callCount(), 0)
    // Carol (was id 13) is now at seq 0
    assert.equal(m.updateAuthor.mock.calls[0].arguments[3], 13)
    assert.equal(m.updateAuthor.mock.calls[0].arguments[4].seq, 0)
    // Alice (was id 11) is now at seq 1
    assert.equal(m.updateAuthor.mock.calls[1].arguments[3], 11)
    assert.equal(m.updateAuthor.mock.calls[1].arguments[4].seq, 1)
    // Bob (was id 12) is now at seq 2
    assert.equal(m.updateAuthor.mock.calls[2].arguments[3], 12)
    assert.equal(m.updateAuthor.mock.calls[2].arguments[4].seq, 2)

    mock.restoreAll()
  })

  test('push article uses positional fallback for pure renames (counts equal)', async () => {
    // Side panel renames Bob -> Robert (typo fix). Same count of authors.
    // Name match catches Alice and Carol; positional fallback assigns Robert
    // to Bob's record so email/ORCID stay attached to the same person.
    const article = await articleWithAuthors([
      { givenName: { en_US: 'Alice' }, familyName: { en_US: 'Smith' } },
      { givenName: { en_US: 'Robert' }, familyName: { en_US: 'Jones' } },
      { givenName: { en_US: 'Carol' }, familyName: { en_US: 'Doe' } },
    ])
    const m = mockOjsAuthorEndpoints([
      {
        id: 11,
        seq: 0,
        userGroupId: 14,
        givenName: { en_US: 'Alice' },
        familyName: { en_US: 'Smith' },
      },
      {
        id: 12,
        seq: 1,
        userGroupId: 14,
        givenName: { en_US: 'Bob' },
        familyName: { en_US: 'Jones' },
      },
      {
        id: 13,
        seq: 2,
        userGroupId: 14,
        givenName: { en_US: 'Carol' },
        familyName: { en_US: 'Doe' },
      },
    ])

    await OjsMutation.pushArticleMetadataToOJS(
      {},
      { articleId: article.id, instance: null },
      { user }
    )

    assert.equal(m.updateAuthor.mock.callCount(), 3)
    assert.equal(m.createAuthor.mock.callCount(), 0)
    assert.equal(m.deleteAuthor.mock.callCount(), 0)
    // Robert overwrites Bob's record (id 12), preserving Bob's metadata.
    const robertCall = m.updateAuthor.mock.calls.find(
      (c) => c.arguments[4].givenName.en_US === 'Robert'
    )
    assert.equal(robertCall.arguments[3], 12)

    mock.restoreAll()
  })

  test('push article does not reassign emails when adding (counts differ)', async () => {
    // Side panel adds a new author to an existing list. Count grows from 2 to
    // 3, so positional fallback does NOT fire — the new author is created
    // rather than absorbing some existing author's email.
    const article = await articleWithAuthors([
      { givenName: { en_US: 'Alice' }, familyName: { en_US: 'Smith' } },
      { givenName: { en_US: 'Bob' }, familyName: { en_US: 'Jones' } },
      { givenName: { en_US: 'Newbie' }, familyName: { en_US: 'Author' } },
    ])
    const m = mockOjsAuthorEndpoints([
      {
        id: 11,
        seq: 0,
        userGroupId: 14,
        givenName: { en_US: 'Alice' },
        familyName: { en_US: 'Smith' },
      },
      {
        id: 12,
        seq: 1,
        userGroupId: 14,
        givenName: { en_US: 'Bob' },
        familyName: { en_US: 'Jones' },
      },
    ])

    await OjsMutation.pushArticleMetadataToOJS(
      {},
      { articleId: article.id, instance: null },
      { user }
    )

    assert.equal(m.updateAuthor.mock.callCount(), 2)
    assert.equal(m.createAuthor.mock.callCount(), 1)
    assert.equal(m.deleteAuthor.mock.callCount(), 0)
    assert.equal(
      m.createAuthor.mock.calls[0].arguments[3].givenName.en_US,
      'Newbie'
    )

    mock.restoreAll()
  })

  test('push article deletes trailing OJS authors when side panel shrinks', async () => {
    // Side panel: just Alice. OJS: Alice + two strangers.
    // Alice matches by name. Counts of leftovers differ (0 vs 2) so the two
    // strangers are deleted, not silently overwritten.
    const article = await articleWithAuthors([
      { givenName: { en_US: 'Alice' }, familyName: { en_US: 'Smith' } },
    ])
    const m = mockOjsAuthorEndpoints([
      {
        id: 11,
        seq: 0,
        userGroupId: 14,
        givenName: { en_US: 'Alice' },
        familyName: { en_US: 'Smith' },
      },
      {
        id: 12,
        seq: 1,
        userGroupId: 14,
        givenName: { en_US: 'Bob' },
        familyName: { en_US: 'Jones' },
      },
      {
        id: 13,
        seq: 2,
        userGroupId: 14,
        givenName: { en_US: 'Carol' },
        familyName: { en_US: 'Doe' },
      },
    ])

    await OjsMutation.pushArticleMetadataToOJS(
      {},
      { articleId: article.id, instance: null },
      { user }
    )

    assert.equal(m.updateAuthor.mock.callCount(), 1)
    assert.equal(m.createAuthor.mock.callCount(), 0)
    assert.equal(m.deleteAuthor.mock.callCount(), 2)

    mock.restoreAll()
  })

  test('push throws when article has no OJS reference', async () => {
    const article = await Article.create({
      title: 'No OJS',
      owner: user.id,
      workingVersion: { metadata: {} },
    })
    await assert.rejects(
      () =>
        OjsMutation.pushArticleMetadataToOJS(
          {},
          { articleId: article.id, instance: null },
          { user }
        ),
      /not imported from OJS/
    )
  })
})
