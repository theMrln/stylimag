const { describe, test, mock, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')

const testConfig = {
  api_endpoint: 'https://ojs.example.com/api/v1',
  api_token: 'test-token-123',
}

describe('ojs helper', () => {
  let ojsHelper

  beforeEach(() => {
    // Mock ojsConfig.getOjsInstanceConfig to return test config for any instance
    const ojsConfig = require('./ojsConfig.js')
    mock.method(ojsConfig, 'getOjsInstanceConfig', () => testConfig)

    delete require.cache[require.resolve('./ojs.js')]
    const mockFetch = mock.fn()
    global.fetch = mockFetch
    ojsHelper = require('./ojs.js')
  })

  afterEach(() => {
    mock.reset()
  })

  describe('getOjsIssues', () => {
    test('fetches issues with correct URL', async () => {
      const mockIssues = [
        { id: 1, title: { en_US: 'Issue 1' } },
        { id: 2, title: { en_US: 'Issue 2' } },
      ]
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ items: mockIssues }),
      }))

      const result = await ojsHelper.getOjsIssues('staging')

      assert.deepEqual(result, mockIssues)
      assert.equal(global.fetch.mock.callCount(), 1)
      const calledUrl = global.fetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /\/issues\?orderBy=datePublished&orderDirection=DESC&count=500&apiToken=test-token-123/
      )
    })

    test('returns empty array when no items', async () => {
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({}),
      }))

      const result = await ojsHelper.getOjsIssues('production')

      assert.deepEqual(result, [])
    })

    test('returns issues sorted latest first', async () => {
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          items: [
            { id: 1, datePublished: '2020-01-01', year: 2020 },
            { id: 3, datePublished: '2023-06-15', year: 2023 },
            { id: 2, datePublished: '2021-05-01', year: 2021 },
          ],
        }),
      }))

      const result = await ojsHelper.getOjsIssues('staging')

      assert.equal(result[0].id, 3)
      assert.equal(result[1].id, 2)
      assert.equal(result[2].id, 1)
    })

    test('throws on API error', async () => {
      global.fetch.mock.mockImplementation(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }))

      await assert.rejects(async () => ojsHelper.getOjsIssues('staging'), {
        message: /OJS API Error \[staging\]: 401 Unauthorized/,
      })
    })
  })

  describe('getOjsIssueMetadata', () => {
    test('fetches issue metadata with correct URL', async () => {
      const mockMetadata = {
        id: 123,
        title: { en_US: 'Test Issue' },
        description: { en_US: 'Description' },
      }
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockMetadata,
      }))

      const result = await ojsHelper.getOjsIssueMetadata('staging', 123)

      assert.deepEqual(result, mockMetadata)
      assert.equal(global.fetch.mock.callCount(), 1)
      const calledUrl = global.fetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/issues\/123\?apiToken=test-token-123/
      )
    })

    test('throws on 404', async () => {
      global.fetch.mock.mockImplementation(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }))

      await assert.rejects(
        async () => ojsHelper.getOjsIssueMetadata('staging', 999),
        { message: /OJS API Error \[staging\]: 404 Not Found/ }
      )
    })
  })

  describe('getOjsIssueSubmissions', () => {
    test('returns articles from issue metadata', async () => {
      const mockArticles = [
        { id: 1, title: { en_US: 'Article 1' } },
        { id: 2, title: { en_US: 'Article 2' } },
      ]
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          id: 123,
          title: { en_US: 'Test Issue' },
          articles: mockArticles,
        }),
      }))

      const result = await ojsHelper.getOjsIssueSubmissions('staging', 123)

      assert.deepEqual(result, mockArticles)
    })

    test('returns empty array when no embedded articles and submissions list empty', async () => {
      let calls = 0
      global.fetch.mock.mockImplementation(async (url) => {
        calls++
        const u = String(url)
        if (u.includes('/issues/')) {
          return {
            ok: true,
            json: async () => ({
              id: 123,
              title: { en_US: 'Empty Issue' },
            }),
          }
        }
        if (u.includes('/submissions?') && u.includes('issueIds')) {
          return {
            ok: true,
            json: async () => ({ items: [] }),
          }
        }
        throw new Error(`unexpected fetch url: ${u}`)
      })

      const result = await ojsHelper.getOjsIssueSubmissions('production', 123)

      assert.deepEqual(result, [])
      assert.equal(calls, 2)
    })

    test('falls back to /submissions?issueIds when issue has no articles array', async () => {
      let calls = 0
      global.fetch.mock.mockImplementation(async (url) => {
        calls++
        const u = String(url)
        if (u.includes('/issues/88')) {
          return {
            ok: true,
            json: async () => ({
              id: 88,
              title: { en_US: 'Future Issue' },
            }),
          }
        }
        if (u.includes('/submissions?') && u.includes('issueIds')) {
          assert.match(u, /issueIds%5B%5D=88|issueIds\[\]=88/)
          return {
            ok: true,
            json: async () => ({
              items: [
                { id: 500, status: 5, title: { en_US: 'Scheduled submission' } },
              ],
            }),
          }
        }
        throw new Error(`unexpected fetch url: ${u}`)
      })

      const result = await ojsHelper.getOjsIssueSubmissions('staging', 88)

      assert.equal(result.length, 1)
      assert.equal(result[0].id, 500)
      assert.equal(result[0].status, 5)
      assert.equal(calls, 2)
    })

    test('uses issueData option to avoid a second GET /issues when articles missing', async () => {
      global.fetch.mock.mockImplementation(async (url) => {
        const u = String(url)
        assert.ok(u.includes('/submissions?') && u.includes('issueIds'))
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 42, status: 3, title: { en_US: 'From list' } }],
          }),
        }
      })

      const result = await ojsHelper.getOjsIssueSubmissions('staging', 7, {
        issueData: { id: 7, title: { en_US: 'Preloaded' } },
      })

      assert.equal(result.length, 1)
      assert.equal(result[0].id, 42)
      assert.equal(global.fetch.mock.callCount(), 1)
    })
  })

  describe('getOjsSubmission', () => {
    test('fetches submission with correct URL', async () => {
      const mockSubmission = {
        id: 100,
        currentPublicationId: 456,
        title: { en_US: 'Submission Title' },
      }
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockSubmission,
      }))

      const result = await ojsHelper.getOjsSubmission('staging', 100)

      assert.deepEqual(result, mockSubmission)
      assert.equal(global.fetch.mock.callCount(), 1)
      const calledUrl = global.fetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/submissions\/100\?apiToken=test-token-123/
      )
    })
  })

  describe('getOjsPublication', () => {
    test('fetches publication with correct URL', async () => {
      const mockPublication = {
        id: 456,
        submissionId: 100,
        title: { en_US: 'Publication Title' },
        abstract: { en_US: 'Abstract text' },
      }
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockPublication,
      }))

      const result = await ojsHelper.getOjsPublication('staging', 100, 456)

      assert.deepEqual(result, mockPublication)
      assert.equal(global.fetch.mock.callCount(), 1)
      const calledUrl = global.fetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/submissions\/100\/publications\/456\?apiToken=test-token-123/
      )
    })
  })

  describe('getSubmissionWithFullPublication', () => {
    test('enriches submission with full publication when currentPublicationId present', async () => {
      const articleFromIssue = { id: 100, currentPublicationId: 456 }
      const mockPublication = {
        id: 456,
        submissionId: 100,
        fullTitle: { en_US: 'Full Title' },
        authors: [{ givenName: { en_US: 'Jane' }, familyName: { en_US: 'Doe' } }],
      }
      global.fetch.mock.mockImplementation(async (url) => ({
        ok: true,
        json: async () => {
          if (url.includes('/publications/')) return mockPublication
          return articleFromIssue
        },
      }))

      const result = await ojsHelper.getSubmissionWithFullPublication(
        'staging',
        articleFromIssue
      )

      assert.equal(result.id, 100)
      assert.equal(result.publications?.length, 1)
      assert.deepEqual(result.publications[0], mockPublication)
      assert.equal(global.fetch.mock.callCount(), 1)
    })

    test('fetches submission then publication when publicationId missing', async () => {
      const articleFromIssue = { id: 100 }
      const mockSubmission = { id: 100, currentPublicationId: 456 }
      const mockPublication = {
        id: 456,
        fullTitle: { en_US: 'Title' },
        authors: [],
      }
      let callCount = 0
      global.fetch.mock.mockImplementation(async (url) => {
        callCount++
        return {
          ok: true,
          json: async () => {
            if (url.includes('/submissions/100') && !url.includes('/publications/'))
              return mockSubmission
            return mockPublication
          },
        }
      })

      const result = await ojsHelper.getSubmissionWithFullPublication(
        'staging',
        articleFromIssue
      )

      assert.equal(result.id, 100)
      assert.equal(result.publications?.length, 1)
      assert.equal(callCount, 2)
    })

    test('returns submission unchanged when id missing', async () => {
      const articleFromIssue = { title: { en_US: 'No id' } }
      const result = await ojsHelper.getSubmissionWithFullPublication(
        'staging',
        articleFromIssue
      )
      assert.strictEqual(result, articleFromIssue)
      assert.equal(global.fetch.mock.callCount(), 0)
    })
  })

  describe('getOjsSection', () => {
    test('fetches section and returns title', async () => {
      const mockSection = { id: 1, title: { en_US: 'Articles' } }
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockSection,
      }))
      const result = await ojsHelper.getOjsSection('staging', 1)
      assert.deepEqual(result, mockSection)
      assert.match(
        global.fetch.mock.calls[0].arguments[0],
        /\/sections\/1\?apiToken=/
      )
    })

    test('returns null when section fetch fails', async () => {
      global.fetch.mock.mockImplementation(async () => {
        throw new Error('Not Found')
      })
      const result = await ojsHelper.getOjsSection('staging', 999)
      assert.strictEqual(result, null)
    })
  })

  describe('missing configuration', () => {
    test('throws when instance config is missing', async () => {
      const ojsConfig = require('./ojsConfig.js')
      mock.method(ojsConfig, 'getOjsInstanceConfig', () => null)
      delete require.cache[require.resolve('./ojs.js')]
      const ojsHelperNoConfig = require('./ojs.js')

      await assert.rejects(
        async () => ojsHelperNoConfig.getOjsIssues('staging'),
        { message: /OJS configuration missing for instance "staging"/ }
      )
    })
  })
})
