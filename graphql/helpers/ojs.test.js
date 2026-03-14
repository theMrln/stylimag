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

    test('returns empty array when no articles', async () => {
      global.fetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          id: 123,
          title: { en_US: 'Empty Issue' },
        }),
      }))

      const result = await ojsHelper.getOjsIssueSubmissions('production', 123)

      assert.deepEqual(result, [])
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
