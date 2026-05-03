import * as vscode from 'monaco-editor'

import { applicationConfig } from '../../../config.js'

/**
 * Check if a file is a markdown file based on extension
 * @param {File} file
 * @returns {boolean}
 */
function isMarkdownFile(file) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')
}

/**
 * Check if a file is an image file based on type
 * @param {File} file
 * @returns {boolean}
 */
function isImageFile(file) {
  return file.type.startsWith('image/')
}

/**
 * Match a markdown image reference: `![alt](url "optional title")`.
 *
 * - alt may be empty
 * - url stops at the first whitespace or closing paren
 * - optional title is space-separated and quoted
 *
 * The regex intentionally rejects URLs containing whitespace or unmatched
 * parens so we don't try to "fix" pathological links.
 */
const MARKDOWN_IMAGE_LINK_RE =
  /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g

/**
 * Decide whether a URL points to a remote image we should fetch + persist.
 * @param {string} url
 * @returns {boolean}
 */
function isHttpImageUrl(url) {
  return /^https?:\/\//i.test(url)
}

/**
 * Decide whether a URL is already hosted on our backend asset endpoint —
 * either as a relative `/assets/images/<id>` or a fully-qualified URL on
 * the configured backend host. Such links don't need re-uploading.
 * @param {string} url
 * @returns {boolean}
 */
function isPlatformAssetUrl(url) {
  if (url.startsWith('/assets/images/')) {
    return true
  }
  const backend = applicationConfig.backendEndpoint
  if (!backend) {
    return false
  }
  try {
    const u = new URL(url, backend)
    const backendHost = new URL(backend).host
    return u.host === backendHost && u.pathname.startsWith('/assets/images/')
  } catch {
    return false
  }
}

/**
 * Decide whether a URL is "local" — i.e. a relative path or a `file://`
 * URL — and therefore only resolvable if the user provided the file along
 * with the markdown.
 * @param {string} url
 * @returns {boolean}
 */
function isLocalReference(url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url.toLowerCase().startsWith('file:')
  }
  return true
}

/**
 * Compare a markdown-relative path with an uploaded `File`'s path.
 *
 * `webkitRelativePath` is set when the user picks a directory; otherwise we
 * fall back to a plain basename match. We compare leaf segments only so
 * that `./images/cover.png` matches `whatever/images/cover.png` from a
 * folder picker.
 *
 * @param {string} reference - path as written in the markdown
 * @param {File} file
 * @returns {boolean}
 */
function fileMatchesReference(reference, file) {
  if (!reference || !file?.name) {
    return false
  }
  const normalize = (p) =>
    String(p)
      .replace(/^[./\\]+/, '')
      .replace(/\\/g, '/')
      .toLowerCase()
  const ref = normalize(reference.split('?')[0].split('#')[0])
  const filePath = normalize(file.webkitRelativePath || file.name)
  if (filePath === ref) {
    return true
  }
  if (filePath.endsWith(`/${ref}`)) {
    return true
  }
  const refBase = ref.split('/').pop()
  const fileBase = filePath.split('/').pop()
  return Boolean(refBase) && refBase === fileBase
}

/**
 * Import markdown content into the editor.
 * Uses `executeEdits` for both modes — `trigger('keyboard', 'type', …)` needs
 * the editor to be focused, which doesn't hold while the import modal is
 * still open (the surrounding document is inert).
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {string} content
 * @param {'replace' | 'insert'} mode
 */
export function importMarkdownContent(editor, content, mode) {
  const model = editor.getModel()
  if (!model) return

  if (mode === 'replace') {
    const fullRange = model.getFullModelRange()
    editor.executeEdits('import-markdown', [
      {
        range: fullRange,
        text: content,
        forceMoveMarkers: true,
      },
    ])
    editor.setPosition({ lineNumber: 1, column: 1 })
  } else {
    const selection = editor.getSelection() ?? new vscode.Range(1, 1, 1, 1)
    editor.executeEdits('import-markdown', [
      {
        range: selection,
        text: content,
        forceMoveMarkers: true,
      },
    ])
  }
  editor.focus()
}

/**
 * Read a file as text
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readFileAsText(file) {
  return file.text()
}

export class BibliographyCompletionProvider {
  constructor(bibTeXEntries) {
    this.monaco = undefined
    this._bibTeXEntries = bibTeXEntries
  }

  get bibTeXEntries() {
    return this._bibTeXEntries
  }

  set bibTeXEntries(value) {
    this._bibTeXEntries = value
  }

  register(monaco) {
    const self = this
    return monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: '@',
      provideCompletionItems: function (model, position) {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: 1,
          endColumn: position.column,
        })
        const match = textUntilPosition.match(
          /(?:^|\W)(?<square_bracket>\[?)@[^{},~#%\s\\]*$/
        )
        if (!match) {
          return { suggestions: [] }
        }
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const endCharacter = model.getValueInRange({
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column + 1,
        })
        const startsWithSquareBracket = match.groups.square_bracket === '['
        return {
          suggestions: self.createBibliographyProposals(
            range,
            { startsWithSquareBracket, endCharacter },
            monaco
          ),
        }
      },
    })
  }

  createBibliographyProposals(range, ctx, monaco) {
    const { startsWithSquareBracket, endCharacter } = ctx
    return this._bibTeXEntries.map((entry) => ({
      label: entry.key,
      kind: monaco.languages.CompletionItemKind.Reference,
      documentation: entry.title,
      insertText:
        startsWithSquareBracket && endCharacter !== ']'
          ? `${entry.key}] `
          : `${entry.key} `,
      range: range,
    }))
  }
}

/**
 * Upload an image to the backend `/assets/images` endpoint, which persists
 * it in object storage and returns a stable platform-relative URL.
 *
 * @param {File} file
 * @param {object} [ctx]
 * @param {string} [ctx.articleId]
 * @returns {Promise<string|null>} platform URL (e.g. `/assets/images/<id>`) or null on failure
 */
async function uploadImageToBackend(file, { articleId } = {}) {
  if (!applicationConfig.backendEndpoint) {
    return null
  }
  const formData = new FormData()
  formData.append('file', file)
  if (articleId) {
    formData.append('articleId', articleId)
  }
  /* Stylo auth is JWT-Bearer (read from `localStorage.sessionToken` and sent
     on every GraphQL call in `helpers/graphQL.js`), not cookies. The /assets
     route is gated by the same `populateUserFromJWT` middleware, so we MUST
     send the Bearer header here too — otherwise graphql replies 401 even
     though the cookie is sent and the user is logged in. */
  const sessionToken = localStorage.getItem('sessionToken')
  const response = await fetch(
    `${applicationConfig.backendEndpoint}/assets/images`,
    {
      method: 'POST',
      credentials: 'include',
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
      body: formData,
    }
  )
  if (!response.ok) {
    let body = ''
    try {
      body = JSON.stringify(await response.json())
    } catch {
      // ignore
    }
    console.warn(
      `Backend image upload failed for ${file.name} (status ${response.status}): ${body}`
    )
    return null
  }
  const result = await response.json()
  if (!result || !result.url) {
    return null
  }
  return `${applicationConfig.backendEndpoint}${result.url}`
}

/**
 * Persist a remote image by URL via the backend `/assets/images/from-url`
 * endpoint. Server-side fetch avoids CORS in the browser and lets the
 * existing dedup/auth logic apply uniformly.
 *
 * @param {string} url
 * @param {object} [ctx]
 * @param {string} [ctx.articleId]
 * @returns {Promise<string|null>} platform URL or null on failure
 */
async function uploadImageFromUrlToBackend(url, { articleId } = {}) {
  if (!applicationConfig.backendEndpoint) {
    return null
  }
  const sessionToken = localStorage.getItem('sessionToken')
  const response = await fetch(
    `${applicationConfig.backendEndpoint}/assets/images/from-url`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken
          ? { Authorization: `Bearer ${sessionToken}` }
          : undefined),
      },
      body: JSON.stringify({ url, ...(articleId ? { articleId } : {}) }),
    }
  )
  if (!response.ok) {
    let body = ''
    try {
      body = JSON.stringify(await response.json())
    } catch {
      // ignore
    }
    console.warn(
      `Backend image-from-url upload failed for ${url} (status ${response.status}): ${body}`
    )
    return null
  }
  const result = await response.json()
  if (!result || !result.url) {
    return null
  }
  return `${applicationConfig.backendEndpoint}${result.url}`
}

/**
 * Scan markdown content for image references and persist each resolvable
 * one through the backend so the document ends up referencing stable
 * platform URLs.
 *
 * Resolution rules per link:
 * - `/assets/images/<id>` (or the same URL on the configured backend host):
 *   left untouched.
 * - `http(s)://…`: fetched server-side via `/assets/images/from-url` and
 *   replaced with the returned platform URL.
 * - relative or `file://` path: matched against the supplied `files` pool
 *   (e.g. images the user selected alongside the markdown), uploaded via
 *   `/assets/images`, then replaced.
 *
 * Failures keep the original link in place so partial results never break
 * the import — the caller can surface counts via the `onProgress` hook.
 *
 * Outcome buckets in the returned summary:
 * - `uploaded`: rewritten to a platform URL.
 * - `alreadyPlatform`: was already pointing at our backend, left as-is.
 * - `unresolved`: relative/`file://` link with no matching companion file
 *   (e.g. user picked the markdown alone). The caller can use this count
 *   to nudge the user to also pick the assets.
 * - `failed`: an upload was attempted but errored; original URL kept.
 *
 * @param {string} content
 * @param {object} [options]
 * @param {string} [options.articleId]
 * @param {File[]} [options.files] - companion files supplied with the markdown
 * @param {(progress: { processed: number, total: number, uploaded: number, failed: number, alreadyPlatform: number, unresolved: number }) => void} [options.onProgress]
 * @returns {Promise<{ content: string, total: number, uploaded: number, failed: number, alreadyPlatform: number, unresolved: number, unresolvedSamples: string[] }>}
 */
export async function processMarkdownImageLinks(
  content,
  { articleId, files = [], onProgress } = {}
) {
  const empty = {
    content,
    total: 0,
    uploaded: 0,
    failed: 0,
    alreadyPlatform: 0,
    unresolved: 0,
    unresolvedSamples: [],
  }
  if (!content) {
    return empty
  }
  const matches = [...content.matchAll(MARKDOWN_IMAGE_LINK_RE)]
  if (matches.length === 0) {
    return empty
  }

  const uniqueUrls = []
  const seen = new Set()
  for (const m of matches) {
    const url = m[2]
    if (!url || seen.has(url)) continue
    seen.add(url)
    uniqueUrls.push(url)
  }

  const total = uniqueUrls.length
  let processed = 0
  let uploaded = 0
  let failed = 0
  let alreadyPlatform = 0
  let unresolved = 0
  /** @type {string[]} */
  const unresolvedSamples = []
  /** @type {Map<string, string>} */
  const replacements = new Map()

  const report = () => {
    if (onProgress) {
      onProgress({
        processed,
        total,
        uploaded,
        failed,
        alreadyPlatform,
        unresolved,
      })
    }
  }
  report()

  const addUnresolved = (url) => {
    unresolved++
    if (unresolvedSamples.length < 3) {
      unresolvedSamples.push(url)
    }
  }

  for (const url of uniqueUrls) {
    try {
      if (isPlatformAssetUrl(url)) {
        alreadyPlatform++
      } else if (isHttpImageUrl(url)) {
        const platformUrl = await uploadImageFromUrlToBackend(url, {
          articleId,
        })
        if (platformUrl) {
          replacements.set(url, platformUrl)
          uploaded++
        } else {
          failed++
        }
      } else if (isLocalReference(url)) {
        const decoded = (() => {
          try {
            return decodeURIComponent(url.replace(/^file:\/\//i, ''))
          } catch {
            return url
          }
        })()
        const file = files.find((f) => fileMatchesReference(decoded, f))
        if (!file || !file.type.startsWith('image/')) {
          addUnresolved(url)
        } else {
          const platformUrl = await uploadImageToBackend(file, { articleId })
          if (platformUrl) {
            replacements.set(url, platformUrl)
            uploaded++
          } else {
            failed++
          }
        }
      } else {
        addUnresolved(url)
      }
    } catch (err) {
      console.warn(`Failed to import image link ${url}:`, err)
      failed++
    }
    processed++
    report()
  }

  let nextContent = content
  if (replacements.size > 0) {
    nextContent = content.replace(
      MARKDOWN_IMAGE_LINK_RE,
      (full, alt, url, title) => {
        const replacement = replacements.get(url)
        if (!replacement) return full
        const titleSuffix = title ? ` "${title}"` : ''
        return `![${alt}](${replacement}${titleSuffix})`
      }
    )
  }

  return {
    content: nextContent,
    total,
    uploaded,
    failed,
    alreadyPlatform,
    unresolved,
    unresolvedSamples,
  }
}

/**
 * Upload an image to Imgur. Kept as a fallback when the backend is not
 * reachable or storage is not configured.
 *
 * @param {File} file
 * @returns {Promise<string|null>} Imgur URL or null on failure
 */
async function uploadImageToImgur(file) {
  const clientId = applicationConfig.imgurClientId
  if (!clientId || clientId.trim() === '') {
    return null
  }
  const formData = new FormData()
  formData.append('image', file)
  formData.append('title', file.name)
  const response = await fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: { Authorization: `Client-ID ${clientId}` },
    body: formData,
  })
  if (!response.ok) {
    let body = ''
    try {
      body = JSON.stringify(await response.json())
    } catch {
      // ignore
    }
    console.error(
      `Imgur upload failed for ${file.name} (status ${response.status}): ${body}`
    )
    return null
  }
  const result = await response.json()
  return result?.data?.link || null
}

/**
 * Creates a drop handler for the Monaco editor
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {object} options
 * @param {(file: File, companions: File[]) => void} [options.onMarkdownFile]
 *   Callback when a markdown file is dropped. Companion files dropped in
 *   the same drag operation are passed alongside so e.g. a markdown +
 *   accompanying images can be imported as a single bundle.
 * @param {string} [options.articleId] - Current article id, used to bind uploaded assets
 * @returns {function}
 */
export function onDropIntoEditor(editor, options = {}) {
  const { onMarkdownFile, articleId } = options

  return async ({ position, event }) => {
    event.preventDefault()

    try {
      const files = event.dataTransfer.files

      for (const file of files) {
        if (isMarkdownFile(file)) {
          const companions = Array.from(files).filter((f) => f !== file)
          if (onMarkdownFile) {
            onMarkdownFile(file, companions)
          } else {
            const content = await readFileAsText(file)
            importMarkdownContent(editor, content, 'insert')
          }
          return
        }
      }

      const lineNumber = position.lineNumber
      let column = position.column
      for (const file of files) {
        if (!isImageFile(file)) continue

        const placeholder = `<!-- Uploading ${file.name} -->`
        editor.executeEdits('insert-uploading-placeholder', [
          {
            range: new vscode.Range(lineNumber, column, lineNumber, column),
            text: `${placeholder} `,
            forceMoveMarkers: true,
          },
        ])
        column = column + placeholder.length + 1
        editor.setPosition({
          lineNumber: lineNumber,
          column,
        })
      }

      for (const file of files) {
        if (!isImageFile(file)) continue

        let url = await uploadImageToBackend(file, { articleId })
        if (!url) {
          url = await uploadImageToImgur(file)
        }

        const placeholder = `<!-- Uploading ${file.name} -->`
        const matches = editor.getModel().findMatches(placeholder)
        if (matches && matches.length > 0) {
          const match = matches[0]
          if (url) {
            editor.executeEdits('replace-uploading-placeholder', [
              {
                range: match.range,
                text: `![](${url})`,
                forceMoveMarkers: true,
              },
            ])
          } else {
            editor.executeEdits('remove-uploading-placeholder', [
              {
                range: match.range,
                text: `<!-- Upload failed: ${file.name} -->`,
                forceMoveMarkers: true,
              },
            ])
            console.error(
              `Unable to upload image ${file.name}: neither backend nor Imgur succeeded`
            )
          }
        }
      }
    } catch (error) {
      console.error(
        'Something went wrong while dropping a file into the text editor',
        error
      )
    }
  }
}
