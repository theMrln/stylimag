const { describe, test, mock, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')

describe('ojs helper', () => {
  let ojsHelper
  let originalEnv
  let mockFetch

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }

    // Set test env vars BEFORE requiring the module
    process.env.OJS_API_ENDPOINT = 'https://ojs.example.com/api/v1'
    process.env.OJS_API_TOKEN = 'test-token-123'

    // Clear module cache to ensure fresh load with new env vars
    delete require.cache[require.resolve('./ojs.js')]

    // Mock global fetch
    mockFetch = mock.fn()
    global.fetch = mockFetch

    // Load the module fresh
    ojsHelper = require('./ojs.js')
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    // Clean up mock
    mock.reset()
  })

  describe('getOjsIssues', () => {
    test('fetches issues with correct URL', async () => {
      const mockIssues = [
        { id: 1, title: { en_US: 'Issue 1' } },
        { id: 2, title: { en_US: 'Issue 2' } },
      ]
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ items: mockIssues }),
      }))

      const result = await ojsHelper.getOjsIssues()

      assert.deepEqual(result, mockIssues)
      assert.equal(mockFetch.mock.callCount(), 1)

      const calledUrl = mockFetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/issues\?orderBy=id&orderDirection=DESC&apiToken=test-token-123/
      )
    })

    test('returns empty array when no items', async () => {
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({}),
      }))

      const result = await ojsHelper.getOjsIssues()

      assert.deepEqual(result, [])
    })

    test('throws on API error', async () => {
      mockFetch.mock.mockImplementation(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }))

      await assert.rejects(
        async () => ojsHelper.getOjsIssues(),
        { message: 'OJS API Error: 401 Unauthorized' }
      )
    })
  })

  describe('getOjsIssueMetadata', () => {
    test('fetches issue metadata with correct URL', async () => {
      const mockMetadata = {
        id: 123,
        title: { en_US: 'Test Issue' },
        description: { en_US: 'Description' },
      }
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockMetadata,
      }))

      const result = await ojsHelper.getOjsIssueMetadata(123)

      assert.deepEqual(result, mockMetadata)
      assert.equal(mockFetch.mock.callCount(), 1)

      const calledUrl = mockFetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/issues\/123\?apiToken=test-token-123/
      )
    })

    test('throws on 404', async () => {
      mockFetch.mock.mockImplementation(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }))

      await assert.rejects(
        async () => ojsHelper.getOjsIssueMetadata(999),
        { message: 'OJS API Error: 404 Not Found' }
      )
    })
  })

  describe('getOjsIssueSubmissions', () => {
    test('returns articles from issue metadata', async () => {
      const mockArticles = [
        { id: 1, title: { en_US: 'Article 1' } },
        { id: 2, title: { en_US: 'Article 2' } },
      ]
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          id: 123,
          title: { en_US: 'Test Issue' },
          articles: mockArticles,
        }),
      }))

      const result = await ojsHelper.getOjsIssueSubmissions(123)

      assert.deepEqual(result, mockArticles)
    })

    test('returns empty array when no articles', async () => {
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          id: 123,
          title: { en_US: 'Empty Issue' },
        }),
      }))

      const result = await ojsHelper.getOjsIssueSubmissions(123)

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
      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => mockPublication,
      }))

      const result = await ojsHelper.getOjsPublication(100, 456)

      assert.deepEqual(result, mockPublication)
      assert.equal(mockFetch.mock.callCount(), 1)

      const calledUrl = mockFetch.mock.calls[0].arguments[0]
      assert.match(
        calledUrl,
        /https:\/\/ojs\.example\.com\/api\/v1\/submissions\/100\/publications\/456\?apiToken=test-token-123/
      )
    })
  })

  describe('missing configuration', () => {
    test('throws when OJS_API_ENDPOINT is missing', async () => {
      // Clear and reload without endpoint
      delete process.env.OJS_API_ENDPOINT
      process.env.OJS_API_TOKEN = 'test-token'
      delete require.cache[require.resolve('./ojs.js')]
      const ojsHelperNoEndpoint = require('./ojs.js')

      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ items: [] }),
      }))

      await assert.rejects(
        async () => ojsHelperNoEndpoint.getOjsIssues(),
        { message: 'OJS configuration missing (OJS_API_ENDPOINT or OJS_API_TOKEN)' }
      )
    })

    test('throws when OJS_API_TOKEN is missing', async () => {
      // Clear and reload without token
      process.env.OJS_API_ENDPOINT = 'https://ojs.example.com/api/v1'
      delete process.env.OJS_API_TOKEN
      delete require.cache[require.resolve('./ojs.js')]
      const ojsHelperNoToken = require('./ojs.js')

      mockFetch.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ items: [] }),
      }))

      await assert.rejects(
        async () => ojsHelperNoToken.getOjsIssues(),
        { message: 'OJS configuration missing (OJS_API_ENDPOINT or OJS_API_TOKEN)' }
      )
    })
  })
})
